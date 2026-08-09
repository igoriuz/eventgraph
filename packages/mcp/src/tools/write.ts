import {
  type EventGraph,
  type ProjectConfig,
  addNodeToContext,
  addEdgeToContext,
  removeNodeFromContext,
  generateYamlDiff,
  analyzeImpact,
} from 'eventgraph-core';

interface WriteResult {
  success: boolean;
  error?: string;
  pendingDiff?: string;
}

export interface WriteToolsApi {
  eventgraph_add_node(input: { context: string; id: string; type: string; label: string; data?: Record<string, unknown> }): Promise<WriteResult>;
  eventgraph_add_edge(input: { context: string; from: string; to: string; type: string }): Promise<WriteResult>;
  eventgraph_update_node(input: { nodeId: string; label?: string; data?: Record<string, unknown> }): Promise<WriteResult>;
  eventgraph_remove_node(input: { nodeId: string }): Promise<WriteResult>;
}

export function createWriteTools(graph: EventGraph, config: ProjectConfig, projectDir: string): WriteToolsApi {
  const mode = config.agent.write;

  return {
    async eventgraph_add_node({ context, id, type, label, data }) {
      if (mode === 'locked') {
        return { success: false, error: 'Write mode is locked. Agent cannot modify the model.' };
      }

      const node = { id, type, label, ...(data ? { data } : {}) };

      if (mode === 'prompt') {
        const diff = generateYamlDiff(projectDir, context, { addNodes: [node] });
        return { success: false, pendingDiff: diff };
      }

      addNodeToContext(projectDir, context, node);
      return { success: true };
    },

    async eventgraph_add_edge({ context, from, to, type }) {
      if (mode === 'locked') {
        return { success: false, error: 'Write mode is locked. Agent cannot modify the model.' };
      }

      const edge = { from, to, type };

      if (mode === 'prompt') {
        const diff = generateYamlDiff(projectDir, context, { addEdges: [edge] });
        return { success: false, pendingDiff: diff };
      }

      addEdgeToContext(projectDir, context, edge);
      return { success: true };
    },

    async eventgraph_update_node({ nodeId: _nodeId }) {
      if (mode === 'locked') {
        return { success: false, error: 'Write mode is locked. Agent cannot modify the model.' };
      }
      return { success: false, error: 'Update not yet implemented in MVP' };
    },

    async eventgraph_remove_node({ nodeId }) {
      if (mode === 'locked') {
        return { success: false, error: 'Write mode is locked. Agent cannot modify the model.' };
      }

      const node = graph.getNode(nodeId);
      if (!node) {
        return { success: false, error: `Node not found: ${nodeId}` };
      }

      const impact = analyzeImpact(graph, nodeId);
      const warning = `Removing ${nodeId} affects ${impact.totalAffected} downstream nodes (risk: ${impact.risk})`;

      if (mode === 'prompt') {
        const diff = generateYamlDiff(projectDir, node.context, { removeNodes: [node.id] });
        return { success: false, pendingDiff: `${warning}\n\n${diff}` };
      }

      removeNodeFromContext(projectDir, node.context, node.id);
      return { success: true };
    },
  };
}
