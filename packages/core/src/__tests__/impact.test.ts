import { describe, it, expect, beforeEach } from 'vitest';
import { EventGraph } from '../graph.js';
import { analyzeImpact } from '../impact.js';

describe('analyzeImpact', () => {
  let graph: EventGraph;

  beforeEach(() => {
    graph = new EventGraph();
    graph.addNode({ id: 'place-order', type: 'command', label: 'Place Order', context: 'payments' });
    graph.addNode({ id: 'order-placed', type: 'event', label: 'Order Placed', context: 'payments' });
    graph.addNode({ id: 'order-summary', type: 'read-model', label: 'Order Summary', context: 'payments' });
    graph.addNode({ id: 'order-screen', type: 'screen', label: 'Order Screen', context: 'payments' });
    graph.addNode({ id: 'start-fulfillment', type: 'policy', label: 'Start Fulfillment', context: 'shipping' });
    graph.addNode({ id: 'shipment-started', type: 'event', label: 'Shipment Started', context: 'shipping' });
    graph.addEdge({ from: 'payments.place-order', to: 'payments.order-placed', type: 'produces' });
    graph.addEdge({ from: 'payments.order-placed', to: 'payments.order-summary', type: 'projects-to' });
    graph.addEdge({ from: 'payments.order-screen', to: 'payments.order-summary', type: 'reads' });
    graph.addEdge({ from: 'payments.order-placed', to: 'shipping.start-fulfillment', type: 'triggers' });
    graph.addEdge({ from: 'shipping.start-fulfillment', to: 'shipping.shipment-started', type: 'produces' });
  });

  it('returns direct and transitive downstream nodes', () => {
    const result = analyzeImpact(graph, 'payments.order-placed');
    expect(result.direct.map(n => n.id).sort()).toEqual(['order-summary', 'start-fulfillment']);
    expect(result.transitive.map(n => n.id).sort()).toEqual(['order-screen', 'shipment-started']);
  });

  it('lists affected contexts', () => {
    const result = analyzeImpact(graph, 'payments.order-placed');
    expect(result.affectedContexts.sort()).toEqual(['payments', 'shipping']);
  });

  it('detects cross-context impact', () => {
    const result = analyzeImpact(graph, 'payments.order-placed');
    expect(result.crossContext).toBe(true);
  });

  it('calculates risk based on node count', () => {
    const result = analyzeImpact(graph, 'payments.order-placed');
    expect(result.totalAffected).toBe(4);
    expect(result.risk).toBe('medium');
  });

  it('returns low risk for leaf nodes', () => {
    const result = analyzeImpact(graph, 'shipping.shipment-started');
    expect(result.totalAffected).toBe(0);
    expect(result.risk).toBe('low');
  });

  it('lists a reader of a changed read-model as affected', () => {
    const result = analyzeImpact(graph, 'payments.order-summary');
    expect(result.direct.map(n => n.id)).toEqual(['order-screen']);
    expect(result.upstreamDependents.map(n => n.id)).toEqual(['order-placed']);
  });

  it('follows a read-model to its readers from further upstream', () => {
    // The screen showing the summary is the one place a person notices that
    // placing an order changed. Downstream edges alone never reach it.
    const result = analyzeImpact(graph, 'payments.place-order');
    expect(result.transitive.map(n => n.id)).toContain('order-screen');
  });

  it('stops at a screen reached through what it reads', () => {
    graph.addNode({ id: 'cancel-order', type: 'command', label: 'Cancel Order', context: 'payments' });
    graph.addNode({ id: 'home', type: 'screen', label: 'Home', context: 'payments' });
    graph.addEdge({ from: 'payments.order-screen', to: 'payments.cancel-order', type: 'offers' });
    graph.addEdge({ from: 'payments.order-screen', to: 'payments.home', type: 'navigates-to' });

    const ids = analyzeImpact(graph, 'payments.order-summary').transitive.map(n => n.id);
    expect(ids).not.toContain('cancel-order');
    expect(ids).not.toContain('home');
  });

  it('continues through a policy that reads a changed read-model', () => {
    graph.addNode({ id: 'restock', type: 'policy', label: 'Restock', context: 'payments' });
    graph.addNode({ id: 'order-stock', type: 'command', label: 'Order Stock', context: 'payments' });
    graph.addEdge({ from: 'payments.restock', to: 'payments.order-summary', type: 'reads' });
    graph.addEdge({ from: 'payments.restock', to: 'payments.order-stock', type: 'invokes' });

    const ids = analyzeImpact(graph, 'payments.order-summary').transitive.map(n => n.id);
    expect(ids).toContain('order-stock');
  });

  it('lists every command calling a service, and what they set off', () => {
    graph.addNode({ id: 'payment-api', type: 'service', label: 'Payment API', context: 'payments' });
    graph.addEdge({ from: 'payments.place-order', to: 'payments.payment-api', type: 'calls' });

    const result = analyzeImpact(graph, 'payments.payment-api');
    expect(result.direct.map(n => n.id)).toEqual(['place-order']);
    expect(result.transitive.map(n => n.id)).toContain('order-screen');
  });

  it('respects depth limit', () => {
    const result = analyzeImpact(graph, 'payments.order-placed', { maxDepth: 1 });
    expect(result.direct.map(n => n.id).sort()).toEqual(['order-summary', 'start-fulfillment']);
    expect(result.transitive).toHaveLength(0);
  });
});
