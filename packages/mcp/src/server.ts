#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { findProjectDir, loadProject } from 'eventgraph-core';
import { createReadTools } from './tools/read.js';
import { createWriteTools } from './tools/write.js';
import { createMetaTools } from './tools/meta.js';
import type { Tool } from './tools/define.js';

const projectDir = findProjectDir();
if (!projectDir) {
  console.error('Error: No eventgraph project found.');
  process.exit(1);
}

// Loaded once here only to fail fast on a broken model; the tools read the
// project themselves on every call so none of them can answer from a stale copy.
loadProject(projectDir);

const server = new McpServer({
  name: 'eventgraph',
  version: '0.2.0',
});

// Each tool carries its own description and input schema, so registering is
// the same three lines for all of them and there is no second list to keep.
const tools: Record<string, Tool> = {
  ...createReadTools(projectDir),
  ...createWriteTools(projectDir),
  ...createMetaTools(projectDir),
} as unknown as Record<string, Tool>;

for (const [name, definition] of Object.entries(tools)) {
  server.tool(name, definition.description, definition.input, async input => ({
    content: [{ type: 'text', text: JSON.stringify(await definition.run(input), null, 2) }],
  }));
}

const transport = new StdioServerTransport();
await server.connect(transport);
