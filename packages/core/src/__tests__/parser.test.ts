import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadProject, loadContext, loadConfig } from '../parser.js';

const TMP = join(tmpdir(), 'eventgraph-test-' + Date.now());

function setupProject(config: string, contexts: Record<string, string>) {
  const egDir = join(TMP, 'eventgraph');
  mkdirSync(join(egDir, 'contexts'), { recursive: true });
  writeFileSync(join(egDir, 'eventgraph.yaml'), config);

  for (const [name, content] of Object.entries(contexts)) {
    mkdirSync(join(egDir, 'contexts', name), { recursive: true });
    writeFileSync(join(egDir, 'contexts', name, 'model.yaml'), content);
  }
  return egDir;
}

describe('parser', () => {
  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('loads a project config', () => {
    const dir = setupProject(`
name: test-project
version: 1
preset: event-modeling
agent:
  write: prompt
contexts:
  - payments
`, { payments: `
context: payments
nodes: []
edges: []
` });

    const config = loadConfig(dir);
    expect(config.name).toBe('test-project');
    expect(config.preset).toBe('event-modeling');
    expect(config.agent.write).toBe('prompt');
    expect(config.contexts).toEqual(['payments']);
  });

  it('loads a context model into a graph', () => {
    const dir = setupProject(`
name: test
version: 1
preset: event-modeling
agent:
  write: auto
contexts:
  - payments
`, { payments: `
context: payments
nodes:
  - id: place-order
    type: command
    label: Place Order
    data:
      fields: [orderId, total]
  - id: order-placed
    type: event
    label: Order Placed
edges:
  - from: place-order
    to: order-placed
    type: produces
` });

    const graph = loadContext(dir, 'payments');
    expect(graph.getAllNodes()).toHaveLength(2);
    expect(graph.getNode('payments.place-order')?.label).toBe('Place Order');
    expect(graph.getNode('payments.place-order')?.data?.fields).toEqual(['orderId', 'total']);
    expect(graph.getAllEdges()).toHaveLength(1);
    expect(graph.getAllEdges()[0].from).toBe('payments.place-order');
  });

  it('loads full project with cross-context edges', () => {
    const dir = setupProject(`
name: test
version: 1
preset: event-modeling
agent:
  write: prompt
contexts:
  - payments
  - shipping
`, {
      payments: `
context: payments
nodes:
  - id: order-placed
    type: event
    label: Order Placed
edges:
  - from: order-placed
    to: shipping.start-fulfillment
    type: triggers
`,
      shipping: `
context: shipping
nodes:
  - id: start-fulfillment
    type: policy
    label: Start Fulfillment
edges: []
`,
    });

    const { config, graph } = loadProject(dir);
    expect(config.name).toBe('test');
    expect(graph.getAllNodes()).toHaveLength(2);
    expect(graph.getContexts().sort()).toEqual(['payments', 'shipping']);

    const downstream = graph.getDownstream('payments.order-placed');
    expect(downstream).toHaveLength(1);
    expect(downstream[0].context).toBe('shipping');
  });

  it('throws on missing eventgraph.yaml', () => {
    mkdirSync(join(TMP, 'eventgraph'), { recursive: true });
    expect(() => loadConfig(join(TMP, 'eventgraph'))).toThrow();
  });
});
