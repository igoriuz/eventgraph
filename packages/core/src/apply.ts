import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAllDocuments, stringify as stringifyYaml } from 'yaml';
import { EventGraph } from './graph.js';
import { parseContextModel, stringifyContextModel } from './model-file.js';
import { loadConfig, loadContextIntoGraph, readContextModel } from './parser.js';
import type { ContextModel, ContextModelNode, GraphEdge, PresetDefinition, ProjectConfig } from './schema.js';
import { validateGraph, type ValidationError } from './validate.js';

/**
 * Bulk write.
 *
 * The per-node tools are fine for one edit and hopeless for a model: describing
 * an application meant hundreds of `add` and `connect` calls, so in practice
 * everyone hand-wrote the YAML instead and the write path went unused. Here an
 * agent emits one document and the tool takes it — and, crucially, validates
 * the merged result *before* touching disk, so a bad batch leaves nothing
 * half-applied.
 */

/** What an apply does to one context. */
export interface ContextChange {
  context: string;
  nodesAdded: number;
  nodesReplaced: number;
  edgesAdded: number;
  isNew: boolean;
  /** The context as it is after the apply. */
  model: ContextModel;
}

export interface ApplyOptions {
  /** Replace the named contexts instead of merging into them. */
  replace?: boolean;
  /** Plan and validate, but write nothing. */
  dryRun?: boolean;
}

export interface ApplyOutcome {
  /** Whether anything was written: false on a dry run and on validation errors. */
  applied: boolean;
  changes: ContextChange[];
  /** Errors in the merged whole. When there are any, nothing was written. */
  errors: ValidationError[];
}

/** One or more context models from YAML, documents separated by `---`. */
export function parseContextModels(text: string): ContextModel[] {
  const models = parseAllDocuments(text)
    .filter(doc => doc.contents !== null)
    .map(doc => {
      if (doc.errors.length > 0) throw new Error(doc.errors[0]!.message);
      return parseContextModel(doc.toJS());
    });
  if (models.length === 0) throw new Error('no context models on the input.');
  return models;
}

function mergeNodes(existing: ContextModelNode[], incoming: ContextModelNode[]) {
  const byId = new Map(existing.map(n => [n.id, n]));
  let added = 0;
  let replaced = 0;

  for (const node of incoming) {
    if (byId.has(node.id)) replaced++;
    else added++;
    byId.set(node.id, node);
  }
  return { nodes: [...byId.values()], added, replaced };
}

function mergeEdges(existing: GraphEdge[], incoming: GraphEdge[]) {
  const key = (e: GraphEdge) => `${e.from}|${e.type}|${e.to}`;
  const seen = new Set(existing.map(key));
  const edges = [...existing];
  let added = 0;

  for (const edge of incoming) {
    if (seen.has(key(edge))) continue;
    seen.add(key(edge));
    edges.push(edge);
    added++;
  }
  return { edges, added };
}

function plan(projectDir: string, config: ProjectConfig, incoming: ContextModel[], replace: boolean): ContextChange[] {
  return incoming.map(model => {
    const isNew = !config.contexts.includes(model.context);
    const current: ContextModel =
      isNew || replace ? { context: model.context, nodes: [], edges: [] } : readContextModel(projectDir, model.context);

    const { nodes, added, replaced } = mergeNodes(current.nodes, model.nodes);
    const { edges, added: edgesAdded } = mergeEdges(current.edges, model.edges);

    return {
      context: model.context,
      nodesAdded: added,
      nodesReplaced: replaced,
      edgesAdded,
      isNew,
      model: { context: model.context, nodes, edges },
    };
  });
}

/** The whole project as it would be after the apply, for validation. */
function projectedGraph(projectDir: string, config: ProjectConfig, changes: ContextChange[]): EventGraph {
  const touched = new Map(changes.map(c => [c.context, c.model]));
  const graph = new EventGraph();
  graph.platforms = config.platforms ?? [];
  graph.backend = config.backend ?? false;

  const contexts = [...new Set([...config.contexts, ...touched.keys()])];
  for (const context of contexts) {
    loadContextIntoGraph(graph, touched.get(context) ?? readContextModel(projectDir, context));
  }
  return graph;
}

function write(projectDir: string, config: ProjectConfig, changes: ContextChange[]): void {
  for (const change of changes) {
    const dir = join(projectDir, 'contexts', change.context);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'model.yaml'), stringifyContextModel(change.model));
  }

  const added = [...new Set(changes.filter(c => c.isNew).map(c => c.context))];
  if (added.length > 0) {
    config.contexts = [...config.contexts, ...added];
    writeFileSync(join(projectDir, 'eventgraph.yaml'), stringifyYaml(config, { lineWidth: 120 }));
  }
}

/**
 * Merges the incoming models into the project, context by context.
 *
 * The merged whole is validated first. Applying context by context would let a
 * batch fail halfway and leave a graph nobody asked for.
 */
export function applyModels(
  projectDir: string,
  incoming: ContextModel[],
  preset: PresetDefinition,
  options: ApplyOptions = {}
): ApplyOutcome {
  const config = loadConfig(projectDir);
  const changes = plan(projectDir, config, incoming, options.replace ?? false);
  const errors = validateGraph(projectedGraph(projectDir, config, changes), preset);
  if (errors.length > 0 || options.dryRun) return { applied: false, changes, errors };

  write(projectDir, config, changes);
  return { applied: true, changes, errors };
}
