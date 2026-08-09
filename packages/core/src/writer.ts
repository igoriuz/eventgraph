import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ContextModel, ContextModelNode, GraphEdge } from './schema.js';
import {
  addEdgeToDocument,
  editContextDocument,
  parseContextModel,
  removeNodeFromDocument,
  setNodeInDocument,
  stringifyContextModel,
} from './model-file.js';

function contextPath(projectDir: string, contextName: string): string {
  return join(projectDir, 'contexts', contextName, 'model.yaml');
}

function readContextFile(projectDir: string, contextName: string): string {
  return readFileSync(contextPath(projectDir, contextName), 'utf-8');
}

/**
 * Applies an edit in place.
 *
 * Every write goes through the document tree so the comments around the change
 * survive it. A model whose prose disappears the first time an agent touches it
 * is a model people stop writing prose in.
 */
function editContextFile(
  projectDir: string,
  contextName: string,
  edit: Parameters<typeof editContextDocument>[1],
): void {
  const before = readContextFile(projectDir, contextName);
  writeFileSync(contextPath(projectDir, contextName), editContextDocument(before, edit));
}

export function addNodeToContext(projectDir: string, contextName: string, node: ContextModelNode): void {
  editContextFile(projectDir, contextName, doc => setNodeInDocument(doc, node));
}

export function addEdgeToContext(projectDir: string, contextName: string, edge: GraphEdge): void {
  editContextFile(projectDir, contextName, doc => addEdgeToDocument(doc, edge));
}

export function removeNodeFromContext(projectDir: string, contextName: string, nodeId: string): void {
  editContextFile(projectDir, contextName, doc => removeNodeFromDocument(doc, nodeId));
}

/** Rewrites a context in compact form, dropping any legacy list shape. */
export function rewriteContextCompact(projectDir: string, contextName: string): ContextModel {
  const model = parseContextModel(parseYaml(readContextFile(projectDir, contextName)));
  writeFileSync(contextPath(projectDir, contextName), stringifyContextModel(model));
  return model;
}

export interface DiffChanges {
  addNodes?: ContextModelNode[];
  addEdges?: GraphEdge[];
  removeNodes?: string[];
}

/** The edit as a unified-ish diff, for the `prompt` agent write mode. */
export function generateYamlDiff(
  projectDir: string,
  contextName: string,
  changes: DiffChanges,
): string {
  const before = readContextFile(projectDir, contextName);
  const after = editContextDocument(before, doc => {
    for (const node of changes.addNodes ?? []) setNodeInDocument(doc, node);
    for (const edge of changes.addEdges ?? []) addEdgeToDocument(doc, edge);
    for (const nodeId of changes.removeNodes ?? []) removeNodeFromDocument(doc, nodeId);
  });

  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const diff: string[] = [
    `--- contexts/${contextName}/model.yaml`,
    `+++ contexts/${contextName}/model.yaml (proposed)`,
  ];

  for (const line of beforeLines) if (!afterLines.includes(line)) diff.push(`- ${line}`);
  for (const line of afterLines) if (!beforeLines.includes(line)) diff.push(`+ ${line}`);

  return diff.join('\n');
}
