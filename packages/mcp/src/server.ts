#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { findProjectDir, loadProject } from 'eventgraph-core';
import { createReadTools } from './tools/read.js';
import { createWriteTools } from './tools/write.js';
import { createMetaTools } from './tools/meta.js';

const projectDir = findProjectDir();
if (!projectDir) {
  console.error('Error: No eventgraph project found.');
  process.exit(1);
}

// Loaded once here only to fail fast on a broken model; the tools read the
// project themselves on every call so none of them can answer from a stale copy.
loadProject(projectDir);

const readTools = createReadTools(projectDir);
const writeTools = createWriteTools(projectDir);
const metaTools = createMetaTools(projectDir);

const server = new McpServer({
  name: 'eventgraph',
  version: '0.2.0',
});

server.tool(
  'eventgraph_query',
  'Query the architecture graph. Examples: "type:event", "context:payments", "downstream:order-placed"',
  { expr: z.string().describe('Query expression') },
  async ({ expr }) => {
    const result = await readTools.eventgraph_query({ expr });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_impact',
  'Analyze impact: what is affected if this node changes?',
  {
    nodeId: z.string().describe('Node ID (e.g., order-placed or payments.order-placed)'),
    depth: z.number().optional().describe('Max traversal depth'),
  },
  async ({ nodeId, depth }) => {
    const result = await readTools.eventgraph_impact({ nodeId, depth });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_get_node',
  'Get details for a single node',
  { nodeId: z.string().describe('Qualified node ID (e.g., payments.order-placed)') },
  async ({ nodeId }) => {
    const result = await readTools.eventgraph_get_node({ nodeId });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_list_contexts',
  'List all bounded contexts in the project',
  {},
  async () => {
    const result = await readTools.eventgraph_list_contexts({});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_validate',
  'Validate the model against preset rules',
  {},
  async () => {
    const result = await readTools.eventgraph_validate({});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_slice',
  'Rebuild the swimlane around one event: who triggers it, which command produces it, what projects from it and where that is shown. Prefer this over reading the whole graph.',
  { eventId: z.string().describe('Event id, qualified or bare') },
  async (input) => {
    const result = await readTools.eventgraph_slice(input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_lifecycle',
  "List an aggregate's events, the one that ends its life last",
  { aggregateId: z.string().describe('Aggregate id, qualified or bare') },
  async (input) => {
    const result = await readTools.eventgraph_lifecycle(input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_check',
  'Find completeness gaps in the graph — what is missing, not just whether the shape is valid. Use limit to get the most pressing gaps to work on next (the CLI calls this check --next).',
  {
    lane: z
      .enum(['bootstrap', 'structure', 'ux', 'backend', 'parity', 'platform'])
      .optional()
      .describe('Restrict to one lane of rules'),
    limit: z.number().optional().describe('Return only the N most pressing gaps'),
  },
  async (input) => {
    const result = await readTools.eventgraph_check(input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_add_node',
  'Add a node to the architecture graph',
  {
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
  async (input) => {
    const result = await writeTools.eventgraph_add_node(input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_add_edge',
  'Create an edge between two nodes',
  {
    context: z.string().describe('Context to add the edge to'),
    from: z.string().describe('Source node ID'),
    to: z.string().describe('Target node ID'),
    type: z.string().describe('Edge type (produces, projects-to, triggers, reads, depends-on)'),
  },
  async (input) => {
    const result = await writeTools.eventgraph_add_edge(input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_remove_node',
  'Remove a node (shows impact warning first)',
  { nodeId: z.string().describe('Qualified node ID to remove') },
  async (input) => {
    const result = await writeTools.eventgraph_remove_node(input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_apply',
  'Merge a whole context model (or several, separated by ---) into the project in one call. The merged result is validated first; on any error nothing is written. Prefer this over many add_node/add_edge calls.',
  {
    model: z
      .string()
      .describe(
        'YAML in the compact form: context: <name>, nodes: { <id>: { type, label?, src?, <flags> } }, edges: { <edge-type>: { <from>: [<to>, ...] } }',
      ),
    replace: z.boolean().optional().describe('Replace the named contexts instead of merging into them'),
    dryRun: z.boolean().optional().describe('Report what would change without writing'),
  },
  async (input) => {
    const result = await writeTools.eventgraph_apply(input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_verify',
  'Check the model against the code: source pointers that no longer resolve, and callers that do not handle a rejection code a command can answer with.',
  {
    root: z.string().optional().describe('Where source pointers resolve from, relative to the directory holding eventgraph/ (default: that directory)'),
  },
  async (input) => {
    const result = await readTools.eventgraph_verify(input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_scaffold',
  'Extract a partial model from source: surfaces, navigation, aggregates, and declared commands and events. Returns YAML to review and pass to eventgraph_apply; writes nothing. Reads TypeScript, JavaScript, Dart and Prisma only, and names the languages it walked past.',
  {
    root: z.string().optional().describe('Directory to scan, relative to the directory holding eventgraph/ (default: that directory)'),
    context: z.string().optional().describe('Context name for the returned model (default: core)'),
    only: z
      .array(z.enum(['endpoints', 'headless', 'screens', 'aggregates', 'domain']))
      .optional()
      .describe('Limit the extractors'),
  },
  async (input) => {
    const result = await readTools.eventgraph_scaffold(input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_view',
  'Generate the HTML viewer',
  {},
  async () => {
    const result = await metaTools.eventgraph_view({});
    return { content: [{ type: 'text', text: `Viewer generated at: ${result.path}` }] };
  },
);

server.tool(
  'eventgraph_init_context',
  'Create a new bounded context',
  { name: z.string().describe('Context name') },
  async (input) => {
    const result = await metaTools.eventgraph_init_context(input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
