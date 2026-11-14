import { z } from 'zod';
import {
  loadProject,
  removeNodeFromContext,
  generateYamlDiff,
  analyzeImpact,
  applyModels,
  loadPreset,
  parseContextModels,
  type ContextChange,
  type ContextModel,
  type DiffChanges,
} from 'eventgraph-core';
import { tool } from './define.js';
import { presetsDirPath } from './presets.js';

type Change = Omit<ContextChange, 'model'>;

/**
 * What became of a write.
 *
 * - `applied` — written.
 * - `planned` — a dry run the agent asked for; it would have been written.
 * - `proposed` — the project's write mode is `prompt`, so the change is shown
 *   and left for a person to make.
 * - `refused` — not attempted: the mode is `locked`, or the request names
 *   something that is not there, or already is.
 * - `invalid` — the model would not be valid afterwards; nothing was written.
 */
export type WriteResult =
  | { status: 'applied'; changes?: Change[] }
  | { status: 'planned'; changes: Change[] }
  | { status: 'proposed'; pendingDiff: string; changes?: Change[] }
  | { status: 'refused'; error: string }
  | { status: 'invalid'; errors: string[] };

const describeChange = (c: Change) =>
  `${c.context}: ` +
  [
    `${c.nodesAdded} node(s) added`,
    c.nodesReplaced > 0 ? `${c.nodesReplaced} replaced` : '',
    `${c.edgesAdded} edge(s) added`,
    c.isNew ? 'new context' : '',
  ]
    .filter(Boolean)
    .join(', ');

const refused = (error: string): WriteResult => ({ status: 'refused', error });

/**
 * Reads the project per call for the same reason the read tools do: a write
 * lands on disk, and anything holding a graph from startup would keep answering
 * from before it. `agent.write` is read fresh too, so changing the mode in
 * eventgraph.yaml takes effect without restarting the server.
 */
export function createWriteTools(projectDir: string) {
  const open = () => loadProject(projectDir);

  /**
   * Every write passes through here, so the write mode is asked in one place:
   * `locked` never reaches the tool, and the tool is told whether it may write
   * (`auto`) or only show what it would do (`prompt`).
   */
  const write =
    <Input>(perform: (input: Input, mode: 'auto' | 'prompt') => WriteResult) =>
    async (input: Input): Promise<WriteResult> => {
      const mode = open().config.agent.write;
      return mode === 'locked' ? refused('Write mode is locked. Agent cannot modify the model.') : perform(input, mode);
    };

  /**
   * Merges models into the project and validates the whole first — the one
   * path every addition takes, a single node as much as a whole context.
   * `show` renders the proposal for prompt mode.
   */
  const apply = (
    models: ContextModel[],
    options: { replace?: boolean; planOnly: boolean },
    mode: 'auto' | 'prompt',
    show: (changes: Change[]) => string,
  ): WriteResult => {
    const preset = loadPreset(open().config.preset, presetsDirPath());
    const outcome = applyModels(projectDir, models, preset, {
      replace: options.replace,
      // In prompt mode the agent may plan but not write, whatever it asked for.
      dryRun: options.planOnly || mode === 'prompt',
    });
    if (outcome.status === 'invalid') {
      return { status: 'invalid', errors: outcome.errors.map(e => `[${e.type}] ${e.message}`) };
    }

    const changes = outcome.changes.map(({ model: _model, ...rest }) => rest);
    if (mode === 'prompt') return { status: 'proposed', pendingDiff: show(changes), changes };
    return { status: outcome.status, changes };
  };

  /** A single edit: a batch of one, proposed as a diff of the file it touches. */
  const edit = (context: string, change: Pick<DiffChanges, 'addNodes' | 'addEdges'>, mode: 'auto' | 'prompt'): WriteResult => {
    const known = open().config.contexts;
    if (!known.includes(context)) return refused(`Context "${context}" not found. Available: ${known.join(', ')}`);
    return apply(
      [{ context, nodes: change.addNodes ?? [], edges: change.addEdges ?? [] }],
      { planOnly: false },
      mode,
      () => generateYamlDiff(projectDir, context, change),
    );
  };

  return {
    /**
     * The bulk write: a whole context, or several, in one call. Validated as a
     * merged whole before anything is written, so a bad batch changes nothing.
     */
    eventgraph_apply: tool({
      description:
        'Merge a whole context model (or several, separated by ---) into the project in one call. The merged result is validated first; on any error nothing is written. Prefer this over many add_node/add_edge calls.',
      input: {
        model: z
          .string()
          .describe(
            'YAML in the compact form: context: <name>, nodes: { <id>: { type, label?, src?, <flags> } }, edges: { <edge-type>: { <from>: [<to>, ...] } }',
          ),
        replace: z.boolean().optional().describe('Replace the named contexts instead of merging into them'),
        dryRun: z.boolean().optional().describe('Report what would change without writing'),
      },
      run: write(({ model, replace, dryRun }, mode) => {
        let incoming: ContextModel[];
        try {
          incoming = parseContextModels(model);
        } catch (error) {
          return refused((error as Error).message);
        }
        return apply(
          incoming,
          { replace, planOnly: dryRun === true },
          mode,
          changes => `Would apply ${changes.length} context(s):\n${changes.map(c => `  ${describeChange(c)}`).join('\n')}`,
        );
      }),
    }),

    eventgraph_add_node: tool({
      description: 'Add one node to the architecture graph. For more than a few, or to change an existing node, use eventgraph_apply.',
      input: {
        context: z.string().describe('Bounded context name'),
        id: z.string().describe('Node ID (kebab-case)'),
        type: z.string().describe('Node type (command, event, read-model, etc.)'),
        label: z.string().describe('Human-readable label'),
        data: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'Semantic flags, e.g. { entry: true } or { detail: true } on a screen, { kind: "endpoint" }, { triggered_by: "<what>" } on a command, { terminal: "<reason>" } on an event',
          ),
      },
      run: write(({ context, id, type, label, data }, mode) => {
        if (open().graph.getNode(`${context}.${id}`)) {
          return refused(`Node ${context}.${id} already exists. To change it, pass the whole node to eventgraph_apply.`);
        }
        return edit(context, { addNodes: [{ id, type, label, ...(data ? { data } : {}) }] }, mode);
      }),
    }),

    eventgraph_add_edge: tool({
      description: 'Create an edge between two nodes',
      input: {
        context: z.string().describe('Context to add the edge to'),
        from: z.string().describe('Source node ID'),
        to: z.string().describe('Target node ID'),
        type: z.string().describe('Edge type (produces, projects-to, triggers, reads, offers, …)'),
      },
      run: write(({ context, from, to, type }, mode) => edit(context, { addEdges: [{ from, to, type }] }, mode)),
    }),

    eventgraph_remove_node: tool({
      description: 'Remove a node (shows impact warning first)',
      input: { nodeId: z.string().describe('Qualified node ID to remove') },
      run: write(({ nodeId }, mode) => {
        const { graph } = open();
        const node = graph.getNode(nodeId);
        if (!node) return refused(`Node not found: ${nodeId}`);

        if (mode === 'prompt') {
          const impact = analyzeImpact(graph, nodeId);
          const warning = `Removing ${nodeId} affects ${impact.totalAffected} downstream nodes (risk: ${impact.risk})`;
          const diff = generateYamlDiff(projectDir, node.context, { removeNodes: [node.id] });
          return { status: 'proposed', pendingDiff: `${warning}\n\n${diff}` };
        }

        removeNodeFromContext(projectDir, node.context, node.id);
        return { status: 'applied' };
      }),
    }),

    /**
     * Goes through the same apply as a model does, so the name is checked and
     * an existing context is never replaced by an empty one.
     */
    eventgraph_init_context: tool({
      description: 'Create a new bounded context',
      input: { name: z.string().describe('Context name: letters, digits, "-" and "_"') },
      run: write(({ name }, mode) => {
        if (open().config.contexts.includes(name)) return refused(`Context "${name}" already exists.`);
        return apply([{ context: name, nodes: [], edges: [] }], { planOnly: false }, mode, () => `Would create context "${name}".`);
      }),
    }),
  };
}
