import { describe, it, expect } from 'vitest';
import { EventGraph } from '../graph.js';
import { checkGraph, ruleCatalog } from '../rules/index.js';
import type { GraphEdge, GraphNode, PresetDefinition } from '../schema.js';

const PRESET = (rules: string[]): PresetDefinition => ({
  name: 'test',
  nodeTypes: [],
  edgeTypes: [],
  edgeRules: [],
  rules,
});

const ALL = PRESET(ruleCatalog().map(r => r.id));
const BACKEND_RULES = ruleCatalog()
  .filter(r => r.lane === 'backend')
  .map(r => r.id);

function build(nodes: Array<Partial<GraphNode> & { id: string; type: string }>, edges: GraphEdge[] = []): EventGraph {
  const graph = new EventGraph();
  for (const n of nodes) {
    graph.addNode({ context: 'app', label: n.id, data: n.data, id: n.id, type: n.type });
  }
  for (const e of edges) graph.addEdge(e);
  return graph;
}

const edge = (from: string, type: string, to: string): GraphEdge => ({ from: `app.${from}`, to: `app.${to}`, type });

/** Same as build(), minus any edge whose `from|type|to` matches an omit key. */
function buildWithout(
  omit: string[],
  nodes: Array<Partial<GraphNode> & { id: string; type: string }>,
  edges: GraphEdge[] = []
): EventGraph {
  const key = (e: GraphEdge) => `${e.from}|${e.type}|${e.to}`;
  return build(nodes, edges.filter(e => !omit.includes(key(e))));
}
const rulesHit = (graph: EventGraph, preset = ALL) => new Set(checkGraph(graph, preset).map(f => f.rule));
const backendHits = (graph: EventGraph) => new Set(checkGraph(graph, ALL, { lane: 'backend' }).map(f => f.rule));

/**
 * An app model: a plain screen, no backend surface anywhere. `omit` drops
 * edges by type, since the graph exposes no public edge removal.
 */
function appGraph(omit: string[] = []): EventGraph {
  return buildWithout(omit,
    [
      { id: 'user', type: 'actor' },
      { id: 'thing', type: 'aggregate', data: { immortal: true } },
      { id: 'act', type: 'command' },
      { id: 'acted', type: 'event' },
      { id: 'status', type: 'read-model' },
      { id: 'main', type: 'screen', data: { entry: true } },
      { id: 'rule', type: 'invariant' },
      { id: 'react', type: 'policy' },
      { id: 'follow-up', type: 'command' },
      { id: 'followed-up', type: 'event', data: { terminal: 'nothing downstream' } },
    ],
    [
      edge('user', 'issues', 'act'),
      edge('user', 'sees', 'main'),
      edge('act', 'produces', 'acted'),
      edge('act', 'acts-on', 'thing'),
      edge('act', 'enforces', 'rule'),
      edge('rule', 'guards', 'thing'),
      edge('acted', 'belongs-to', 'thing'),
      edge('acted', 'projects-to', 'status'),
      edge('acted', 'triggers', 'react'),
      edge('react', 'invokes', 'follow-up'),
      edge('follow-up', 'produces', 'followed-up'),
      edge('follow-up', 'acts-on', 'thing'),
      edge('followed-up', 'belongs-to', 'thing'),
      edge('main', 'reads', 'status'),
      edge('main', 'offers', 'act'),
    ]
  );
}

/** The same model behind an HTTP endpoint, modelled properly. */
function serviceGraph(omit: string[] = []): EventGraph {
  const g = appGraph(omit);
  const api = g.getNode('app.main')!;
  api.data = { kind: 'endpoint' };
  g.getNode('app.status')!.data = { consistency: 'immediate' };
  g.getNode('app.react')!.data = { idempotent: true };
  // The command upholds an invariant, so it needs a modelled refusal.
  g.addNode({ context: 'app', id: 'refused', type: 'event', label: 'refused', data: { failure: true } });
  g.addEdge(edge('act', 'produces', 'refused'));
  g.addEdge(edge('refused', 'belongs-to', 'thing'));
  if (!omit.includes('app.refused|projects-to|app.status')) {
    g.addEdge(edge('refused', 'projects-to', 'status'));
  }
  return g;
}

describe('the backend lane stays out of app models', () => {
  it('an app model trips no backend rule', () => {
    expect(checkGraph(appGraph(), ALL, { lane: 'backend' })).toEqual([]);
  });

  it('a broken app model still trips no backend rule', () => {
    const broken = build([
      { id: 'orphan', type: 'event' },
      { id: 'idle', type: 'actor' },
      { id: 'nowhere', type: 'read-model' },
    ]);
    expect(checkGraph(broken, ALL, { lane: 'backend' })).toEqual([]);
    // ...while the structure lane very much does have something to say.
    expect(rulesHit(broken).size).toBeGreaterThan(0);
  });
});

describe('what turns the lane on', () => {
  it('one backend surface is enough', () => {
    const g = appGraph();
    g.getNode('app.main')!.data = { kind: 'endpoint' };
    expect(backendHits(g)).toContain('policy-not-idempotent');
  });

  // A service with no inbound surface at all has nothing to detect on, so it
  // has to say so explicitly.
  it('a headless model opts in via the project config', () => {
    const g = appGraph();
    expect(checkGraph(g, ALL, { lane: 'backend' })).toEqual([]);
    g.backend = true;
    expect(backendHits(g)).toContain('policy-not-idempotent');
  });
});

describe('a well-formed service', () => {
  it('trips no backend rule', () => {
    expect(checkGraph(serviceGraph(), ALL, { lane: 'backend' })).toEqual([]);
  });

  it('is not judged on navigation, entry or dead ends', () => {
    const hits = rulesHit(serviceGraph());
    expect(hits).not.toContain('no-entry-screen');
    expect(hits).not.toContain('screen-unreachable');
    expect(hits).not.toContain('screen-dead-end');
  });

  // An endpoint answers its caller, so the response is the feedback. Without
  // this, every backend command would report a feedback gap.
  it('counts an endpoint as feedback', () => {
    expect(rulesHit(serviceGraph())).not.toContain('command-no-feedback');
  });
});

describe('each backend rule', () => {
  it('endpoint-anonymous fires on an endpoint with no caller', () => {
    const g = serviceGraph(['app.user|sees|app.main']);
    expect(backendHits(g)).toContain('endpoint-anonymous');

    g.getNode('app.main')!.data = { kind: 'endpoint', public: 'a liveness probe' };
    expect(backendHits(g)).not.toContain('endpoint-anonymous');
  });

  it('policy-not-idempotent fires until the reaction says it is safe to repeat', () => {
    const g = serviceGraph();
    g.getNode('app.react')!.data = {};
    expect(backendHits(g)).toContain('policy-not-idempotent');

    g.getNode('app.react')!.data = { idempotent: true };
    expect(backendHits(g)).not.toContain('policy-not-idempotent');
  });

  it('policy-spans-aggregates fires when one reaction writes to two aggregates', () => {
    const g = serviceGraph();
    g.addNode({ context: 'app', id: 'other', type: 'aggregate', label: 'other', data: { immortal: true } });
    g.addNode({ context: 'app', id: 'side-effect', type: 'command', label: 'side-effect' });
    g.addNode({ context: 'app', id: 'side-effected', type: 'event', label: 'side-effected', data: { terminal: 'x' } });
    g.addEdge(edge('react', 'invokes', 'side-effect'));
    g.addEdge(edge('side-effect', 'acts-on', 'other'));
    g.addEdge(edge('side-effect', 'produces', 'side-effected'));
    g.addEdge(edge('side-effected', 'belongs-to', 'other'));
    expect(backendHits(g)).toContain('policy-spans-aggregates');
  });

  it('read-model-consistency-unstated fires until the staleness window is stated', () => {
    const g = serviceGraph();
    g.getNode('app.status')!.data = {};
    expect(backendHits(g)).toContain('read-model-consistency-unstated');

    g.getNode('app.status')!.data = { consistency: 'eventual' };
    expect(backendHits(g)).not.toContain('read-model-consistency-unstated');
  });

  it('command-no-rejection fires when an enforcing command models no refusal', () => {
    const g = serviceGraph();
    g.removeNode('app.refused');
    expect(backendHits(g)).toContain('command-no-rejection');
  });

  // The rule this one must NOT duplicate is event-no-consumer, which already
  // covers an unconsumed failure. Only a *silenced* one gets through it.
  it('failure-silenced covers exactly what event-no-consumer lets through', () => {
    const unconsumed = serviceGraph(['app.refused|projects-to|app.status']);
    expect(rulesHit(unconsumed)).toContain('event-no-consumer');
    expect(backendHits(unconsumed)).not.toContain('failure-silenced');

    const silenced = serviceGraph(['app.refused|projects-to|app.status']);
    silenced.getNode('app.refused')!.data = { failure: true, terminal: 'we do not care' };
    expect(rulesHit(silenced)).not.toContain('event-no-consumer');
    expect(backendHits(silenced)).toContain('failure-silenced');
  });
});

describe('consumers and jobs are not feedback', () => {
  // A queue consumer runs unattended. Routing an outcome there and calling it
  // observed is the mistake this guards against.
  it('a read-model read only by a consumer does not close a feedback gap', () => {
    const g = serviceGraph();
    g.getNode('app.main')!.data = { kind: 'consumer' };
    expect(rulesHit(g)).toContain('command-no-feedback');
  });
});

describe('the preset enables the lane', () => {
  it('event-modeling names every backend rule', () => {
    expect(BACKEND_RULES.length).toBe(6);
  });
});
