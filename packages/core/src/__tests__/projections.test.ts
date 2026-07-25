import { describe, it, expect } from 'vitest';
import { EventGraph } from '../graph.js';
import { lifecycle, neighbourhood, resolveId, slice, sliceGraph, subgraph } from '../projections.js';
import type { GraphNode } from '../schema.js';

const node = (id: string, type: string, data?: Record<string, unknown>): GraphNode => ({
  id,
  type,
  label: id,
  context: 'app',
  data,
});

/** Order flow: customer → orders screen → place → placed → list, plus a policy. */
function orderGraph(): EventGraph {
  const g = new EventGraph();
  [
    node('customer', 'actor'),
    node('order', 'aggregate'),
    node('orders', 'screen'),
    node('place', 'command'),
    node('placed', 'event'),
    node('cancelled', 'event', { ends_lifecycle: true }),
    node('cancel', 'command'),
    node('list', 'read-model'),
    node('notify', 'policy'),
    node('unrelated', 'event'),
  ].forEach(n => g.addNode(n));

  (
    [
      ['app.customer', 'issues', 'app.place'],
      ['app.customer', 'sees', 'app.orders'],
      ['app.orders', 'offers', 'app.place'],
      ['app.orders', 'reads', 'app.list'],
      ['app.place', 'produces', 'app.placed'],
      ['app.placed', 'belongs-to', 'app.order'],
      ['app.placed', 'projects-to', 'app.list'],
      ['app.placed', 'triggers', 'app.notify'],
      ['app.cancel', 'produces', 'app.cancelled'],
      ['app.cancelled', 'belongs-to', 'app.order'],
    ] as const
  ).forEach(([from, type, to]) => g.addEdge({ from, to, type }));

  return g;
}

describe('resolveId', () => {
  it('accepts a bare id when it is unambiguous', () => {
    expect(resolveId(orderGraph(), 'placed')).toBe('app.placed');
  });

  it('accepts an already-qualified id', () => {
    expect(resolveId(orderGraph(), 'app.placed')).toBe('app.placed');
  });

  it('returns undefined for an unknown id', () => {
    expect(resolveId(orderGraph(), 'nope')).toBeUndefined();
  });
});

describe('slice', () => {
  it('reconstructs the swimlane around one event', () => {
    const s = slice(orderGraph(), 'placed');
    const ids = (nodes: GraphNode[]) => nodes.map(n => n.id).sort();

    expect(s.event.id).toBe('placed');
    expect(ids(s.causedBy)).toEqual(['place']);
    expect(ids(s.actors)).toEqual(['customer']);
    expect(ids(s.screens)).toEqual(['orders']);
    expect(ids(s.readModels)).toEqual(['list']);
    expect(ids(s.policies)).toEqual(['notify']);
    expect(ids(s.shownOn)).toEqual(['orders']);
    expect(s.aggregate?.id).toBe('order');
  });

  it('refuses a node that is not an event', () => {
    expect(() => slice(orderGraph(), 'place')).toThrow(/is a command/);
  });

  it('refuses an unknown node', () => {
    expect(() => slice(orderGraph(), 'nope')).toThrow(/unknown node/);
  });
});

describe('lifecycle', () => {
  it("lists an aggregate's events with the lifecycle-ending one last", () => {
    expect(lifecycle(orderGraph(), 'order').map(n => n.id)).toEqual(['placed', 'cancelled']);
  });

  it('refuses a node that is not an aggregate', () => {
    expect(() => lifecycle(orderGraph(), 'customer')).toThrow(/is a actor/);
  });
});

describe('subgraph', () => {
  it('keeps only the named nodes and the edges between them', () => {
    const sub = subgraph(orderGraph(), ['app.place', 'app.placed']);
    expect(sub.getAllNodes().map(n => n.id).sort()).toEqual(['place', 'placed']);
    expect(sub.getAllEdges()).toHaveLength(1);
  });

  it('drops edges pointing outside the selection', () => {
    const sub = subgraph(orderGraph(), ['app.placed']);
    expect(sub.getAllEdges()).toEqual([]);
  });
});

describe('neighbourhood', () => {
  it('reaches one hop in both directions by default', () => {
    const ids = neighbourhood(orderGraph(), 'placed');
    expect([...ids].sort()).toEqual(['app.list', 'app.notify', 'app.order', 'app.place', 'app.placed']);
  });

  it('widens with depth', () => {
    const one = neighbourhood(orderGraph(), 'placed', 1);
    const two = neighbourhood(orderGraph(), 'placed', 2);
    expect(two.size).toBeGreaterThan(one.size);
    // Two hops away: the actor and the screen behind the command.
    expect(two.has('app.customer')).toBe(true);
  });

  it('never pulls in an unrelated node', () => {
    expect(neighbourhood(orderGraph(), 'placed', 5).has('app.unrelated')).toBe(false);
  });
});

describe('sliceGraph', () => {
  it('renders far fewer nodes than the whole graph', () => {
    const full = orderGraph();
    const sub = sliceGraph(full, 'placed');
    expect(sub.getAllNodes().length).toBeLessThan(full.getAllNodes().length);
    expect(sub.getAllNodes().map(n => n.id)).not.toContain('unrelated');
    expect(sub.getAllNodes().map(n => n.id)).toContain('customer');
  });
});
