import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ContextModel, ContextModelNode, GraphEdge } from './schema.js';

function readContextModel(projectDir: string, contextName: string): ContextModel {
  const path = join(projectDir, 'contexts', contextName, 'model.yaml');
  const content = readFileSync(path, 'utf-8');
  return parseYaml(content) as ContextModel;
}

function writeContextModel(projectDir: string, contextName: string, model: ContextModel): void {
  const path = join(projectDir, 'contexts', contextName, 'model.yaml');
  writeFileSync(path, stringifyYaml(model, { lineWidth: 120 }));
}

export function addNodeToContext(projectDir: string, contextName: string, node: ContextModelNode): void {
  const model = readContextModel(projectDir, contextName);
  model.nodes.push(node);
  writeContextModel(projectDir, contextName, model);
}

export function addEdgeToContext(projectDir: string, contextName: string, edge: GraphEdge): void {
  const model = readContextModel(projectDir, contextName);
  model.edges.push(edge);
  writeContextModel(projectDir, contextName, model);
}

export function removeNodeFromContext(projectDir: string, contextName: string, nodeId: string): void {
  const model = readContextModel(projectDir, contextName);
  model.nodes = model.nodes.filter(n => n.id !== nodeId);
  model.edges = model.edges.filter(e => {
    const fromId = e.from.includes('.') ? e.from.split('.').pop()! : e.from;
    const toId = e.to.includes('.') ? e.to.split('.').pop()! : e.to;
    return fromId !== nodeId && toId !== nodeId;
  });
  writeContextModel(projectDir, contextName, model);
}

export interface DiffChanges {
  addNodes?: ContextModelNode[];
  addEdges?: GraphEdge[];
  removeNodes?: string[];
}

export function generateYamlDiff(
  projectDir: string,
  contextName: string,
  changes: DiffChanges,
): string {
  const before = readFileSync(
    join(projectDir, 'contexts', contextName, 'model.yaml'),
    'utf-8',
  );
  const model = parseYaml(before) as ContextModel;

  if (changes.addNodes) {
    for (const node of changes.addNodes) model.nodes.push(node);
  }
  if (changes.addEdges) {
    for (const edge of changes.addEdges) model.edges.push(edge);
  }
  if (changes.removeNodes) {
    for (const nodeId of changes.removeNodes) {
      model.nodes = model.nodes.filter(n => n.id !== nodeId);
      model.edges = model.edges.filter(e => {
        const fromId = e.from.includes('.') ? e.from.split('.').pop()! : e.from;
        const toId = e.to.includes('.') ? e.to.split('.').pop()! : e.to;
        return fromId !== nodeId && toId !== nodeId;
      });
    }
  }

  const after = stringifyYaml(model, { lineWidth: 120 });

  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const diff: string[] = [];

  diff.push(`--- contexts/${contextName}/model.yaml`);
  diff.push(`+++ contexts/${contextName}/model.yaml (proposed)`);

  for (const line of beforeLines) {
    if (!afterLines.includes(line)) {
      diff.push(`- ${line}`);
    }
  }
  for (const line of afterLines) {
    if (!beforeLines.includes(line)) {
      diff.push(`+ ${line}`);
    }
  }

  return diff.join('\n');
}
