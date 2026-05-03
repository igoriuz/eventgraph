#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { findProjectDir, loadProject } from '@eventgraph/core';
import { createReadTools } from './tools/read.js';
import { createWriteTools } from './tools/write.js';
import { createMetaTools } from './tools/meta.js';

const projectDir = findProjectDir();
if (!projectDir) {
  console.error('Error: No eventgraph project found.');
  process.exit(1);
}

const { config, graph } = loadProject(projectDir);
const readTools = createReadTools(graph, config, projectDir);
const writeTools = createWriteTools(graph, config, projectDir);
const metaTools = createMetaTools(graph, config, projectDir);

const server = new McpServer({
  name: 'eventgraph',
  version: '0.1.0',
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
  'eventgraph_add_node',
  'Add a node to the architecture graph',
  {
    context: z.string().describe('Bounded context name'),
    id: z.string().describe('Node ID (kebab-case)'),
    type: z.string().describe('Node type (command, event, read-model, etc.)'),
    label: z.string().describe('Human-readable label'),
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
