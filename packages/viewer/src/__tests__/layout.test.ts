import { describe, it, expect } from 'vitest';
import { EventGraph } from '@eventgraph/core';
import { computeLayout, SWIMLANE_LABELS, nodeWidth } from '../layout.js';

describe('computeLayout', () => {
  it('assigns swimlanes in event-modeling reading order, actors first', () => {
    const graph = new EventGraph();
    graph.addNode({ id: 'act', type: 'actor', label: 'Act', context: 'c' });
    graph.addNode({ id: 'cmd', type: 'command', label: 'Cmd', context: 'c' });
    graph.addNode({ id: 'evt', type: 'event', label: 'Evt', context: 'c' });
    graph.addNode({ id: 'rm', type: 'read-model', label: 'RM', context: 'c' });
    graph.addNode({ id: 'scr', type: 'screen', label: 'Scr', context: 'c' });
    graph.addNode({ id: 'pol', type: 'policy', label: 'Pol', context: 'c' });

    const byId = new Map(computeLayout(graph).map(n => [n.id, n]));

    expect(byId.get('c.act')!.swimlane).toBe(0);
    expect(byId.get('c.scr')!.swimlane).toBe(1);
    expect(byId.get('c.rm')!.swimlane).toBe(2);
    expect(byId.get('c.cmd')!.swimlane).toBe(3);
    expect(byId.get('c.evt')!.swimlane).toBe(4);
    expect(byId.get('c.pol')!.swimlane).toBe(5);
  });

  it('gives the node types added with the rules a lane of their own', () => {
    const graph = new EventGraph();
    for (const type of ['invariant', 'decision', 'question', 'aggregate']) {
      graph.addNode({ id: type, type, label: type, context: 'c' });
    }
    const byId = new Map(computeLayout(graph).map(n => [n.id, n]));

    // Previously every unknown type collapsed onto one lane.
    expect(byId.get('c.aggregate')!.swimlane).toBe(6);
    expect(byId.get('c.invariant')!.swimlane).toBe(6);
    expect(byId.get('c.decision')!.swimlane).toBe(7);
    for (const n of computeLayout(graph)) {
      expect(n.swimlane).toBeLessThan(SWIMLANE_LABELS.length);
    }
  });

  it('assigns increasing x positions along a flow', () => {
    const graph = new EventGraph();
    graph.addNode({ id: 'e1', type: 'event', label: 'First', context: 'c' });
    graph.addNode({ id: 'e2', type: 'event', label: 'Second', context: 'c' });
    graph.addNode({ id: 'e3', type: 'event', label: 'Third', context: 'c' });

    const byId = new Map(computeLayout(graph).map(n => [n.id, n]));

    expect(byId.get('c.e1')!.x).toBeLessThan(byId.get('c.e2')!.x);
    expect(byId.get('c.e2')!.x).toBeLessThan(byId.get('c.e3')!.x);
  });

  it('puts a command in the same column as the event it produces', () => {
    const graph = new EventGraph();
    graph.addNode({ id: 'other', type: 'event', label: 'Other', context: 'c' });
    graph.addNode({ id: 'placed', type: 'event', label: 'Placed', context: 'c' });
    graph.addNode({ id: 'place', type: 'command', label: 'Place', context: 'c' });
    graph.addNode({ id: 'list', type: 'read-model', label: 'List', context: 'c' });
    graph.addEdge({ from: 'c.place', to: 'c.placed', type: 'produces' });
    graph.addEdge({ from: 'c.placed', to: 'c.list', type: 'projects-to' });

    const byId = new Map(computeLayout(graph).map(n => [n.id, n]));

    // Column comes from the flow, not from position in a list: the command,
    // its event and the read-model it feeds line up vertically.
    expect(byId.get('c.place')!.x).toBe(byId.get('c.placed')!.x);
    expect(byId.get('c.list')!.x).toBe(byId.get('c.placed')!.x);
    expect(byId.get('c.other')!.x).not.toBe(byId.get('c.placed')!.x);
  });

  it('never overlaps two nodes sharing a lane', () => {
    // Several screens reading one read-model all land in the same lane of the
    // same column. They used to step sideways by a third of a node width and
    // sit on top of each other.
    const graph = new EventGraph();
    graph.addNode({ id: 'placed', type: 'event', label: 'Placed', context: 'c' });
    graph.addNode({ id: 'status', type: 'read-model', label: 'Order Status', context: 'c' });
    graph.addEdge({ from: 'c.placed', to: 'c.status', type: 'projects-to' });
    for (const label of ['Order Tracking', 'Courier App', 'A Rather Long Screen Name']) {
      const id = label.toLowerCase().replaceAll(' ', '-');
      graph.addNode({ id, type: 'screen', label, context: 'c' });
      graph.addEdge({ from: `c.${id}`, to: 'c.status', type: 'reads' });
    }

    const nodes = computeLayout(graph);
    expect(nodes.filter(n => n.type === 'screen')).toHaveLength(3);

    for (const a of nodes) {
      for (const b of nodes) {
        if (a.id === b.id || a.swimlane !== b.swimlane) continue;
        const clear = a.x + a.width <= b.x || b.x + b.width <= a.x;
        expect(clear, `${a.id} overlaps ${b.id}`).toBe(true);
      }
    }
  });

  it('sizes a node to the label the viewer will render', () => {
    const graph = new EventGraph();
    graph.addNode({ id: 'short', type: 'event', label: 'Paid', context: 'c' });
    graph.addNode({
      id: 'long',
      type: 'event',
      label: 'Payment Refused By The Acquiring Bank',
      context: 'c',
    });

    const byId = new Map(computeLayout(graph).map(n => [n.id, n]));

    expect(byId.get('c.long')!.width).toBeGreaterThan(byId.get('c.short')!.width);
    expect(byId.get('c.long')!.width).toBe(nodeWidth('Payment Refused By The Acquiring Bank'));
  });

  it('keeps a crowded lane from shifting the column its neighbours align to', () => {
    const graph = new EventGraph();
    graph.addNode({ id: 'first', type: 'event', label: 'First', context: 'c' });
    graph.addNode({ id: 'cmd', type: 'command', label: 'Cmd', context: 'c' });
    graph.addEdge({ from: 'c.cmd', to: 'c.first', type: 'produces' });
    graph.addNode({ id: 'second', type: 'event', label: 'Second', context: 'c' });
    graph.addNode({ id: 'cmd2', type: 'command', label: 'Cmd Two', context: 'c' });
    graph.addEdge({ from: 'c.cmd2', to: 'c.second', type: 'produces' });
    // Two read-models in the first column widen it for everybody.
    for (const id of ['rm-a', 'rm-b']) {
      graph.addNode({ id, type: 'read-model', label: id, context: 'c' });
      graph.addEdge({ from: 'c.first', to: `c.${id}`, type: 'projects-to' });
    }

    const byId = new Map(computeLayout(graph).map(n => [n.id, n]));

    // The command still starts exactly where its event does, in both columns.
    expect(byId.get('c.cmd')!.x).toBe(byId.get('c.first')!.x);
    expect(byId.get('c.cmd2')!.x).toBe(byId.get('c.second')!.x);
    expect(byId.get('c.second')!.x).toBeGreaterThan(byId.get('c.rm-b')!.x);
  });
});
