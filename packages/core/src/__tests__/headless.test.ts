import { describe, it, expect } from 'vitest';
import { EventGraph } from '../graph.js';
import { checkGraph, ruleCatalog } from '../rules/index.js';
import { loadPreset } from '../validate.js';
import type { GraphEdge, GraphNode, PresetDefinition } from '../schema.js';

const PRESET = (rules: string[]): PresetDefinition => ({
  name: 'test',
  nodeTypes: [],
  edgeTypes: [],
  edgeRules: [],
  rules,
});

const ALL = PRESET(ruleCatalog().map(r => r.id));
const HEADLESS_RULES = ruleCatalog()
  .filter(r => r.lane === 'headless')
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
const rulesHit = (graph: EventGraph) => new Set(checkGraph(graph, ALL).map(f => f.rule));
const headlessHits = (graph: EventGraph) => checkGraph(graph, ALL, { lane: 'headless' });
const hitIds = (graph: EventGraph) => new Set(headlessHits(graph).map(f => `${f.rule} ${f.node}`));

/**
 * An app with a screen that offers a command and shows its outcome, plus a
 * second command the CLI exposes. The screen-only command and read-model are
 * what the lane is about.
 */
function appWithCli(): EventGraph {
  return build(
    [
      { id: 'user', type: 'actor' },
      { id: 'thing', type: 'aggregate', data: { immortal: true } },
      { id: 'act', type: 'command' },
      { id: 'acted', type: 'event' },
      { id: 'status', type: 'read-model' },
      { id: 'main', type: 'screen', data: { entry: true } },
      { id: 'sync', type: 'command' },
      { id: 'synced', type: 'event' },
      { id: 'sync-cli', type: 'screen', data: { kind: 'cli' } },
    ],
    [
      edge('user', 'issues', 'act'),
      edge('user', 'issues', 'sync'),
      edge('user', 'sees', 'main'),
      edge('user', 'sees', 'sync-cli'),
      edge('act', 'produces', 'acted'),
      edge('act', 'acts-on', 'thing'),
      edge('acted', 'belongs-to', 'thing'),
      edge('acted', 'projects-to', 'status'),
      edge('sync', 'produces', 'synced'),
      edge('sync', 'acts-on', 'thing'),
      edge('synced', 'belongs-to', 'thing'),
      edge('synced', 'projects-to', 'status'),
      edge('main', 'reads', 'status'),
      edge('main', 'offers', 'act'),
      edge('sync-cli', 'offers', 'sync'),
    ]
  );
}

describe('the headless lane stays out of models without a headless surface', () => {
  it('says nothing about a screen-only app', () => {
    const g = appWithCli();
    g.removeNode('app.sync-cli');
    expect(headlessHits(g)).toEqual([]);
  });

  // A plain client-server app has endpoints and screens. That is not a claim
  // that the app is meant to be driven headlessly, so it must not opt in.
  it('is not switched on by an endpoint alone', () => {
    const g = appWithCli();
    g.getNode('app.sync-cli')!.data = { kind: 'endpoint', public: 'test' };
    expect(headlessHits(g)).toEqual([]);
  });

  it('is switched on by an agent tool as much as by a CLI', () => {
    const g = appWithCli();
    g.getNode('app.sync-cli')!.data = { kind: 'tool' };
    expect(hitIds(g)).toContain('command-ui-only app.act');
  });
});

describe('command-ui-only', () => {
  it('reports a command only a screen offers', () => {
    expect(hitIds(appWithCli())).toContain('command-ui-only app.act');
  });

  it('leaves alone a command the CLI offers', () => {
    expect(hitIds(appWithCli())).not.toContain('command-ui-only app.sync');
  });

  it('counts an endpoint offering it as headless access', () => {
    const g = appWithCli();
    g.addNode({ context: 'app', id: 'act-api', type: 'screen', label: 'POST /act', data: { kind: 'endpoint' } });
    g.addEdge(edge('act-api', 'offers', 'act'));
    expect(hitIds(g)).not.toContain('command-ui-only app.act');
  });

  it('says nothing about a command no person can reach either', () => {
    const g = appWithCli();
    g.addNode({ context: 'app', id: 'internal', type: 'command', label: 'internal' });
    expect(hitIds(g)).not.toContain('command-ui-only app.internal');
  });

  it('is silenced by ui_only with a reason, and only with one', () => {
    const g = appWithCli();
    g.getNode('app.act')!.data = { ui_only: '' };
    expect(hitIds(g)).toContain('command-ui-only app.act');

    g.getNode('app.act')!.data = { ui_only: 'drag-and-drop reordering has no meaning without a screen' };
    expect(hitIds(g)).not.toContain('command-ui-only app.act');
  });
});

describe('read-model-ui-only', () => {
  it('reports a read-model only a screen reads', () => {
    expect(hitIds(appWithCli())).toContain('read-model-ui-only app.status');
  });

  it('leaves alone one a CLI reads too', () => {
    const g = appWithCli();
    g.addEdge(edge('sync-cli', 'reads', 'status'));
    expect(hitIds(g)).not.toContain('read-model-ui-only app.status');
  });

  it('counts an endpoint reading it as headless access', () => {
    const g = appWithCli();
    g.addNode({ context: 'app', id: 'status-api', type: 'screen', label: 'GET /status', data: { kind: 'endpoint' } });
    g.addEdge(edge('status-api', 'reads', 'status'));
    expect(hitIds(g)).not.toContain('read-model-ui-only app.status');
  });

  it('says nothing about a read-model no person sees either', () => {
    const g = appWithCli();
    g.addNode({ context: 'app', id: 'audit', type: 'read-model', label: 'audit' });
    expect(hitIds(g)).not.toContain('read-model-ui-only app.audit');
  });

  it('is silenced by ui_only with a reason, and only with one', () => {
    const g = appWithCli();
    g.getNode('app.status')!.data = { ui_only: '' };
    expect(hitIds(g)).toContain('read-model-ui-only app.status');

    g.getNode('app.status')!.data = { ui_only: 'a chart; the numbers behind it are queried elsewhere' };
    expect(hitIds(g)).not.toContain('read-model-ui-only app.status');
  });
});

describe('cli and tool are surfaces that answer their caller', () => {
  /** A command whose outcome is shown on one surface of the given kind and nowhere else. */
  function feedbackOn(kind: string, callerNamed = true): EventGraph {
    return build(
      [
        { id: 'user', type: 'actor' },
        { id: 'thing', type: 'aggregate', data: { immortal: true } },
        { id: 'sync', type: 'command' },
        { id: 'synced', type: 'event' },
        { id: 'sync-log', type: 'read-model' },
        { id: 'surface', type: 'screen', data: { kind } },
      ],
      [
        edge('user', 'issues', 'sync'),
        ...(callerNamed ? [edge('user', 'sees', 'surface')] : []),
        edge('sync', 'produces', 'synced'),
        edge('sync', 'acts-on', 'thing'),
        edge('synced', 'belongs-to', 'thing'),
        edge('synced', 'projects-to', 'sync-log'),
        edge('surface', 'reads', 'sync-log'),
        edge('surface', 'offers', 'sync'),
      ]
    );
  }

  it('counts feedback landing on a cli or a tool', () => {
    // The control: an unattended consumer is not feedback, on the same graph.
    expect(rulesHit(feedbackOn('consumer'))).toContain('command-no-feedback');
    expect(rulesHit(feedbackOn('cli'))).not.toContain('command-no-feedback');
    expect(rulesHit(feedbackOn('tool'))).not.toContain('command-no-feedback');
  });

  it('is never navigated to, so it needs no entry and no path', () => {
    for (const kind of ['cli', 'tool']) {
      const hits = rulesHit(feedbackOn(kind));
      expect(hits).not.toContain('no-entry-screen');
      expect(hits).not.toContain('screen-unreachable');
    }
  });

  // An app shipping a CLI next to its UI is still an app; the backend lane
  // asking it about redelivery and authorisation would be noise.
  it('does not switch on the backend lane or need a named caller', () => {
    for (const kind of ['cli', 'tool']) {
      expect(checkGraph(feedbackOn(kind, false), ALL, { lane: 'backend' })).toEqual([]);
    }
  });
});

describe('the preset enables the lane', () => {
  it('event-modeling names every headless rule', () => {
    const preset = loadPreset('event-modeling', new URL('../../../../presets', import.meta.url).pathname);
    expect(HEADLESS_RULES.sort()).toEqual(['command-ui-only', 'read-model-ui-only']);
    for (const id of HEADLESS_RULES) expect(preset.rules).toContain(id);
  });
});
