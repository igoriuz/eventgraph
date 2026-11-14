import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { parse as parseYaml } from 'yaml';

// The built server, as an agent runs it — so this needs `pnpm build` first.
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'server.js');

/**
 * The tool functions are tested directly elsewhere. These tests go through the
 * protocol, because the input schema registered with the server decides what
 * an agent can actually send — a parameter missing there is dropped silently.
 */
describe('MCP server over stdio', () => {
  let dir: string;
  let client: Client;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'eventgraph-server-test-'));
    const eg = join(dir, 'eventgraph');
    mkdirSync(join(eg, 'contexts', 'app'), { recursive: true });
    writeFileSync(
      join(eg, 'eventgraph.yaml'),
      'name: test\nversion: 1\npreset: event-modeling\nagent:\n  write: auto\ncontexts:\n  - app\n'
    );
    writeFileSync(join(eg, 'contexts', 'app', 'model.yaml'), 'context: app\nnodes: {}\nedges: {}\n');

    client = new Client({ name: 'test', version: '0' });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [SERVER], cwd: dir })
    );
  });

  afterEach(async () => {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('offers what the CLI offers', async () => {
    const names = (await client.listTools()).tools.map(t => t.name);
    for (const tool of ['eventgraph_apply', 'eventgraph_verify', 'eventgraph_scaffold', 'eventgraph_check']) {
      expect(names).toContain(tool);
    }
  });

  it('eventgraph_apply takes a model and its options through the protocol', async () => {
    const result = await client.callTool({
      name: 'eventgraph_apply',
      arguments: { model: 'context: app\nnodes:\n  home: { type: screen, entry: true }\nedges: {}\n', dryRun: true },
    });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(JSON.parse(text)).toMatchObject({ success: true, dryRun: true, changes: [{ context: 'app', nodesAdded: 1 }] });
    expect(readFileSync(join(dir, 'eventgraph', 'contexts', 'app', 'model.yaml'), 'utf8')).not.toContain('home');
  });

  it('eventgraph_add_node passes semantic flags through', async () => {
    await client.callTool({
      name: 'eventgraph_add_node',
      arguments: { context: 'app', id: 'home', type: 'screen', label: 'Home', data: { entry: true } },
    });
    const model = parseYaml(readFileSync(join(dir, 'eventgraph', 'contexts', 'app', 'model.yaml'), 'utf8'));
    expect(model.nodes.home).toMatchObject({ type: 'screen', entry: true });
  });
});
