import { resolve } from 'node:path';
import { z } from 'zod';
import {
  type GraphNode,
  loadProject,
  QueryEngine,
  analyzeImpact,
  validateGraph,
  loadPreset,
  checkGraph,
  slice,
  lifecycle,
  sourceRootOf,
  verifyImplementations,
  verifyRejectionHandling,
  collectSources,
  unreadLanguages,
  scaffold,
  stringifyContextModel,
  EXTRACTORS,
  LANES,
} from 'eventgraph-core';
import { tool } from './define.js';
import { presetsDirPath } from './presets.js';

/**
 * Every tool reads the model from disk rather than closing over one loaded at
 * startup. A long-lived server that held the graph in memory could not see its
 * own writes — an agent adding a node and querying for it got the state from
 * before — and could not see edits made by the CLI in another terminal either.
 * The model is a handful of small YAML files, so re-reading is cheaper than
 * any scheme for deciding when the copy went stale.
 */
export function createReadTools(projectDir: string) {
  const open = () => loadProject(projectDir);
  // Source lives beside the eventgraph directory, so that is where a pointer
  // or a relative root is resolved from — not from wherever the server runs.
  const sourceRoot = (root?: string) => resolve(sourceRootOf(projectDir), root ?? '.');
  const ids = (nodes: GraphNode[]) => nodes.map(n => `${n.context}.${n.id}`);

  return {
    eventgraph_query: tool({
      description: 'Query the architecture graph. Examples: "type:event", "context:payments", "downstream:order-placed"',
      input: { expr: z.string().describe('Query expression') },
      async run({ expr }) {
        return { nodes: new QueryEngine(open().graph).query(expr) };
      },
    }),

    eventgraph_impact: tool({
      description: 'Analyze impact: what is affected if this node changes?',
      input: {
        nodeId: z.string().describe('Node ID (e.g., order-placed or payments.order-placed)'),
        depth: z.number().optional().describe('Max traversal depth'),
      },
      async run({ nodeId, depth }) {
        const { graph } = open();
        let qualifiedId = nodeId;
        if (!nodeId.includes('.')) {
          const match = graph.getAllNodes().find(n => n.id === nodeId);
          if (!match) return { direct: [], transitive: [], affectedContexts: [], crossContext: false, totalAffected: 0, risk: 'low' };
          qualifiedId = `${match.context}.${match.id}`;
        }

        const result = analyzeImpact(graph, qualifiedId, { maxDepth: depth });
        return {
          direct: result.direct,
          transitive: result.transitive,
          affectedContexts: result.affectedContexts,
          crossContext: result.crossContext,
          totalAffected: result.totalAffected,
          risk: result.risk as string,
        };
      },
    }),

    eventgraph_get_node: tool({
      description: 'Get details for a single node',
      input: { nodeId: z.string().describe('Qualified node ID (e.g., payments.order-placed)') },
      async run({ nodeId }) {
        return { node: open().graph.getNode(nodeId) ?? null };
      },
    }),

    eventgraph_list_contexts: tool({
      description: 'List all bounded contexts in the project',
      input: {},
      async run() {
        return { contexts: open().graph.getContexts() };
      },
    }),

    /**
     * The swimlane around one event, rebuilt on demand. Asking for a part of
     * the model beats rendering all of it, which stops being readable within a
     * few dozen nodes.
     */
    eventgraph_slice: tool({
      description:
        'Rebuild the swimlane around one event: who triggers it, which command produces it, what projects from it and where that is shown. Prefer this over reading the whole graph.',
      input: { eventId: z.string().describe('Event id, qualified or bare') },
      async run({ eventId }) {
        const s = slice(open().graph, eventId);
        return {
          event: `${s.event.context}.${s.event.id}`,
          actors: ids(s.actors),
          screens: ids(s.screens),
          causedBy: ids(s.causedBy),
          aggregate: s.aggregate ? `${s.aggregate.context}.${s.aggregate.id}` : null,
          readModels: ids(s.readModels),
          policies: ids(s.policies),
          shownOn: ids(s.shownOn),
        };
      },
    }),

    eventgraph_lifecycle: tool({
      description: "List an aggregate's events, the one that ends its life last",
      input: { aggregateId: z.string().describe('Aggregate id, qualified or bare') },
      async run({ aggregateId }) {
        return {
          events: lifecycle(open().graph, aggregateId).map(e => ({
            id: `${e.context}.${e.id}`,
            label: e.label,
            endsLifecycle: e.data?.ends_lifecycle === true,
          })),
        };
      },
    }),

    /**
     * Completeness gaps, most pressing first. This is the plan-forward loop an
     * agent drives: check what is missing, fill one gap, check again. `limit`
     * turns it into "what should I do next".
     */
    eventgraph_check: tool({
      description:
        'Find completeness gaps in the graph — what is missing, not just whether the shape is valid. Use limit to get the most pressing gaps to work on next (the CLI calls this check --next).',
      input: {
        lane: z.enum(LANES).optional().describe('Restrict to one lane of rules'),
        limit: z.number().optional().describe('Return only the N most pressing gaps'),
      },
      async run({ lane, limit }) {
        const { config, graph } = open();
        const preset = loadPreset(config.preset, presetsDirPath());
        const all = checkGraph(graph, preset, { lane });
        return {
          ok: !all.some(f => f.severity === 'error'),
          nodes: graph.getAllNodes().length,
          remaining: all.length,
          findings: limit && limit > 0 ? all.slice(0, limit) : all,
        };
      },
    }),

    eventgraph_validate: tool({
      description: 'Validate the model against preset rules',
      input: {},
      async run() {
        const { config, graph } = open();
        const errors = validateGraph(graph, loadPreset(config.preset, presetsDirPath()));
        return { valid: errors.length === 0, errors: errors.map(e => ({ type: e.type, message: e.message })) };
      },
    }),

    /**
     * The model against the code, which `check` cannot see: pointers that no
     * longer resolve, and callers that do not know a rejection they can get.
     */
    eventgraph_verify: tool({
      description:
        'Check the model against the code: source pointers that no longer resolve, and callers that do not handle a rejection code a command can answer with.',
      input: {
        root: z
          .string()
          .optional()
          .describe('Where source pointers resolve from, relative to the directory holding eventgraph/ (default: that directory)'),
      },
      async run({ root }) {
        const { graph } = open();
        const from = sourceRoot(root);
        const report = verifyImplementations(graph, from);
        const contract = verifyRejectionHandling(graph, from);
        return { ok: report.issues.length + contract.issues.length === 0, sourceRoot: from, ...report, contract };
      },
    }),

    /**
     * A partial model read from source, returned rather than written: a guess
     * that lands in the project unseen is indistinguishable from a decision.
     * The agent reviews it and hands it to eventgraph_apply.
     */
    eventgraph_scaffold: tool({
      description:
        'Extract a partial model from source: surfaces, navigation, aggregates, and declared commands and events. Returns YAML to review and pass to eventgraph_apply; writes nothing. Reads TypeScript, JavaScript, Dart and Prisma only, and names the languages it walked past.',
      input: {
        root: z.string().optional().describe('Directory to scan, relative to the directory holding eventgraph/ (default: that directory)'),
        context: z.string().optional().describe('Context name for the returned model (default: core)'),
        only: z.array(z.enum(EXTRACTORS)).optional().describe('Limit the extractors'),
      },
      async run({ root, context, only }) {
        const from = sourceRoot(root);
        const sources = collectSources(from);
        const unread = unreadLanguages(from);
        if (sources.length === 0) {
          return { scanned: 0, model: null, notes: [`no source files scaffold can read under ${from}`], counts: null, unread };
        }
        const report = scaffold(sources, { context: context ?? 'core', only });
        return {
          scanned: sources.length,
          // The scaffolded context as YAML, ready for eventgraph_apply; null when nothing was recognised.
          model: report.model.nodes.length > 0 ? stringifyContextModel(report.model) : null,
          notes: report.notes,
          counts: report.counts,
          unread,
        };
      },
    }),
  };
}
