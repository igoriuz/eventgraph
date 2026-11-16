import { describe, it, expect } from 'vitest';
import { EventGraph } from '../graph.js';
import { checkGraph } from '../rules/index.js';
import type { GraphEdge, GraphNode, PresetDefinition } from '../schema.js';

const PRESET: PresetDefinition = {
  name: 'test',
  nodeTypes: [],
  edgeTypes: [],
  edgeRules: [],
  rules: ['service-call-unhandled', 'service-unused'],
};

function build(nodes: Array<Partial<GraphNode> & { id: string; type: string }>, edges: GraphEdge[] = []): EventGraph {
  const graph = new EventGraph();
  for (const n of nodes) graph.addNode({ context: 'app', label: n.id, data: n.data, id: n.id, type: n.type });
  for (const e of edges) graph.addEdge(e);
  return graph;
}

const edge = (from: string, type: string, to: string): GraphEdge => ({ from: `app.${from}`, to: `app.${to}`, type });
const hits = (graph: EventGraph) => checkGraph(graph, PRESET).map(f => `${f.rule} ${f.node}`);

/** A command fetching exchange rates, producing only its success. */
function fetchRates(command: Record<string, unknown> = {}, extra: GraphEdge[] = [], nodes: Array<{ id: string; type: string; data?: Record<string, unknown> }> = []) {
  return build(
    [
      { id: 'fetch-rates', type: 'command', data: command },
      { id: 'rates-fetched', type: 'event' },
      { id: 'rates-api', type: 'service' },
      ...nodes,
    ],
    [edge('fetch-rates', 'produces', 'rates-fetched'), edge('fetch-rates', 'calls', 'rates-api'), ...extra]
  );
}

describe('service rules', () => {
  it('reports a call to a service with only a happy path', () => {
    expect(hits(fetchRates())).toEqual(['service-call-unhandled app.fetch-rates']);
  });

  it('accepts a failure event', () => {
    const graph = fetchRates({}, [edge('fetch-rates', 'produces', 'rates-failed')], [
      { id: 'rates-failed', type: 'event', data: { failure: true } },
    ]);
    expect(hits(graph)).toEqual([]);
  });

  it('accepts rejection codes', () => {
    expect(hits(fetchRates({ rejects: ['RATES_UNAVAILABLE'] }))).toEqual([]);
  });

  it('accepts a decision owning the loss', () => {
    const graph = fetchRates({}, [edge('stale-ok', 'affects', 'fetch-rates')], [{ id: 'stale-ok', type: 'decision' }]);
    expect(hits(graph)).toEqual([]);
  });

  it('reports a service nothing calls', () => {
    const graph = build([{ id: 'rates-api', type: 'service' }]);
    expect(hits(graph)).toEqual(['service-unused app.rates-api']);
  });

  it('says nothing about a command calling no service', () => {
    const graph = build([{ id: 'act', type: 'command' }, { id: 'acted', type: 'event' }], [edge('act', 'produces', 'acted')]);
    expect(hits(graph)).toEqual([]);
  });
});
