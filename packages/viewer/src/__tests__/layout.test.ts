import { describe, it, expect } from 'vitest';
import { EventGraph } from '@eventgraph/core';
import { computeLayout, SWIMLANE_LABELS } from '../layout.js';

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
});
