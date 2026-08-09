import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWriteTools } from '../tools/write.js';
import { createReadTools } from '../tools/read.js';
import { parse as parseYaml } from 'yaml';

const TMP = join(tmpdir(), 'eventgraph-write-test-' + Date.now());

function setupTestProject() {
  const egDir = join(TMP, 'eventgraph');
  mkdirSync(join(egDir, 'contexts', 'payments'), { recursive: true });
  writeFileSync(join(egDir, 'eventgraph.yaml'), `
name: test
version: 1
preset: event-modeling
agent:
  write: auto
contexts:
  - payments
`);
  writeFileSync(join(egDir, 'contexts', 'payments', 'model.yaml'), `
context: payments
nodes:
  place-order: { type: command }
edges: {}
`);
  return egDir;
}

describe('MCP write tools', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = setupTestProject();
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('adds a node in auto mode', async () => {
    const tools = createWriteTools(projectDir);

    const result = await tools.eventgraph_add_node({
      context: 'payments',
      id: 'order-placed',
      type: 'event',
      label: 'Order Placed',
    });
    expect(result.success).toBe(true);

    const content = readFileSync(join(projectDir, 'contexts', 'payments', 'model.yaml'), 'utf-8');
    const model = parseYaml(content);
    expect(Object.keys(model.nodes)).toEqual(['place-order', 'order-placed']);
  });

  it('returns diff in prompt mode', async () => {
    const egDir = join(TMP, 'eventgraph');
    writeFileSync(join(egDir, 'eventgraph.yaml'), `
name: test
version: 1
preset: event-modeling
agent:
  write: prompt
contexts:
  - payments
`);
    const tools = createWriteTools(egDir);

    const result = await tools.eventgraph_add_node({
      context: 'payments',
      id: 'order-placed',
      type: 'event',
      label: 'Order Placed',
    });
    expect(result.success).toBe(false);
    expect(result.pendingDiff).toBeDefined();
    expect(result.pendingDiff).toContain('order-placed');
  });

  it('rejects writes in locked mode', async () => {
    const egDir = join(TMP, 'eventgraph');
    writeFileSync(join(egDir, 'eventgraph.yaml'), `
name: test
version: 1
preset: event-modeling
agent:
  write: locked
contexts:
  - payments
`);
    const tools = createWriteTools(egDir);

    const result = await tools.eventgraph_add_node({
      context: 'payments',
      id: 'order-placed',
      type: 'event',
      label: 'Order Placed',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('locked');
  });
});

/**
 * The server is long-lived: an agent calls it many times over one process.
 * These cover the state it used to carry across those calls.
 */
describe('a write is visible to the next call', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = setupTestProject();
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('lets a read tool see a node the write tool just added', async () => {
    const write = createWriteTools(projectDir);
    const read = createReadTools(projectDir);

    // Read first, so any cached graph would be the one without the node.
    expect((await read.eventgraph_query({ expr: 'type:event' })).nodes).toHaveLength(0);

    await write.eventgraph_add_node({
      context: 'payments',
      id: 'order-placed',
      type: 'event',
      label: 'Order Placed',
    });

    const found = await read.eventgraph_query({ expr: 'type:event' });
    expect(found.nodes.map(n => n.id)).toEqual(['order-placed']);
    expect((await read.eventgraph_get_node({ nodeId: 'payments.order-placed' })).node).not.toBeNull();
  });

  it('sees a node written to the files by anything else', async () => {
    const read = createReadTools(projectDir);
    expect((await read.eventgraph_query({ expr: 'type:aggregate' })).nodes).toHaveLength(0);

    // Stands in for the CLI editing the model in another terminal.
    writeFileSync(
      join(projectDir, 'contexts', 'payments', 'model.yaml'),
      'context: payments\nnodes:\n  order: { type: aggregate }\nedges: {}\n'
    );

    const found = await read.eventgraph_query({ expr: 'type:aggregate' });
    expect(found.nodes.map(n => n.id)).toEqual(['order']);
  });

  it('picks up a change to agent.write without a restart', async () => {
    const write = createWriteTools(projectDir);

    writeFileSync(
      join(projectDir, 'eventgraph.yaml'),
      'name: test\nversion: 1\npreset: event-modeling\nagent:\n  write: locked\ncontexts:\n  - payments\n'
    );

    const result = await write.eventgraph_add_node({
      context: 'payments',
      id: 'order-placed',
      type: 'event',
      label: 'Order Placed',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/locked/);
  });
});
