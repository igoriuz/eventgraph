import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWriteTools } from '../tools/write.js';
import { loadProject } from 'eventgraph-core';
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
    const { config, graph } = loadProject(projectDir);
    const tools = createWriteTools(graph, config, projectDir);

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
    const { config, graph } = loadProject(egDir);
    const tools = createWriteTools(graph, config, egDir);

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
    const { config, graph } = loadProject(egDir);
    const tools = createWriteTools(graph, config, egDir);

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
