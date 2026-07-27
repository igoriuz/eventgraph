import { describe, it, expect } from 'vitest';
import { EventGraph } from '../graph.js';
import { checkGraph, ruleCatalog, resolveRules, unknownRuleIds } from '../rules/index.js';
import type { GraphEdge, GraphNode, PresetDefinition } from '../schema.js';

const PRESET = (rules: string[]): PresetDefinition => ({
  name: 'test',
  nodeTypes: [],
  edgeTypes: [],
  edgeRules: [],
  rules,
});

const ALL = PRESET(ruleCatalog().map(r => r.id));

function build(nodes: Array<Partial<GraphNode> & { id: string; type: string }>, edges: GraphEdge[] = []): EventGraph {
  const graph = new EventGraph();
  for (const n of nodes) {
    graph.addNode({ context: 'app', label: n.id, data: n.data, id: n.id, type: n.type });
  }
  for (const e of edges) graph.addEdge(e);
  return graph;
}

const edge = (from: string, type: string, to: string): GraphEdge => ({ from: `app.${from}`, to: `app.${to}`, type });
const rulesHit = (graph: EventGraph, preset = ALL) => new Set(checkGraph(graph, preset).map(f => f.rule));

/** Smallest graph that satisfies every rule — the baseline for negative tests. */
function completeGraph(): EventGraph {
  return build(
    [
      { id: 'user', type: 'actor' },
      { id: 'thing', type: 'aggregate', data: { immortal: true } },
      { id: 'act', type: 'command' },
      { id: 'acted', type: 'event' },
      { id: 'status', type: 'read-model' },
      { id: 'main', type: 'screen', data: { entry: true } },
    ],
    [
      edge('user', 'issues', 'act'),
      edge('user', 'sees', 'main'),
      edge('act', 'produces', 'acted'),
      edge('act', 'acts-on', 'thing'),
      edge('acted', 'belongs-to', 'thing'),
      edge('acted', 'projects-to', 'status'),
      edge('main', 'reads', 'status'),
      edge('main', 'offers', 'act'),
    ]
  );
}

describe('preset wiring', () => {
  it('runs nothing when the preset declares no rules', () => {
    expect(checkGraph(completeGraph(), PRESET([]))).toEqual([]);
    expect(resolveRules(PRESET([]))).toEqual([]);
  });

  it('runs only the rules a preset names', () => {
    const graph = build([{ id: 'orphan', type: 'event' }]);
    const only = rulesHit(graph, PRESET(['event-uncaused']));
    expect(only).toEqual(new Set(['event-uncaused']));
  });

  it('reports rule ids a preset names but nothing implements', () => {
    expect(unknownRuleIds(PRESET(['event-uncaused', 'does-not-exist']))).toEqual(['does-not-exist']);
  });

  it('every catalog rule has an id, lane and rationale', () => {
    for (const rule of ruleCatalog()) {
      expect(rule.id).toBeTruthy();
      expect(rule.about.length).toBeGreaterThan(20);
      expect(['bootstrap', 'structure', 'ux', 'backend', 'platform']).toContain(rule.lane);
    }
  });
});

describe('bootstrap', () => {
  it('an empty graph names the first step instead of reporting success', () => {
    const findings = checkGraph(new EventGraph(), ALL);
    expect(findings.map(f => f.rule)).toContain('graph-empty');
    expect(findings[0]!.hint).toMatch(/actor/);
  });

  it('a non-empty graph without an actor or aggregate says so', () => {
    const hit = rulesHit(build([{ id: 'lonely', type: 'event' }]));
    expect(hit).toContain('no-actor');
    expect(hit).toContain('no-aggregate');
    expect(hit).not.toContain('graph-empty');
  });
});

describe('structure', () => {
  it('a complete graph produces no findings', () => {
    expect(checkGraph(completeGraph(), ALL)).toEqual([]);
  });

  it('flags an event nothing consumes', () => {
    const graph = completeGraph();
    graph.addNode({ context: 'app', id: 'ignored', type: 'event', label: 'Ignored' });
    graph.addEdge(edge('act', 'produces', 'ignored'));
    graph.addEdge(edge('ignored', 'belongs-to', 'thing'));
    expect(rulesHit(graph)).toContain('event-no-consumer');
  });

  it('data.terminal silences the consumer rule with a reason', () => {
    const graph = completeGraph();
    graph.addNode({ context: 'app', id: 'ignored', type: 'event', label: 'Ignored', data: { terminal: 'deliberate' } });
    graph.addEdge(edge('act', 'produces', 'ignored'));
    graph.addEdge(edge('ignored', 'belongs-to', 'thing'));
    expect(rulesHit(graph)).not.toContain('event-no-consumer');
  });

  it('data.transient excuses an event that belongs to no aggregate', () => {
    const withOrphan = (data?: Record<string, unknown>) => {
      const graph = completeGraph();
      graph.addNode({ context: 'app', id: 'exported', type: 'event', label: 'Exported', data });
      graph.addEdge(edge('act', 'produces', 'exported'));
      graph.addEdge(edge('exported', 'projects-to', 'status'));
      return rulesHit(graph);
    };
    expect(withOrphan()).toContain('event-orphan');
    expect(withOrphan({ transient: 'a file leaves the app' })).not.toContain('event-orphan');
  });

  it('data.immortal excuses an aggregate with no lifecycle end', () => {
    const graph = completeGraph();
    graph.addNode({ context: 'app', id: 'mortal', type: 'aggregate', label: 'Mortal' });
    graph.addEdge(edge('acted', 'belongs-to', 'mortal'));
    expect(rulesHit(graph)).toContain('aggregate-no-lifecycle-end');
  });

  it('data.triggered_by names a non-human origin', () => {
    const withSync = (data?: Record<string, unknown>) => {
      const graph = completeGraph();
      graph.addNode({ context: 'app', id: 'sync', type: 'command', label: 'Sync', data });
      graph.addNode({ context: 'app', id: 'synced', type: 'event', label: 'Synced' });
      graph.addEdge(edge('sync', 'produces', 'synced'));
      graph.addEdge(edge('synced', 'belongs-to', 'thing'));
      graph.addEdge(edge('synced', 'projects-to', 'status'));
      return rulesHit(graph);
    };
    expect(withSync()).toContain('command-no-actor');
    expect(withSync({ triggered_by: 'schedule' })).not.toContain('command-no-actor');
  });

  it('data.external excuses a command that produces no event', () => {
    const graph = completeGraph();
    graph.addNode({
      context: 'app',
      id: 'open-settings',
      type: 'command',
      label: 'Open Settings',
      data: { external: 'hands off to the OS' },
    });
    graph.addEdge(edge('user', 'issues', 'open-settings'));
    expect(rulesHit(graph)).not.toContain('command-no-effect');
  });
});

describe('ux', () => {
  /**
   * The regression PhotoLibCleaner exposed: feedback often only reaches the
   * user after a policy turns the command's event into another command.
   * Following just the direct events reported a gap that was not there.
   */
  it('follows policy chains before declaring a feedback gap', () => {
    const graph = build(
      [
        { id: 'user', type: 'actor' },
        { id: 'thing', type: 'aggregate', data: { immortal: true } },
        { id: 'act', type: 'command' },
        { id: 'acted', type: 'event' },
        { id: 'react', type: 'policy' },
        { id: 'follow-up', type: 'command' },
        { id: 'followed', type: 'event' },
        { id: 'status', type: 'read-model' },
        { id: 'main', type: 'screen', data: { entry: true } },
      ],
      [
        edge('user', 'issues', 'act'),
        edge('user', 'sees', 'main'),
        edge('act', 'produces', 'acted'),
        edge('act', 'acts-on', 'thing'),
        edge('acted', 'belongs-to', 'thing'),
        edge('acted', 'triggers', 'react'),
        edge('react', 'invokes', 'follow-up'),
        edge('follow-up', 'produces', 'followed'),
        edge('followed', 'belongs-to', 'thing'),
        edge('followed', 'projects-to', 'status'),
        edge('main', 'reads', 'status'),
        edge('main', 'offers', 'act'),
      ]
    );
    expect(rulesHit(graph)).not.toContain('command-no-feedback');
  });

  it('still reports a gap when the chain never reaches a surface', () => {
    const graph = completeGraph();
    graph.removeNode('app.status');
    graph.addNode({ context: 'app', id: 'status', type: 'read-model', label: 'Status' });
    graph.addEdge(edge('acted', 'projects-to', 'status'));
    // Nothing reads the read-model any more, so no surface shows the outcome.
    expect(rulesHit(graph)).toContain('command-no-feedback');
  });

  /**
   * A sensor has no screen by construction, so measuring it against one
   * reports every command it issues and tells you nothing. The question that
   * does apply is whether a refusal it cannot see is lost.
   */
  describe('headless actors', () => {
    /** A device issuing one command that an invariant may refuse. */
    function sensorGraph(actorData: Record<string, unknown> = { headless: true }): EventGraph {
      const graph = completeGraph();
      graph.addNode({ context: 'app', id: 'device', type: 'actor', label: 'Device', data: actorData });
      graph.addNode({ context: 'app', id: 'report', type: 'command', label: 'Report' });
      graph.addNode({ context: 'app', id: 'reported', type: 'event', label: 'Reported' });
      graph.addNode({ context: 'app', id: 'shape', type: 'invariant', label: 'Shape' });
      graph.addEdge(edge('device', 'issues', 'report'));
      graph.addEdge(edge('report', 'produces', 'reported'));
      graph.addEdge(edge('report', 'acts-on', 'thing'));
      graph.addEdge(edge('report', 'enforces', 'shape'));
      graph.addEdge(edge('shape', 'guards', 'thing'));
      graph.addEdge(edge('reported', 'belongs-to', 'thing'));
      graph.addEdge(edge('reported', 'projects-to', 'status'));
      return graph;
    }

    it('does not ask a headless actor to observe an outcome', () => {
      expect(rulesHit(sensorGraph())).not.toContain('command-no-feedback');
    });

    it('still asks a human actor to, on the same shape of graph', () => {
      expect(rulesHit(sensorGraph({}))).toContain('command-no-feedback');
    });

    it('reports a refusal the sender can neither see nor retry', () => {
      expect(rulesHit(sensorGraph())).toContain('headless-rejection-lost');
    });

    it('accepts a sender that retries', () => {
      expect(rulesHit(sensorGraph({ headless: true, retried: true }))).not.toContain(
        'headless-rejection-lost'
      );
    });

    it('accepts a decision that owns the loss', () => {
      const graph = sensorGraph();
      graph.addNode({ context: 'app', id: 'd-drop', type: 'decision', label: 'Dropping is fine' });
      graph.addEdge(edge('d-drop', 'affects', 'report'));
      expect(rulesHit(graph)).not.toContain('headless-rejection-lost');
    });

    it('says nothing about a command no invariant can refuse', () => {
      const graph = completeGraph();
      graph.addNode({
        context: 'app',
        id: 'device',
        type: 'actor',
        label: 'Device',
        data: { headless: true },
      });
      graph.addNode({ context: 'app', id: 'ping', type: 'command', label: 'Ping' });
      graph.addNode({ context: 'app', id: 'pinged', type: 'event', label: 'Pinged' });
      graph.addEdge(edge('device', 'issues', 'ping'));
      graph.addEdge(edge('ping', 'produces', 'pinged'));
      graph.addEdge(edge('ping', 'acts-on', 'thing'));
      graph.addEdge(edge('pinged', 'belongs-to', 'thing'));
      graph.addEdge(edge('pinged', 'projects-to', 'status'));

      expect(rulesHit(graph)).not.toContain('headless-rejection-lost');
    });

    it('holds a command to the human standard when a person also issues it', () => {
      // The bridge and the trainer both call log-wild-encounter. The trainer is
      // still owed feedback, so neither exemption may apply to it.
      const graph = completeGraph();
      graph.addNode({
        context: 'app',
        id: 'device',
        type: 'actor',
        label: 'Device',
        data: { headless: true },
      });
      graph.addNode({ context: 'app', id: 'report', type: 'command', label: 'Report' });
      graph.addNode({ context: 'app', id: 'reported', type: 'event', label: 'Reported' });
      graph.addNode({ context: 'app', id: 'shape', type: 'invariant', label: 'Shape' });
      graph.addEdge(edge('device', 'issues', 'report'));
      graph.addEdge(edge('user', 'issues', 'report'));
      graph.addEdge(edge('report', 'produces', 'reported'));
      graph.addEdge(edge('report', 'acts-on', 'thing'));
      graph.addEdge(edge('report', 'enforces', 'shape'));
      graph.addEdge(edge('shape', 'guards', 'thing'));
      graph.addEdge(edge('reported', 'belongs-to', 'thing'));
      // Deliberately no projects-to: nothing shows the outcome to anyone.

      const hit = rulesHit(graph);
      expect(hit).not.toContain('headless-rejection-lost');
      expect(hit).toContain('command-no-feedback');
    });
  });

  /**
   * The writer works, the display works, and the display is empty forever —
   * because the store refuses to be read at all. Neither half is wrong on its
   * own, which is why this survives review.
   */
  describe('state no reader may open', () => {
    function privateStore(): EventGraph {
      const graph = completeGraph();
      graph.addNode({
        context: 'app',
        id: 'vault',
        type: 'aggregate',
        label: 'Vault',
        data: { immortal: true, subscribable: false },
      });
      graph.addNode({ context: 'app', id: 'stored', type: 'event', label: 'Stored' });
      graph.addNode({ context: 'app', id: 'store', type: 'command', label: 'Store' });
      graph.addEdge(edge('user', 'issues', 'store'));
      graph.addEdge(edge('main', 'offers', 'store'));
      graph.addEdge(edge('store', 'produces', 'stored'));
      graph.addEdge(edge('store', 'acts-on', 'vault'));
      graph.addEdge(edge('stored', 'belongs-to', 'vault'));
      return graph;
    }

    it('reports an event written where nothing may read it', () => {
      expect(rulesHit(privateStore())).toContain('unreadable-state');
    });

    it('names the store rather than only the missing consumer', () => {
      const found = checkGraph(privateStore(), ALL).filter(f => f.rule === 'unreadable-state');
      expect(found[0]!.message).toContain('Vault');
      expect(found[0]!.node).toBe('app.stored');
    });

    it('accepts an event that was never meant to be seen', () => {
      const graph = privateStore();
      graph.removeNode('app.stored');
      graph.addNode({
        context: 'app',
        id: 'stored',
        type: 'event',
        label: 'Stored',
        data: { terminal: 'a shadowban the caller must not detect' },
      });
      graph.addEdge(edge('store', 'produces', 'stored'));
      graph.addEdge(edge('stored', 'belongs-to', 'vault'));
      expect(rulesHit(graph)).not.toContain('unreadable-state');
    });

    it('says nothing about a store that simply has no reader yet', () => {
      const graph = privateStore();
      graph.removeNode('app.vault');
      graph.addNode({
        context: 'app',
        id: 'vault',
        type: 'aggregate',
        label: 'Vault',
        data: { immortal: true },
      });
      graph.addEdge(edge('store', 'acts-on', 'vault'));
      graph.addEdge(edge('stored', 'belongs-to', 'vault'));
      // event-no-consumer covers that; it is a gap, not a dead end.
      expect(rulesHit(graph)).not.toContain('unreadable-state');
    });
  });

  /**
   * A push notification reaches the user without ever being navigated to, so
   * it counts as feedback but must be exempt from reachability rules.
   */
  it('a notification counts as feedback and is exempt from reachability', () => {
    const graph = completeGraph();
    graph.removeNode('app.main');
    graph.addNode({ context: 'app', id: 'main', type: 'screen', label: 'Main', data: { entry: true } });
    graph.addNode({ context: 'app', id: 'alert', type: 'screen', label: 'Alert', data: { kind: 'notification' } });
    graph.addEdge(edge('user', 'sees', 'main'));
    graph.addEdge(edge('user', 'sees', 'alert'));
    graph.addEdge(edge('main', 'offers', 'act'));
    graph.addEdge(edge('alert', 'reads', 'status'));

    const hit = rulesHit(graph);
    expect(hit).not.toContain('command-no-feedback');
    expect(hit).not.toContain('screen-unreachable');
    expect(hit).not.toContain('screen-dead-end');
  });

  it('flags a screen no navigation reaches', () => {
    const graph = completeGraph();
    graph.addNode({ context: 'app', id: 'island', type: 'screen', label: 'Island' });
    graph.addEdge(edge('island', 'reads', 'status'));
    expect(rulesHit(graph)).toContain('screen-unreachable');
  });

  it('data.detail excuses a look-only screen from the dead-end rule', () => {
    const withDetail = (data?: Record<string, unknown>) => {
      const graph = completeGraph();
      graph.addNode({ context: 'app', id: 'lightbox', type: 'screen', label: 'Lightbox', data });
      graph.addEdge(edge('main', 'navigates-to', 'lightbox'));
      graph.addEdge(edge('lightbox', 'reads', 'status'));
      return rulesHit(graph);
    };
    expect(withDetail()).toContain('screen-dead-end');
    expect(withDetail({ detail: true })).not.toContain('screen-dead-end');
  });

  it('flags a screen offering a command its audience may not issue', () => {
    const graph = completeGraph();
    graph.addNode({ context: 'app', id: 'admin', type: 'actor', label: 'Admin' });
    graph.addNode({ context: 'app', id: 'purge', type: 'command', label: 'Purge' });
    graph.addNode({ context: 'app', id: 'purged', type: 'event', label: 'Purged' });
    graph.addEdge(edge('admin', 'issues', 'purge'));
    graph.addEdge(edge('purge', 'produces', 'purged'));
    graph.addEdge(edge('purged', 'belongs-to', 'thing'));
    graph.addEdge(edge('purged', 'projects-to', 'status'));
    // Offered on a screen only the plain user sees.
    graph.addEdge(edge('main', 'offers', 'purge'));
    expect(rulesHit(graph)).toContain('actor-cannot-issue');
  });
});

describe('output shape', () => {
  it('sorts errors ahead of warnings', () => {
    const severities = checkGraph(build([{ id: 'lonely', type: 'event' }]), ALL).map(f => f.severity);
    expect(severities).toEqual([...severities].sort());
  });

  it('every finding carries a hint', () => {
    const findings = checkGraph(build([{ id: 'lonely', type: 'event' }]), ALL);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every(f => f.hint.length > 0)).toBe(true);
  });
});
