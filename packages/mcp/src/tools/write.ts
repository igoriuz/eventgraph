import {
  loadProject,
  removeNodeFromContext,
  generateYamlDiff,
  analyzeImpact,
  applyModels,
  loadPreset,
  parseContextModels,
  type ContextChange,
  type ContextModelNode,
  type GraphEdge,
} from 'eventgraph-core';
import { presetsDirPath } from './presets.js';

interface WriteResult {
  success: boolean;
  error?: string;
  pendingDiff?: string;
}

export interface WriteToolsApi {
  eventgraph_add_node(input: { context: string; id: string; type: string; label: string; data?: Record<string, unknown> }): Promise<ApplyResult>;
  eventgraph_add_edge(input: { context: string; from: string; to: string; type: string }): Promise<ApplyResult>;
  eventgraph_update_node(input: { nodeId: string; label?: string; data?: Record<string, unknown> }): Promise<WriteResult>;
  eventgraph_remove_node(input: { nodeId: string }): Promise<WriteResult>;
  eventgraph_apply(input: { model: string; replace?: boolean; dryRun?: boolean }): Promise<ApplyResult>;
}

interface ApplyResult extends WriteResult {
  dryRun?: boolean;
  /** Validation errors in the merged whole; nothing was written. */
  errors?: string[];
  changes?: Array<Omit<ContextChange, 'model'>>;
}

const describeChange = (c: Omit<ContextChange, 'model'>) =>
  `${c.context}: ` +
  [
    `${c.nodesAdded} node(s) added`,
    c.nodesReplaced > 0 ? `${c.nodesReplaced} replaced` : '',
    `${c.edgesAdded} edge(s) added`,
    c.isNew ? 'new context' : '',
  ]
    .filter(Boolean)
    .join(', ');

/**
 * Reads the project per call for the same reason the read tools do: a write
 * lands on disk, and anything holding a graph from startup would keep answering
 * from before it. `agent.write` is read fresh too, so changing the mode in
 * eventgraph.yaml takes effect without restarting the server.
 */
export function createWriteTools(projectDir: string): WriteToolsApi {
  const open = () => loadProject(projectDir);
  const writeMode = () => open().config.agent.write;

  const unknownContext = (context: string, known: string[]): WriteResult => ({
    success: false,
    error: `Context "${context}" not found. Available: ${known.join(', ')}`,
  });

  /**
   * A single edit is a batch of one: it goes through the same merge and the
   * same validation of the whole as eventgraph_apply, and is written only in
   * auto mode. Returns the refusal when the result would be invalid.
   */
  const invalid = (
    context: string,
    change: { nodes?: ContextModelNode[]; edges?: GraphEdge[] },
    mode: string,
  ): ApplyResult | undefined => {
    const preset = loadPreset(open().config.preset, presetsDirPath());
    const outcome = applyModels(
      projectDir,
      [{ context, nodes: change.nodes ?? [], edges: change.edges ?? [] }],
      preset,
      { dryRun: mode !== 'auto' },
    );
    return outcome.status === 'invalid'
      ? { success: false, errors: outcome.errors.map(e => `[${e.type}] ${e.message}`) }
      : undefined;
  };

  return {
    async eventgraph_add_node({ context, id, type, label, data }) {
      const mode = writeMode();
      if (mode === 'locked') {
        return { success: false, error: 'Write mode is locked. Agent cannot modify the model.' };
      }

      const node = { id, type, label, ...(data ? { data } : {}) };
      const { config, graph } = open();
      if (!config.contexts.includes(context)) return unknownContext(context, config.contexts);
      if (graph.getNode(`${context}.${id}`)) {
        return { success: false, error: `Node ${context}.${id} already exists. To change it, pass the whole node to eventgraph_apply.` };
      }

      const refused = invalid(context, { nodes: [node] }, mode);
      if (refused) return refused;
      if (mode === 'prompt') {
        return { success: false, pendingDiff: generateYamlDiff(projectDir, context, { addNodes: [node] }) };
      }
      return { success: true };
    },

    async eventgraph_add_edge({ context, from, to, type }) {
      const mode = writeMode();
      if (mode === 'locked') {
        return { success: false, error: 'Write mode is locked. Agent cannot modify the model.' };
      }

      const edge = { from, to, type };
      const { config } = open();
      if (!config.contexts.includes(context)) return unknownContext(context, config.contexts);

      const refused = invalid(context, { edges: [edge] }, mode);
      if (refused) return refused;
      if (mode === 'prompt') {
        return { success: false, pendingDiff: generateYamlDiff(projectDir, context, { addEdges: [edge] }) };
      }
      return { success: true };
    },

    async eventgraph_update_node({ nodeId: _nodeId }) {
      if (writeMode() === 'locked') {
        return { success: false, error: 'Write mode is locked. Agent cannot modify the model.' };
      }
      return { success: false, error: 'Update not yet implemented in MVP' };
    },

    /**
     * The bulk write: a whole context, or several, in one call. Validated as a
     * merged whole before anything is written, so a bad batch changes nothing.
     */
    async eventgraph_apply({ model, replace, dryRun }) {
      const mode = writeMode();
      if (mode === 'locked') {
        return { success: false, error: 'Write mode is locked. Agent cannot modify the model.' };
      }

      let incoming;
      try {
        incoming = parseContextModels(model);
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }

      // In prompt mode the agent may plan but not write, whatever it asked for.
      const planOnly = dryRun === true || mode === 'prompt';
      const preset = loadPreset(open().config.preset, presetsDirPath());
      const outcome = applyModels(projectDir, incoming, preset, { replace, dryRun: planOnly });
      if (outcome.status === 'invalid') {
        return { success: false, errors: outcome.errors.map(e => `[${e.type}] ${e.message}`) };
      }

      const changes = outcome.changes.map(({ model: _model, ...rest }) => rest);
      if (mode === 'prompt') {
        return { success: false, pendingDiff: `Would apply ${changes.length} context(s):\n${changes.map(c => `  ${describeChange(c)}`).join('\n')}`, changes };
      }
      return { success: true, dryRun: planOnly, changes };
    },

    async eventgraph_remove_node({ nodeId }) {
      const { graph } = open();
      const mode = writeMode();
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
