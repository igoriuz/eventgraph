import { resolve } from 'node:path';
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
  verifyImplementations,
  verifyRejectionHandling,
  collectSources,
  unreadLanguages,
  scaffold,
  stringifyContextModel,
  type ContractReport,
  type Extractor,
  type Finding,
  type Lane,
  type ScaffoldReport,
  type UnreadLanguage,
  type VerifyReport,
} from 'eventgraph-core';
import { presetsDirPath } from './presets.js';

export interface ReadToolsApi {
  eventgraph_query(input: { expr: string }): Promise<{ nodes: GraphNode[] }>;
  eventgraph_impact(input: { nodeId: string; depth?: number }): Promise<{
    direct: GraphNode[];
    transitive: GraphNode[];
    affectedContexts: string[];
    crossContext: boolean;
    totalAffected: number;
    risk: string;
  }>;
  eventgraph_get_node(input: { nodeId: string }): Promise<{ node: GraphNode | null }>;
  eventgraph_list_contexts(input: Record<string, never>): Promise<{ contexts: string[] }>;
  eventgraph_validate(input: Record<string, never>): Promise<{ valid: boolean; errors: Array<{ type: string; message: string }> }>;
  eventgraph_slice(input: { eventId: string }): Promise<Record<string, unknown>>;
  eventgraph_lifecycle(input: { aggregateId: string }): Promise<{ events: Array<{ id: string; label: string; endsLifecycle: boolean }> }>;
  eventgraph_check(input: { lane?: Lane; limit?: number }): Promise<{
    ok: boolean;
    nodes: number;
    remaining: number;
    findings: Finding[];
  }>;
  eventgraph_verify(input: { root?: string }): Promise<VerifyReport & { ok: boolean; sourceRoot: string; contract: ContractReport }>;
  eventgraph_scaffold(input: { root?: string; context?: string; only?: Extractor[] }): Promise<{
    scanned: number;
    /** The scaffolded context as YAML, ready for eventgraph_apply; null when nothing was recognised. */
    model: string | null;
    notes: string[];
    counts: ScaffoldReport['counts'] | null;
    unread: UnreadLanguage[];
  }>;
}

/**
 * Every tool reads the model from disk rather than closing over one loaded at
 * startup. A long-lived server that held the graph in memory could not see its
 * own writes — an agent adding a node and querying for it got the state from
 * before — and could not see edits made by the CLI in another terminal either.
 * The model is a handful of small YAML files, so re-reading is cheaper than
 * any scheme for deciding when the copy went stale.
 */
export function createReadTools(projectDir: string): ReadToolsApi {
  const open = () => loadProject(projectDir);
  // Source lives beside the eventgraph directory, so that is where a pointer
  // or a relative root is resolved from — not from wherever the server runs.
  const sourceRoot = (root?: string) => resolve(projectDir, '..', root ?? '.');

  return {
    async eventgraph_query({ expr }) {
      const nodes = new QueryEngine(open().graph).query(expr);
      return { nodes };
    },

    async eventgraph_impact({ nodeId, depth }) {
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
        risk: result.risk,
      };
    },

    async eventgraph_get_node({ nodeId }) {
      const node = open().graph.getNode(nodeId) ?? null;
      return { node };
    },

    async eventgraph_list_contexts() {
      return { contexts: open().graph.getContexts() };
    },

    /**
     * The swimlane around one event, rebuilt on demand. Asking for a part of
     * the model beats rendering all of it, which stops being readable within a
     * few dozen nodes.
     */
    async eventgraph_slice({ eventId }) {
      const s = slice(open().graph, eventId);
      const ids = (nodes: GraphNode[]) => nodes.map(n => `${n.context}.${n.id}`);
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

    async eventgraph_lifecycle({ aggregateId }) {
      return {
        events: lifecycle(open().graph, aggregateId).map(e => ({
          id: `${e.context}.${e.id}`,
          label: e.label,
          endsLifecycle: e.data?.ends_lifecycle === true,
        })),
      };
    },

    /**
     * Completeness gaps, most pressing first. This is the plan-forward loop an
     * agent drives: check what is missing, fill one gap, check again. `limit`
     * turns it into "what should I do next".
     */
    async eventgraph_check({ lane, limit } = {}) {
      const { config, graph } = open();
      const preset = loadPreset(config.preset, presetsDirPath());
      const all = checkGraph(graph, preset, { lane });
      const findings = limit && limit > 0 ? all.slice(0, limit) : all;
      return {
        ok: !all.some(f => f.severity === 'error'),
        nodes: graph.getAllNodes().length,
        remaining: all.length,
        findings,
      };
    },

    /**
     * The model against the code, which `check` cannot see: pointers that no
     * longer resolve, and callers that do not know a rejection they can get.
     */
    async eventgraph_verify({ root } = {}) {
      const { graph } = open();
      const from = sourceRoot(root);
      const report = verifyImplementations(graph, from);
      const contract = verifyRejectionHandling(graph, from);
      return { ok: report.issues.length + contract.issues.length === 0, sourceRoot: from, ...report, contract };
    },

    /**
     * A partial model read from source, returned rather than written: a guess
     * that lands in the project unseen is indistinguishable from a decision.
     * The agent reviews it and hands it to eventgraph_apply.
     */
    async eventgraph_scaffold({ root, context, only } = {}) {
      const from = sourceRoot(root);
      const sources = collectSources(from);
      const unread = unreadLanguages(from);
      if (sources.length === 0) {
        return { scanned: 0, model: null, notes: [`no source files scaffold can read under ${from}`], counts: null, unread };
      }
      const report = scaffold(sources, { context: context ?? 'core', only });
      return {
        scanned: sources.length,
        model: report.model.nodes.length > 0 ? stringifyContextModel(report.model) : null,
        notes: report.notes,
        counts: report.counts,
        unread,
      };
    },

    async eventgraph_validate() {
      const { config, graph } = open();
      const preset = loadPreset(config.preset, presetsDirPath());
      const errors = validateGraph(graph, preset);
      return {
        valid: errors.length === 0,
        errors: errors.map(e => ({ type: e.type, message: e.message })),
      };
    },
  };
}
