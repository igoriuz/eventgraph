import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { PresetDefinition } from './schema.js';
import type { EventGraph } from './graph.js';
import { SURFACE_KINDS } from './rules/kit.js';

export interface ValidationError {
  type: 'invalid-name' | 'invalid-node-type' | 'invalid-surface-kind' | 'invalid-edge-type' | 'edge-rule-violation' | 'dangling-edge';
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

/** A node's type must be one the preset knows, and a surface's kind one the rules know. */
function nodeErrors(graph: EventGraph, preset: PresetDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const node of graph.getAllNodes()) {
    const nodeId = `${node.context}.${node.id}`;
    if (!preset.nodeTypes.includes(node.type)) {
      errors.push({
        type: 'invalid-node-type',
        message: `Node "${nodeId}" has invalid type "${node.type}". Allowed: ${preset.nodeTypes.join(', ')}`,
        nodeId,
      });
    }
    // The rules tell surfaces apart by kind and treat one they do not know
    // as nothing in particular, so a typo here silently switches a lane off.
    const kind = node.data?.kind;
    if (node.type === 'screen' && kind !== undefined && !(SURFACE_KINDS as readonly unknown[]).includes(kind)) {
      errors.push({
        type: 'invalid-surface-kind',
        message: `Node "${nodeId}" has unknown kind "${String(kind)}". Allowed: ${SURFACE_KINDS.join(', ')}`,
        nodeId,
      });
    }
  }
  return errors;
}

export function validateGraph(graph: EventGraph, preset: PresetDefinition): ValidationError[] {
  const isPermissive = preset.nodeTypes.length === 0 && preset.edgeTypes.length === 0;
  const errors: ValidationError[] = isPermissive ? [] : nodeErrors(graph, preset);

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
        // "*" lets a rule accept any node type on that end — needed for edges
        // like decision→anything and question→anything.
        const matches = (expected: string, actual: string) => expected === '*' || expected === actual;
        const valid = matchingRules.some(
          r => matches(r.from, fromNode.type) && matches(r.to, toNode.type)
        );
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
