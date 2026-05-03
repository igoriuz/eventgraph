import { describe, it, expect, beforeEach } from 'vitest';
import { EventGraph } from '../graph.js';
import type { GraphNode } from '../schema.js';

describe('EventGraph', () => {
  let graph: EventGraph;

  beforeEach(() => {
    graph = new EventGraph();
  });

  describe('nodes', () => {
    it('adds and retrieves a node', () => {
      const node: GraphNode = {
        id: 'place-order',
        type: 'command',
        label: 'Place Order',
        context: 'payments',
      };
      graph.addNode(node);
      expect(graph.getNode('payments.place-order')).toEqual(node);
    });

    it('returns undefined for unknown node', () => {
      expect(graph.getNode('payments.unknown')).toBeUndefined();
    });

    it('lists all nodes', () => {
      graph.addNode({ id: 'a', type: 'event', label: 'A', context: 'ctx1' });
      graph.addNode({ id: 'b', type: 'event', label: 'B', context: 'ctx2' });
      expect(graph.getAllNodes()).toHaveLength(2);
    });

    it('filters nodes by context', () => {
      graph.addNode({ id: 'a', type: 'event', label: 'A', context: 'ctx1' });
      graph.addNode({ id: 'b', type: 'event', label: 'B', context: 'ctx2' });
      expect(graph.getNodesByContext('ctx1')).toHaveLength(1);
      expect(graph.getNodesByContext('ctx1')[0].id).toBe('a');
    });

    it('filters nodes by type', () => {
      graph.addNode({ id: 'a', type: 'command', label: 'A', context: 'ctx' });
      graph.addNode({ id: 'b', type: 'event', label: 'B', context: 'ctx' });
      expect(graph.getNodesByType('event')).toHaveLength(1);
    });

    it('removes a node and its edges', () => {
      graph.addNode({ id: 'a', type: 'command', label: 'A', context: 'ctx' });
      graph.addNode({ id: 'b', type: 'event', label: 'B', context: 'ctx' });
      graph.addEdge({ from: 'ctx.a', to: 'ctx.b', type: 'produces' });
      graph.removeNode('ctx.a');
      expect(graph.getNode('ctx.a')).toBeUndefined();
      expect(graph.getAllEdges()).toHaveLength(0);
    });
  });

  describe('edges', () => {
    it('adds and retrieves edges', () => {
      graph.addNode({ id: 'a', type: 'command', label: 'A', context: 'ctx' });
      graph.addNode({ id: 'b', type: 'event', label: 'B', context: 'ctx' });
      graph.addEdge({ from: 'ctx.a', to: 'ctx.b', type: 'produces' });

      const outgoing = graph.getOutgoingEdges('ctx.a');
      expect(outgoing).toHaveLength(1);
      expect(outgoing[0].to).toBe('ctx.b');

      const incoming = graph.getIncomingEdges('ctx.b');
      expect(incoming).toHaveLength(1);
      expect(incoming[0].from).toBe('ctx.a');
    });

    it('lists all edges', () => {
      graph.addNode({ id: 'a', type: 'command', label: 'A', context: 'ctx' });
      graph.addNode({ id: 'b', type: 'event', label: 'B', context: 'ctx' });
      graph.addEdge({ from: 'ctx.a', to: 'ctx.b', type: 'produces' });
      expect(graph.getAllEdges()).toHaveLength(1);
    });
  });

  describe('traversal', () => {
    it('finds downstream nodes', () => {
      graph.addNode({ id: 'cmd', type: 'command', label: 'Cmd', context: 'c' });
      graph.addNode({ id: 'evt', type: 'event', label: 'Evt', context: 'c' });
      graph.addNode({ id: 'rm', type: 'read-model', label: 'RM', context: 'c' });
      graph.addEdge({ from: 'c.cmd', to: 'c.evt', type: 'produces' });
      graph.addEdge({ from: 'c.evt', to: 'c.rm', type: 'projects-to' });

      const downstream = graph.getDownstream('c.cmd');
      expect(downstream.map(n => n.id)).toEqual(['evt', 'rm']);
    });

    it('finds upstream nodes', () => {
      graph.addNode({ id: 'cmd', type: 'command', label: 'Cmd', context: 'c' });
      graph.addNode({ id: 'evt', type: 'event', label: 'Evt', context: 'c' });
      graph.addNode({ id: 'rm', type: 'read-model', label: 'RM', context: 'c' });
      graph.addEdge({ from: 'c.cmd', to: 'c.evt', type: 'produces' });
      graph.addEdge({ from: 'c.evt', to: 'c.rm', type: 'projects-to' });

      const upstream = graph.getUpstream('c.rm');
      expect(upstream.map(n => n.id)).toEqual(['evt', 'cmd']);
    });

    it('finds path between two nodes', () => {
      graph.addNode({ id: 'cmd', type: 'command', label: 'Cmd', context: 'c' });
      graph.addNode({ id: 'evt', type: 'event', label: 'Evt', context: 'c' });
      graph.addNode({ id: 'rm', type: 'read-model', label: 'RM', context: 'c' });
      graph.addEdge({ from: 'c.cmd', to: 'c.evt', type: 'produces' });
      graph.addEdge({ from: 'c.evt', to: 'c.rm', type: 'projects-to' });

      const path = graph.findPath('c.cmd', 'c.rm');
      expect(path?.map(n => n.id)).toEqual(['cmd', 'evt', 'rm']);
    });

    it('returns null for no path', () => {
      graph.addNode({ id: 'a', type: 'command', label: 'A', context: 'c' });
      graph.addNode({ id: 'b', type: 'event', label: 'B', context: 'c' });
      expect(graph.findPath('c.a', 'c.b')).toBeNull();
    });

    it('handles cross-context edges', () => {
      graph.addNode({ id: 'evt', type: 'event', label: 'Evt', context: 'payments' });
      graph.addNode({ id: 'policy', type: 'policy', label: 'P', context: 'shipping' });
      graph.addEdge({ from: 'payments.evt', to: 'shipping.policy', type: 'triggers' });

      const downstream = graph.getDownstream('payments.evt');
      expect(downstream).toHaveLength(1);
      expect(downstream[0].context).toBe('shipping');
    });
  });

  describe('contexts', () => {
    it('lists all contexts', () => {
      graph.addNode({ id: 'a', type: 'event', label: 'A', context: 'payments' });
      graph.addNode({ id: 'b', type: 'event', label: 'B', context: 'shipping' });
      expect(graph.getContexts().sort()).toEqual(['payments', 'shipping']);
    });
  });
});
