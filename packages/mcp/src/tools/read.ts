import { join } from 'node:path';
import {
  type EventGraph,
  type ProjectConfig,
  type GraphNode,
  QueryEngine,
  analyzeImpact,
  validateGraph,
  loadPreset,
  checkGraph,
  type Finding,
  type Lane,
} from '@eventgraph/core';

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
  eventgraph_check(input: { lane?: Lane; limit?: number }): Promise<{
    ok: boolean;
    nodes: number;
    remaining: number;
    findings: Finding[];
  }>;
}

/** Repo-relative presets directory, shared by validate and check. */
function presetsDirPath(): string {
  return join(import.meta.dirname, '..', '..', '..', '..', 'presets');
}

export function createReadTools(graph: EventGraph, config: ProjectConfig, _projectDir: string): ReadToolsApi {
  const queryEngine = new QueryEngine(graph);

  return {
    async eventgraph_query({ expr }) {
      const nodes = queryEngine.query(expr);
      return { nodes };
    },

    async eventgraph_impact({ nodeId, depth }) {
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
      const node = graph.getNode(nodeId) ?? null;
      return { node };
    },

    async eventgraph_list_contexts() {
      return { contexts: graph.getContexts() };
    },

    /**
     * Completeness gaps, most pressing first. This is the plan-forward loop an
     * agent drives: check what is missing, fill one gap, check again. `limit`
     * turns it into "what should I do next".
     */
    async eventgraph_check({ lane, limit } = {}) {
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
      const preset = loadPreset(config.preset, presetsDirPath());
      const errors = validateGraph(graph, preset);
      return {
        valid: errors.length === 0,
        errors: errors.map(e => ({ type: e.type, message: e.message })),
      };
    },
  };
}
