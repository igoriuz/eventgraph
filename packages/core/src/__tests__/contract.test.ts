import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { EventGraph } from '../graph.js';
import { verifyRejectionHandling } from '../contract.js';
import type { GraphNode } from '../schema.js';

/**
 * A rejection code is a contract with an end in each of two codebases. These
 * tests need real files, because the whole point is reading the far end.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eventgraph-contract-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relative: string, content: string): void {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

interface Spec {
  /** `null` means the actor names no source at all. */
  actorSrc?: unknown;
  rejects?: string[];
  edge?: boolean;
}

/** One actor issuing one command that can reject. */
function graphFor({ actorSrc = ['sensor'], rejects = ['TOO_FAST'], edge = true }: Spec = {}): EventGraph {
  const graph = new EventGraph();
  const node = (id: string, type: string, data?: Record<string, unknown>): GraphNode => ({
    context: 'app',
    id,
    type,
    label: id,
    data,
  });

  graph.addNode(node('device', 'actor', actorSrc ? { implemented_by: actorSrc } : undefined));
  graph.addNode(node('report', 'command', { rejects }));
  if (edge) graph.addEdge({ from: 'app.device', to: 'app.report', type: 'issues' });
  return graph;
}

describe('rejection contracts', () => {
  it('passes when the caller names every code it can meet', () => {
    write('sensor/Errors.cs', 'const string TooFast = "TOO_FAST";');

    const report = verifyRejectionHandling(graphFor(), root);
    expect(report.issues).toEqual([]);
    expect(report.checked).toBe(1);
    expect(report.callers).toBe(1);
  });

  it('reports a code the caller has never heard of', () => {
    write('sensor/Errors.cs', 'const string Unrelated = "SOMETHING_ELSE";');

    const report = verifyRejectionHandling(graphFor(), root);
    expect(report.issues).toEqual([
      { caller: 'app.device', command: 'app.report', code: 'TOO_FAST' },
    ]);
  });

  it('searches a whole tree, not just the files it was pointed at', () => {
    write('sensor/deep/nested/Codes.lua', 'local TOO_FAST = "TOO_FAST"');

    expect(verifyRejectionHandling(graphFor(), root).issues).toEqual([]);
  });

  it('reads a caller written in any language', () => {
    write('sensor/handler.py', '# handles TOO_FAST by backing off');

    // A comment counts. That is the documented limit: this finds a code that
    // appears nowhere, not one that appears and is ignored.
    expect(verifyRejectionHandling(graphFor(), root).issues).toEqual([]);
  });

  it('skips build output, so a stale artefact cannot vouch for the source', () => {
    write('sensor/src/handler.cs', 'nothing relevant here');
    write('sensor/obj/Debug/generated.cs', 'const string TooFast = "TOO_FAST";');

    expect(verifyRejectionHandling(graphFor(), root).issues).toHaveLength(1);
  });

  it('says nothing about an actor with no source pointer', () => {
    const report = verifyRejectionHandling(graphFor({ actorSrc: null }), root);
    expect(report.issues).toEqual([]);
    expect(report.callers).toBe(0);
  });

  it('says nothing about a command that declares no rejections', () => {
    write('sensor/handler.cs', 'nothing');

    const report = verifyRejectionHandling(graphFor({ rejects: [] }), root);
    expect(report.issues).toEqual([]);
    expect(report.callers).toBe(0);
  });

  it('only holds an actor to the commands it actually issues', () => {
    write('sensor/handler.cs', 'nothing');

    const graph = graphFor({ edge: false });
    expect(verifyRejectionHandling(graph, root).issues).toEqual([]);
  });

  it('flags a pointer that matched no readable file rather than passing silently', () => {
    // Nothing written: the tree does not exist.
    const report = verifyRejectionHandling(graphFor(), root);
    expect(report.issues).toEqual([]);
    expect(report.unsearchable).toEqual(['app.device']);
  });

  it('attributes each code to the command that answers with it', () => {
    write('sensor/handler.cs', 'const string A = "KNOWN";');

    const graph = graphFor({ rejects: ['KNOWN'] });
    graph.addNode({
      context: 'app',
      id: 'other',
      type: 'command',
      label: 'other',
      data: { rejects: ['MISSING'] },
    });
    graph.addEdge({ from: 'app.device', to: 'app.other', type: 'issues' });

    const report = verifyRejectionHandling(graph, root);
    expect(report.issues).toEqual([
      { caller: 'app.device', command: 'app.other', code: 'MISSING' },
    ]);
  });

  it('reports a shared code once, against the first command declaring it', () => {
    write('sensor/handler.cs', 'nothing');

    const graph = graphFor({ rejects: ['SHARED'] });
    graph.addNode({
      context: 'app',
      id: 'other',
      type: 'command',
      label: 'other',
      data: { rejects: ['SHARED'] },
    });
    graph.addEdge({ from: 'app.device', to: 'app.other', type: 'issues' });

    // Every bridge command rejects NOT_AUTHENTICATED; listing it once per
    // command would bury the codes that differ.
    expect(verifyRejectionHandling(graph, root).issues).toHaveLength(1);
  });

  it('searches every pointer an actor lists', () => {
    write('sensor/a.cs', 'nothing');
    write('tools/b.lua', 'TOO_FAST')

    const report = verifyRejectionHandling(graphFor({ actorSrc: ['sensor', 'tools'] }), root);
    expect(report.issues).toEqual([]);
  });

  it('understands pointers keyed by platform', () => {
    write('desktop/a.cs', 'TOO_FAST');

    const report = verifyRejectionHandling(graphFor({ actorSrc: { desktop: ['desktop'] } }), root);
    expect(report.issues).toEqual([]);
    expect(report.callers).toBe(1);
  });

  describe('surfaces as callers', () => {
    /** A person issues the command; the screen offering it holds the code. */
    function offered(surfaceSrc: unknown, kind = 'screen'): EventGraph {
      const graph = graphFor({ actorSrc: null });
      graph.addNode({
        context: 'app',
        id: 'report-screen',
        type: 'screen',
        label: 'report-screen',
        data: { kind, implemented_by: surfaceSrc },
      });
      graph.addEdge({ from: 'app.report-screen', to: 'app.report', type: 'offers' });
      return graph;
    }

    it('holds a surface offering the command to its codes', () => {
      write('ui/ReportScreen.swift', 'case .unknown: break');

      const report = verifyRejectionHandling(offered(['ui/ReportScreen.swift']), root);
      expect(report.issues).toEqual([
        { caller: 'app.report-screen', command: 'app.report', code: 'TOO_FAST' },
      ]);
      expect(report.callers).toBe(1);
    });

    it('passes a surface that names the code', () => {
      write('ui/ReportScreen.swift', 'case "TOO_FAST": showSlowDown()');

      expect(verifyRejectionHandling(offered(['ui/ReportScreen.swift']), root).issues).toEqual([]);
    });

    it('does not hold a headless surface, which passes the code on', () => {
      // A CLI prints whatever code it gets; naming each one would be noise.
      write('cli/report.ts', 'console.log(JSON.stringify({ rejected: code }))');

      for (const kind of ['cli', 'tool', 'endpoint']) {
        expect(verifyRejectionHandling(offered(['cli/report.ts'], kind), root).callers).toBe(0);
      }
    });

    it('says nothing about a surface with no source pointer', () => {
      const graph = graphFor({ actorSrc: null });
      graph.addNode({ context: 'app', id: 's', type: 'screen', label: 's' });
      graph.addEdge({ from: 'app.s', to: 'app.report', type: 'offers' });

      expect(verifyRejectionHandling(graph, root).callers).toBe(0);
    });

    it('does not hold a surface to a command it only displays', () => {
      write('ui/ReportScreen.swift', 'nothing');

      const graph = graphFor({ actorSrc: null });
      graph.addNode({
        context: 'app',
        id: 'report-screen',
        type: 'screen',
        label: 'report-screen',
        data: { implemented_by: ['ui/ReportScreen.swift'] },
      });
      expect(verifyRejectionHandling(graph, root).issues).toEqual([]);
    });
  });
});
