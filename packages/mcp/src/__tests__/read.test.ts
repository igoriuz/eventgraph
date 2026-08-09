import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createReadTools } from '../tools/read.js';

const TMP = join(tmpdir(), 'eventgraph-mcp-test-' + Date.now());

function setupTestProject() {
  const egDir = join(TMP, 'eventgraph');
  mkdirSync(join(egDir, 'contexts', 'payments'), { recursive: true });
  writeFileSync(join(egDir, 'eventgraph.yaml'), `
name: test
version: 1
preset: event-modeling
agent:
  write: prompt
contexts:
  - payments
`);
  writeFileSync(join(egDir, 'contexts', 'payments', 'model.yaml'), `
context: payments
nodes:
  - id: place-order
    type: command
    label: Place Order
  - id: order-placed
    type: event
    label: Order Placed
  - id: order-summary
    type: read-model
    label: Order Summary
edges:
  - from: place-order
    to: order-placed
    type: produces
  - from: order-placed
    to: order-summary
    type: projects-to
`);
  return egDir;
}

describe('MCP read tools', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = setupTestProject();
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('eventgraph_query returns matching nodes', async () => {
    const tools = createReadTools(projectDir);

    const result = await tools.eventgraph_query({ expr: 'type:event' });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe('order-placed');
  });

  it('eventgraph_impact returns impact analysis', async () => {
    const tools = createReadTools(projectDir);

    const result = await tools.eventgraph_impact({ nodeId: 'order-placed' });
    expect(result.totalAffected).toBe(1);
    expect(result.risk).toBe('low');
  });

  it('eventgraph_get_node returns a single node', async () => {
    const tools = createReadTools(projectDir);

    const result = await tools.eventgraph_get_node({ nodeId: 'payments.place-order' });
    expect(result.node?.label).toBe('Place Order');
  });

  it('eventgraph_list_contexts returns all contexts', async () => {
    const tools = createReadTools(projectDir);

    const result = await tools.eventgraph_list_contexts({});
    expect(result.contexts).toEqual(['payments']);
  });

  it('eventgraph_validate returns validation result', async () => {
    const tools = createReadTools(projectDir);

    const result = await tools.eventgraph_validate({});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
