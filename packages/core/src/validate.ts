import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { PresetDefinition } from './schema.js';
import type { EventGraph } from './graph.js';

export interface ValidationError {
  type: 'invalid-node-type' | 'invalid-edge-type' | 'edge-rule-violation' | 'dangling-edge';
  message: string;
  nodeId?: string;
  edgeFrom?: string;
  edgeTo?: string;
}

export function loadPreset(name: string, presetsDir: string): PresetDefinition {
  const filePath = join(presetsDir, `${name}.yaml`);
  const content = readFileSync(filePath, 'utf-8');
  return parseYaml(content) as PresetDefinition;
}

export function validateGraph(graph: EventGraph, preset: PresetDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  const isPermissive = preset.nodeTypes.length === 0 && preset.edgeTypes.length === 0;

  if (!isPermissive) {
    for (const node of graph.getAllNodes()) {
      if (!preset.nodeTypes.includes(node.type)) {
        errors.push({
          type: 'invalid-node-type',
          message: `Node "${node.context}.${node.id}" has invalid type "${node.type}". Allowed: ${preset.nodeTypes.join(', ')}`,
          nodeId: `${node.context}.${node.id}`,
        });
      }
    }
  }

  for (const edge of graph.getAllEdges()) {
    const fromNode = graph.getNode(edge.from);
    const toNode = graph.getNode(edge.to);

    if (!fromNode || !toNode) {
      errors.push({
        type: 'dangling-edge',
        message: `Edge from "${edge.from}" to "${edge.to}" references a non-existent node`,
        edgeFrom: edge.from,
        edgeTo: edge.to,
      });
      continue;
    }

    if (!isPermissive && !preset.edgeTypes.includes(edge.type)) {
      errors.push({
        type: 'invalid-edge-type',
        message: `Edge from "${edge.from}" to "${edge.to}" has invalid type "${edge.type}". Allowed: ${preset.edgeTypes.join(', ')}`,
        edgeFrom: edge.from,
        edgeTo: edge.to,
      });
      continue;
    }

    if (preset.edgeRules.length > 0) {
      const matchingRules = preset.edgeRules.filter(r => r.type === edge.type);
      if (matchingRules.length > 0) {
        const valid = matchingRules.some(r => r.from === fromNode.type && r.to === toNode.type);
        if (!valid) {
          errors.push({
            type: 'edge-rule-violation',
            message: `Edge "${edge.type}" from "${edge.from}" (${fromNode.type}) to "${edge.to}" (${toNode.type}) violates preset rules`,
            edgeFrom: edge.from,
            edgeTo: edge.to,
          });
        }
      }
    }
  }

  return errors;
}
