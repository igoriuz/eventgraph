import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAllDocuments, parseDocument } from 'yaml';
import { EventGraph } from './graph.js';
import {
  addEdgeToDocument,
  editContextDocument,
  parseContextModel,
  setNodeInDocument,
  stringifyContextModel,
} from './model-file.js';
import { loadConfig, loadContextIntoGraph, readContextModel } from './parser.js';
import {
  isPlainName,
  qualifiedId,
  type ContextModel,
  type ContextModelNode,
  type GraphEdge,
  type PresetDefinition,
  type ProjectConfig,
} from './schema.js';
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

/**
 * `applied` wrote the changes, `planned` is a dry run that would have, and
 * `invalid` names what is wrong with the merged whole. Only `applied` touched
 * the disk.
 */
export type ApplyOutcome =
  | { status: 'applied' | 'planned'; changes: ContextChange[]; errors: [] }
  | { status: 'invalid'; changes: ContextChange[]; errors: ValidationError[] };

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

/**
 * An edge end may be written `place-order` or `shop.place-order`. Both mean
 * the same node, so they are compared qualified; told apart, one edge was
 * stored twice and every rule counting edges counted it twice.
 */
function mergeEdges(context: string, existing: GraphEdge[], incoming: GraphEdge[]) {
  const qualify = (id: string) => (id.includes('.') ? id : qualifiedId(context, id));
  const key = (e: GraphEdge) => `${qualify(e.from)}|${e.type}|${qualify(e.to)}`;
  const seen = new Set(existing.map(key));
  const edges = [...existing];
  const added: GraphEdge[] = [];

  for (const edge of incoming) {
    if (seen.has(key(edge))) continue;
    seen.add(key(edge));
    edges.push(edge);
    added.push(edge);
  }
  return { edges, added };
}

/**
 * One model per context, later documents merged over earlier ones. Planning
 * each document against the disk on its own let the last one naming a context
 * win, and the earlier ones disappeared behind a success message.
 */
function foldByContext(incoming: ContextModel[]): ContextModel[] {
  const folded = new Map<string, ContextModel>();
  for (const model of incoming) {
    const earlier = folded.get(model.context);
    if (!earlier) {
      folded.set(model.context, model);
      continue;
    }
    folded.set(model.context, {
      context: model.context,
      nodes: mergeNodes(earlier.nodes, model.nodes).nodes,
      edges: mergeEdges(model.context, earlier.edges, model.edges).edges,
    });
  }
  return [...folded.values()];
}

/** A context to write: what changed, and the file content that says so. */
interface PlannedContext extends ContextChange {
  content: string;
}

const modelPath = (projectDir: string, context: string) => join(projectDir, 'contexts', context, 'model.yaml');

function planContext(projectDir: string, config: ProjectConfig, incoming: ContextModel, replace: boolean): PlannedContext {
  const isNew = !config.contexts.includes(incoming.context);
  const fresh = isNew || replace;
  const current: ContextModel = fresh
    ? { context: incoming.context, nodes: [], edges: [] }
    : readContextModel(projectDir, incoming.context);

  const { nodes, added, replaced } = mergeNodes(current.nodes, incoming.nodes);
  const { edges, added: newEdges } = mergeEdges(incoming.context, current.edges, incoming.edges);
  const model: ContextModel = { context: incoming.context, nodes, edges };

  return {
    context: incoming.context,
    nodesAdded: added,
    nodesReplaced: replaced,
    edgesAdded: newEdges.length,
    isNew,
    model,
    content: fresh ? stringifyContextModel(model) : mergedContent(projectDir, model, incoming.nodes, newEdges),
  };
}

/**
 * A merge edits the file that is there, so the comments in it survive — the
 * same reason single edits go through the document tree. A context still in
 * the list form cannot be edited in place and is rewritten whole, as it always
 * was.
 */
function mergedContent(projectDir: string, model: ContextModel, nodes: ContextModelNode[], edges: GraphEdge[]): string {
  try {
    return editContextDocument(readFileSync(modelPath(projectDir, model.context), 'utf-8'), doc => {
      for (const node of nodes) setNodeInDocument(doc, node);
      for (const edge of edges) addEdgeToDocument(doc, edge);
    });
  } catch {
    return stringifyContextModel(model);
  }
}

/** Names that would escape the project or break qualified ids, before anything else is looked at. */
function invalidNames(incoming: ContextModel[]): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const model of incoming) {
    if (!isPlainName(model.context)) {
      errors.push({
        type: 'invalid-name',
        message: `Context name "${model.context}" must be a plain name: letters, digits, "-" and "_", starting with a letter or digit`,
      });
    }
    for (const node of model.nodes) {
      if (!isPlainName(node.id)) {
        errors.push({
          type: 'invalid-name',
          message: `Node id "${node.id}" in context "${model.context}" must be a plain name: letters, digits, "-" and "_", starting with a letter or digit`,
          nodeId: `${model.context}.${node.id}`,
        });
      }
    }
  }
  return errors;
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

/**
 * Every file is written beside its target first and only then moved into
 * place, so a write that fails halfway leaves the models as they were. The
 * project file comes last: a context on disk that is not registered yet is
 * inert, one registered without its file breaks every load.
 */
function write(projectDir: string, planned: PlannedContext[]): void {
  const staged = planned.map(change => {
    const target = modelPath(projectDir, change.context);
    const dir = join(projectDir, 'contexts', change.context);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(`${target}.tmp`, change.content);
    return target;
  });
  for (const target of staged) renameSync(`${target}.tmp`, target);

  const added = planned.filter(c => c.isNew).map(c => c.context);
  if (added.length === 0) return;

  // Edited as a document, so the comments in the project file stay.
  const configPath = join(projectDir, 'eventgraph.yaml');
  const doc = parseDocument(readFileSync(configPath, 'utf-8'));
  for (const context of added) doc.addIn(['contexts'], context);
  writeFileSync(configPath, doc.toString({ lineWidth: 120 }));
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
  const names = invalidNames(incoming);
  if (names.length > 0) return { status: 'invalid', changes: [], errors: names };

  const config = loadConfig(projectDir);
  const planned = foldByContext(incoming).map(model => planContext(projectDir, config, model, options.replace ?? false));
  const changes: ContextChange[] = planned.map(({ content: _content, ...change }) => change);

  const errors = validateGraph(projectedGraph(projectDir, config, changes), preset);
  if (errors.length > 0) return { status: 'invalid', changes, errors };
  if (options.dryRun) return { status: 'planned', changes, errors: [] };

  write(projectDir, planned);
  return { status: 'applied', changes, errors: [] };
}
