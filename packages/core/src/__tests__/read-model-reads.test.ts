import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { EventGraph } from '../graph.js';
import { verifyReadModelReads } from '../read-model-reads.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eventgraph-reads-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relative: string, content: string): void {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

/** A screen reading one read-model; the read-model's pointer decides whether it is checked. */
function graphFor(readModelSrc: string[], screenSrc: string[] | null = ['ui/Today.swift']): EventGraph {
  const g = new EventGraph();
  g.addNode({ context: 'app', id: 'todays-session', type: 'read-model', label: 'r', data: { implemented_by: readModelSrc } });
  g.addNode({ context: 'app', id: 'today', type: 'screen', label: 's', data: screenSrc ? { implemented_by: screenSrc } : undefined });
  g.addEdge({ from: 'app.today', to: 'app.todays-session', type: 'reads' });
  return g;
}

const CORE = 'core/ReadModels.swift#TodaysSession';

describe('reads of core read-models', () => {
  it('passes a screen that names the core type', () => {
    write('ui/Today.swift', 'let session = core.read(TodaysSession.self)');

    const report = verifyReadModelReads(graphFor([CORE]), root);
    expect(report.issues).toEqual([]);
    expect(report.checked).toBe(1);
  });

  it('reports a screen that computes the answer itself', () => {
    write('ui/Today.swift', 'let session = log.sessions.last');

    expect(verifyReadModelReads(graphFor([CORE]), root).issues).toEqual([
      { reader: 'app.today', readModel: 'app.todays-session', symbol: 'TodaysSession' },
    ]);
  });

  it('accepts a read through a file the screen uses', () => {
    // The screen reads through a repository that delegates to the core.
    write('ui/Today.swift', 'let session = TodayRepository().current()');
    write('data/TodayRepository.swift', 'func current() -> TodaysSession { core.read() }');

    expect(verifyReadModelReads(graphFor([CORE]), root).issues).toEqual([]);
  });

  it('does not take a longer name for the symbol', () => {
    write('ui/Today.swift', 'let x = TodaysSessionDraft()');

    expect(verifyReadModelReads(graphFor([CORE]), root).issues).toHaveLength(1);
  });

  it('uses the last segment of a dotted symbol', () => {
    write('ui/Favorites.dart', 'core.favoritesList()');

    const report = verifyReadModelReads(graphFor(['core/core.dart#FavoritesCore.favoritesList'], ['ui/Favorites.dart']), root);
    expect(report.issues).toEqual([]);
  });

  it('says nothing about a read-model without a symbol', () => {
    // It names a question the code answers under other names; nothing to search for.
    write('ui/Today.swift', 'nothing');

    const report = verifyReadModelReads(graphFor(['core/ReadModels.swift']), root);
    expect(report.issues).toEqual([]);
    expect(report.checked).toBe(0);
  });

  it('says nothing about a reader with no source pointer', () => {
    expect(verifyReadModelReads(graphFor([CORE], null), root).checked).toBe(0);
  });

  it('flags a reader whose pointers matched no file', () => {
    const report = verifyReadModelReads(graphFor([CORE]), root);
    expect(report.unsearchable).toEqual(['app.today']);
    expect(report.issues).toEqual([]);
  });
});
