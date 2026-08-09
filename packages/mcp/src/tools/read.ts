import { join } from 'node:path';
import { existsSync } from 'node:fs';
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
  type Finding,
  type Lane,
} from 'eventgraph-core';

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
}

/** See the CLI's presetsDir: bundled beside the output once published. */
function presetsDirPath(): string {
  const candidates = [
    join(import.meta.dirname, 'presets'),
    join(import.meta.dirname, '..', 'presets'),
    join(import.meta.dirname, '..', '..', 'presets'),
    join(import.meta.dirname, '..', '..', '..', '..', 'presets'),
  ];
  return candidates.find(existsSync) ?? candidates[candidates.length - 1]!;
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
