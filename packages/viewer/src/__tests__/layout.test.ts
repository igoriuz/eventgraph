import { describe, it, expect } from 'vitest';
import { EventGraph } from '@eventgraph/core';
import { computeLayout } from '../layout.js';

describe('computeLayout', () => {
  it('assigns swimlanes by node type', () => {
    const graph = new EventGraph();
    graph.addNode({ id: 'cmd', type: 'command', label: 'Cmd', context: 'c' });
    graph.addNode({ id: 'evt', type: 'event', label: 'Evt', context: 'c' });
    graph.addNode({ id: 'rm', type: 'read-model', label: 'RM', context: 'c' });
    graph.addNode({ id: 'scr', type: 'screen', label: 'Scr', context: 'c' });
    graph.addNode({ id: 'pol', type: 'policy', label: 'Pol', context: 'c' });

    const layout = computeLayout(graph);
    const byId = new Map(layout.map(n => [n.id, n]));

    expect(byId.get('c.scr')!.swimlane).toBe(0);
    expect(byId.get('c.rm')!.swimlane).toBe(1);
    expect(byId.get('c.evt')!.swimlane).toBe(2);
    expect(byId.get('c.cmd')!.swimlane).toBe(3);
    expect(byId.get('c.pol')!.swimlane).toBe(4);
  });

  it('assigns increasing x positions for nodes in the same swimlane', () => {
    const graph = new EventGraph();
    graph.addNode({ id: 'e1', type: 'event', label: 'First', context: 'c' });
    graph.addNode({ id: 'e2', type: 'event', label: 'Second', context: 'c' });
    graph.addNode({ id: 'e3', type: 'event', label: 'Third', context: 'c' });
    graph.addEdge({ from: 'c.e1', to: 'c.e2', type: 'produces' });
    graph.addEdge({ from: 'c.e2', to: 'c.e3', type: 'produces' });

    const layout = computeLayout(graph);
    const byId = new Map(layout.map(n => [n.id, n]));

    expect(byId.get('c.e1')!.x).toBeLessThan(byId.get('c.e2')!.x);
    expect(byId.get('c.e2')!.x).toBeLessThan(byId.get('c.e3')!.x);
  });
});
