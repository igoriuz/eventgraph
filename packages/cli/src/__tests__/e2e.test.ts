import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execCli } from './cli-runner.js';

const TMP = join(tmpdir(), 'eventgraph-e2e-' + Date.now());

function run(args: string): string {
  return execCli(args, { cwd: TMP });
}

function setupProject() {
  const egDir = join(TMP, 'eventgraph');
  mkdirSync(join(egDir, 'contexts', 'payments'), { recursive: true });
  mkdirSync(join(egDir, 'contexts', 'shipping'), { recursive: true });

  writeFileSync(join(egDir, 'eventgraph.yaml'), `
name: e2e-test
version: 1
preset: event-modeling
agent:
  write: prompt
contexts:
  - payments
  - shipping
`);

  writeFileSync(join(egDir, 'contexts', 'payments', 'model.yaml'), `
context: payments
nodes:
  - id: place-order
    type: command
    label: Place Order
    data:
      fields: [orderId, customerId, items, total]
  - id: order-placed
    type: event
    label: Order Placed
    data:
      fields: [orderId, customerId, items, total, placedAt]
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
  - from: order-placed
    to: shipping.start-fulfillment
    type: triggers
`);

  // shipping model: policy reads a read-model (both valid under event-modeling preset)
  writeFileSync(join(egDir, 'contexts', 'shipping', 'model.yaml'), `
context: shipping
nodes:
  - id: start-fulfillment
    type: policy
    label: Start Fulfillment
  - id: shipment-orders
    type: read-model
    label: Shipment Orders
edges:
  - from: start-fulfillment
    to: shipment-orders
    type: reads
`);
}

describe('E2E', () => {
  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('full workflow: list → query → impact → validate → view', () => {
    setupProject();

    // list — should show all 5 nodes across both contexts
    const list = run('list');
    expect(list).toContain('place-order');
    expect(list).toContain('start-fulfillment');
    expect(list).toContain('5 node(s)');

    // query — filter by type:event should find both events... wait, we have no events in shipping now
    // order-placed is the only event; let's query for type:event
    const queryEvents = run('query "type:event"');
    expect(queryEvents).toContain('order-placed');

    // query — filter by type:policy
    const queryPolicies = run('query "type:policy"');
    expect(queryPolicies).toContain('start-fulfillment');

    // impact — order-placed affects order-summary (direct), start-fulfillment (direct, cross-context),
    //          and shipment-orders (transitive via start-fulfillment -> reads)
    const impact = run('impact order-placed');
    expect(impact).toContain('order-summary');
    expect(impact).toContain('start-fulfillment');
    expect(impact).toContain('shipment-orders');
    expect(impact).toContain('Cross-context: yes');

    // validate — model should be valid under event-modeling preset
    const validate = run('validate');
    expect(validate).toContain('valid');

    // view — generate HTML viewer
    const viewerPath = join(TMP, 'test-viewer.html');
    const view = run(`view --no-open -o ${viewerPath}`);
    expect(view).toContain('Viewer generated');
    expect(existsSync(viewerPath)).toBe(true);

    const html = readFileSync(viewerPath, 'utf-8');
    expect(html).toContain('Place Order');
    expect(html).toContain('data-context="payments"');
    expect(html).toContain('data-context="shipping"');
  });
});
