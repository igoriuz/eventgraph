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
    expect(result.transitive.map(n => n.id)).toEqual(['shipment-started']);
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
    expect(result.totalAffected).toBe(3);
    expect(result.risk).toBe('medium');
  });

  it('returns low risk for leaf nodes', () => {
    const result = analyzeImpact(graph, 'shipping.shipment-started');
    expect(result.totalAffected).toBe(0);
    expect(result.risk).toBe('low');
  });

  it('includes upstream dependents (who reads this?)', () => {
    const result = analyzeImpact(graph, 'payments.order-summary');
    expect(result.upstreamDependents.map(n => n.id)).toContain('order-screen');
  });

  it('respects depth limit', () => {
    const result = analyzeImpact(graph, 'payments.order-placed', { maxDepth: 1 });
    expect(result.direct.map(n => n.id).sort()).toEqual(['order-summary', 'start-fulfillment']);
    expect(result.transitive).toHaveLength(0);
  });
});
