import { Command } from 'commander';
import { mkdirSync, readFileSync, readSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseAllDocuments, stringify as stringifyYaml } from 'yaml';
import {
  EventGraph,
  findProjectDir,
  loadConfig,
  loadContextIntoGraph,
  parseContextModel,
  readContextModel,
  stringifyContextModel,
  loadPreset,
  validateGraph,
  qualifiedId,
  type ContextModel,
  type ContextModelNode,
  type GraphEdge,
  type ProjectConfig,
} from 'eventgraph-core';
import { presetsDir } from '../util.js';

/**
 * Bulk write.
 *
 * The per-node CLI is fine for one edit and hopeless for a model: describing an
 * application meant hundreds of `add` and `connect` calls, so in practice
 * everyone hand-wrote the YAML instead and the write path went unused. Here an
 * agent emits one document and the tool takes it — and, crucially, validates
 * the merged result *before* touching disk, so a bad batch leaves nothing
 * half-applied.
 */

function readInput(file: string | undefined): string {
  if (file && file !== '-') return readFileSync(file, 'utf-8');
  return readStdin();
}

/**
 * Reads stdin to the end.
 *
 * `readFileSync(0)` looks like the obvious way and fails with EAGAIN the
 * moment stdin is a pipe rather than a file — which is every use of the
 * documented `eventgraph scaffold | eventgraph apply -`. A pipe hands over
 * whatever has been written so far, so the read has to be retried until the
 * writer closes it.
 */
function readStdin(): string {
  const chunks: Buffer[] = [];
  const buffer = Buffer.alloc(64 * 1024);

  for (;;) {
    let read: number;
    try {
      read = readSync(0, buffer, 0, buffer.length, null);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EAGAIN') {
        // Nothing buffered yet; yield rather than spin the CPU.
        sleep(5);
        continue;
      }
      if (code === 'EOF') break;
      throw error;
    }
    if (read === 0) break;
    chunks.push(Buffer.from(buffer.subarray(0, read)));
  }

  return Buffer.concat(chunks).toString('utf-8');
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function mergeNodes(existing: ContextModelNode[], incoming: ContextModelNode[]): {
  nodes: ContextModelNode[];
  added: number;
  replaced: number;
} {
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

function mergeEdges(existing: GraphEdge[], incoming: GraphEdge[]): { edges: GraphEdge[]; added: number } {
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

interface Applied {
  context: string;
  nodesAdded: number;
  nodesReplaced: number;
  edgesAdded: number;
  isNew: boolean;
  model: ContextModel;
}

function planApply(
  projectDir: string,
  config: ProjectConfig,
  incoming: ContextModel[],
  replace: boolean,
): Applied[] {
  return incoming.map(model => {
    const isNew = !config.contexts.includes(model.context);
    const current: ContextModel =
      isNew || replace
        ? { context: model.context, nodes: [], edges: [] }
        : readContextModel(projectDir, model.context);

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
function projectedGraph(
  projectDir: string,
  config: ProjectConfig,
  applied: Applied[],
): EventGraph {
  const touched = new Map(applied.map(a => [a.context, a.model]));
  const graph = new EventGraph();
  graph.platforms = config.platforms ?? [];
  graph.backend = config.backend ?? false;

  const contexts = [...new Set([...config.contexts, ...touched.keys()])];
  for (const context of contexts) {
    loadContextIntoGraph(graph, touched.get(context) ?? readContextModel(projectDir, context));
  }
  return graph;
}

export function registerApplyCommand(program: Command): void {
  program
    .command('apply')
    .argument('[file]', 'Model file, or - for stdin', '-')
    .description('Merge one or more context models into the project')
    .option('--replace', 'Replace the named contexts instead of merging into them')
    .option('--dry-run', 'Report what would change without writing')
    .option('--json', 'machine-readable output')
    .action((file, opts) => {
      const projectDir = findProjectDir();
      if (!projectDir) {
        console.error('Error: No eventgraph project found. Run "eventgraph init" first.');
        process.exit(1);
      }
      const config = loadConfig(projectDir);

      let incoming: ContextModel[];
      try {
        const docs = parseAllDocuments(readInput(file));
        incoming = docs
          .filter(doc => doc.contents !== null)
          .map(doc => {
            if (doc.errors.length > 0) throw new Error(doc.errors[0]!.message);
            return parseContextModel(doc.toJS());
          });
      } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        process.exit(2);
      }

      if (incoming.length === 0) {
        console.error('Error: no context models on the input.');
        process.exit(2);
      }

      const applied = planApply(projectDir, config, incoming, Boolean(opts.replace));

      // Validate the merged whole first. Applying context by context would let
      // a batch fail halfway and leave a graph nobody asked for.
      const preset = loadPreset(config.preset, presetsDir());
      const errors = validateGraph(projectedGraph(projectDir, config, applied), preset);
      if (errors.length > 0) {
        console.error(`Refusing to apply — ${errors.length} validation error(s):\n`);
        for (const e of errors) console.error(`  ✗ [${e.type}] ${e.message}`);
        process.exit(1);
      }

      if (!opts.dryRun) {
        for (const change of applied) {
          const dir = join(projectDir, 'contexts', change.context);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, 'model.yaml'), stringifyContextModel(change.model));
        }

        const known = new Set(config.contexts);
        const addedContexts = applied.filter(a => a.isNew).map(a => a.context);
        if (addedContexts.length > 0) {
          config.contexts = [...config.contexts, ...addedContexts.filter(c => !known.has(c))];
          writeFileSync(join(projectDir, 'eventgraph.yaml'), stringifyYaml(config, { lineWidth: 120 }));
        }
      }

      if (opts.json) {
        console.log(JSON.stringify({ dryRun: Boolean(opts.dryRun), contexts: applied.map(summary) }, null, 2));
        return;
      }

      const verb = opts.dryRun ? 'Would apply' : 'Applied';
      console.log(`${verb} ${applied.length} context(s):`);
      for (const change of applied) {
        const bits = [
          `${change.nodesAdded} node(s) added`,
          change.nodesReplaced > 0 ? `${change.nodesReplaced} replaced` : '',
          `${change.edgesAdded} edge(s) added`,
          change.isNew ? 'new context' : '',
        ].filter(Boolean);
        console.log(`  ${change.context}: ${bits.join(', ')}`);
      }
    });
}

function summary(change: Applied) {
  return {
    context: change.context,
    nodesAdded: change.nodesAdded,
    nodesReplaced: change.nodesReplaced,
    edgesAdded: change.edgesAdded,
    isNew: change.isNew,
    nodes: change.model.nodes.map(n => qualifiedId(change.context, n.id)),
  };
}
