import { describe, it, expect } from 'vitest';
import { EventGraph } from '../graph.js';
import { checkGraph, ruleCatalog } from '../rules/index.js';
import { verifyImplementations, pointersOf, pointerPath } from '../verify.js';
import type { GraphNode, PresetDefinition } from '../schema.js';

const ALL: PresetDefinition = {
  name: 'test',
  nodeTypes: [],
  edgeTypes: [],
  edgeRules: [],
  rules: ruleCatalog().map(r => r.id),
};

const node = (id: string, type: string, data?: Record<string, unknown>): GraphNode => ({
  id,
  type,
  label: id,
  context: 'app',
  data,
});

function twoPlatformGraph(platforms = ['ios', 'android']): EventGraph {
  const g = new EventGraph();
  g.platforms = platforms;
  g.addNode(node('shared-thing', 'aggregate', { implemented_by: ['shared'] }));
  g.addNode(
    node('on-both', 'command', {
      implemented_by: { ios: ['ios/Both.swift'], android: ['android/Both.kt'] },
    })
  );
  g.addNode(
    node('android-only', 'command', {
      implemented_by: { ios: [], android: ['android/Only.kt'] },
    })
  );
  g.addNode(node('key-missing', 'command', { implemented_by: { android: ['android/X.kt'] } }));
  return g;
}

const drift = (g: EventGraph) => checkGraph(g, ALL, { lane: 'platform' });

describe('platform-drift', () => {
  it('reports a node built on one platform but not the other', () => {
    const found = drift(twoPlatformGraph()).filter(f => f.rule === 'platform-drift');
    expect(found.map(f => f.node).sort()).toEqual(['app.android-only', 'app.key-missing']);
    expect(found[0]!.message).toMatch(/missing on ios/);
  });

  it('treats an absent platform key the same as an empty one', () => {
    const messages = drift(twoPlatformGraph())
      .filter(f => f.node === 'app.key-missing')
      .map(f => f.message);
    expect(messages[0]).toMatch(/built on android, missing on ios/);
  });

  it('never reports a node with a flat implemented_by list', () => {
    expect(drift(twoPlatformGraph()).map(f => f.node)).not.toContain('app.shared-thing');
  });

  it('never reports a node built everywhere', () => {
    expect(drift(twoPlatformGraph()).map(f => f.node)).not.toContain('app.on-both');
  });

  it('stays silent when the project declares no platforms', () => {
    expect(drift(twoPlatformGraph([]))).toEqual([]);
  });

  it('flags an implementation claimed for an undeclared platform', () => {
    const g = twoPlatformGraph(['ios']);
    const found = drift(g).filter(f => f.rule === 'platform-unknown');
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]!.message).toMatch(/undeclared platform "android"/);
  });
});

describe('pointer parsing', () => {
  it('strips a symbol suffix', () => {
    expect(pointerPath('src/Store.swift#purchase')).toBe('src/Store.swift');
    expect(pointerPath('src/Store.swift')).toBe('src/Store.swift');
  });

  it('reads both flat and platform-keyed pointers', () => {
    expect(pointersOf(node('a', 'command', { implemented_by: ['x/y.ts'] }))).toEqual([
      { pointer: 'x/y.ts' },
    ]);
    expect(
      pointersOf(node('b', 'command', { implemented_by: { ios: ['a/b.swift'] } }))
    ).toEqual([{ platform: 'ios', pointer: 'a/b.swift' }]);
  });

  it('returns nothing when there are no pointers', () => {
    expect(pointersOf(node('c', 'command'))).toEqual([]);
  });
});

describe('verifyImplementations', () => {
  const graphWith = (data: Record<string, unknown>) => {
    const g = new EventGraph();
    g.addNode(node('thing', 'command', data));
    return g;
  };

  it('accepts a pointer to a file that exists', () => {
    // This test file itself is a file that certainly exists.
    const report = verifyImplementations(
      graphWith({ implemented_by: ['packages/core/src/verify.ts'] }),
      new URL('../../../..', import.meta.url).pathname
    );
    expect(report.issues).toEqual([]);
    expect(report.checked).toBe(1);
  });

  it('reports a pointer whose file is gone', () => {
    const report = verifyImplementations(
      graphWith({ implemented_by: ['packages/core/src/does-not-exist.ts'] }),
      new URL('../../../..', import.meta.url).pathname
    );
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]!.reason).toBe('missing');
  });

  it('ignores markers that are not paths', () => {
    const report = verifyImplementations(graphWith({ implemented_by: ['shared'] }), '/tmp');
    expect(report.checked).toBe(0);
    expect(report.issues).toEqual([]);
  });

  it('flags a node marked implemented that names no source', () => {
    const report = verifyImplementations(graphWith({ status: 'implemented' }), '/tmp');
    expect(report.undeclared).toEqual(['app.thing']);
  });

  it('does not expect pointers from a draft node', () => {
    const report = verifyImplementations(graphWith({ status: 'draft' }), '/tmp');
    expect(report.undeclared).toEqual([]);
  });
});

describe('finding order', () => {
  it('puts bootstrap gaps before everything else', () => {
    const g = new EventGraph();
    g.addNode(node('lonely', 'event'));
    const lanes = checkGraph(g, ALL).map(f => f.lane);
    expect(lanes[0]).toBe('bootstrap');
  });

  it('ranks a gap in a well-connected node above one in a leaf', () => {
    const g = new EventGraph();
    g.platforms = [];
    g.addNode(node('user', 'actor'));
    g.addNode(node('hub', 'aggregate', { immortal: true }));
    // "hub" carries edges; "leaf" carries none, so both trip aggregate-no-events
    // but the connected one should be offered first.
    g.addNode(node('leaf', 'aggregate', { immortal: true }));
    g.addNode(node('cmd', 'command'));
    g.addEdge({ from: 'app.user', to: 'app.cmd', type: 'issues' });
    g.addEdge({ from: 'app.cmd', to: 'app.hub', type: 'acts-on' });

    const order = checkGraph(g, ALL)
      .filter(f => f.rule === 'aggregate-no-events')
      .map(f => f.node);
    expect(order).toEqual(['app.hub', 'app.leaf']);
  });
});
