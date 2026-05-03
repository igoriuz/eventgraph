import { describe, it, expect, beforeEach } from 'vitest';
import { EventGraph } from '../graph.js';
import { QueryEngine } from '../query.js';

describe('QueryEngine', () => {
  let graph: EventGraph;
  let engine: QueryEngine;

  beforeEach(() => {
    graph = new EventGraph();
    graph.addNode({ id: 'place-order', type: 'command', label: 'Place Order', context: 'payments' });
    graph.addNode({ id: 'order-placed', type: 'event', label: 'Order Placed', context: 'payments' });
    graph.addNode({ id: 'order-summary', type: 'read-model', label: 'Order Summary', context: 'payments' });
    graph.addNode({ id: 'start-fulfillment', type: 'policy', label: 'Start Fulfillment', context: 'shipping' });
    graph.addNode({ id: 'order-screen', type: 'screen', label: 'Order Screen', context: 'payments' });
    graph.addEdge({ from: 'payments.place-order', to: 'payments.order-placed', type: 'produces' });
    graph.addEdge({ from: 'payments.order-placed', to: 'payments.order-summary', type: 'projects-to' });
    graph.addEdge({ from: 'payments.order-placed', to: 'shipping.start-fulfillment', type: 'triggers' });
    graph.addEdge({ from: 'payments.order-screen', to: 'payments.order-summary', type: 'reads' });
    engine = new QueryEngine(graph);
  });

  it('filters by type', () => {
    const result = engine.query('type:event');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('order-placed');
  });

  it('filters by context', () => {
    const result = engine.query('context:shipping');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('start-fulfillment');
  });

  it('combines type and context filters', () => {
    const result = engine.query('type:command context:payments');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('place-order');
  });

  it('finds downstream nodes', () => {
    const result = engine.query('downstream:order-placed');
    expect(result.map(n => n.id).sort()).toEqual(['order-summary', 'start-fulfillment']);
  });

  it('finds upstream nodes', () => {
    const result = engine.query('upstream:order-summary');
    expect(result.map(n => n.id).sort()).toEqual(['order-placed', 'order-screen', 'place-order']);
  });

  it('finds path between nodes', () => {
    const result = engine.query('path:place-order..order-summary');
    expect(result.map(n => n.id)).toEqual(['place-order', 'order-placed', 'order-summary']);
  });

  it('returns empty for path with no connection', () => {
    const result = engine.query('path:order-summary..place-order');
    expect(result).toHaveLength(0);
  });

  it('searches by label text', () => {
    const result = engine.query('Order');
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it('returns all nodes for empty query', () => {
    const result = engine.query('');
    expect(result).toHaveLength(5);
  });
});
