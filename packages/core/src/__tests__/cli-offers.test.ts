import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { EventGraph } from '../graph.js';
import { verifyCliOffers } from '../cli-offers.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eventgraph-cli-offers-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relative: string, content: string): void {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

/** A CLI surface offering `add-expense`, pointing at `src`. */
function graphFor(src: string[] | undefined, kind = 'cli'): EventGraph {
  const graph = new EventGraph();
  graph.addNode({ context: 'app', id: 'add-expense', type: 'command', label: 'Add expense' });
  graph.addNode({
    context: 'app',
    id: 'expenses-cli',
    type: 'screen',
    label: 'expenses',
    data: { kind, ...(src ? { implemented_by: src } : {}) },
  });
  graph.addEdge({ from: 'app.expenses-cli', to: 'app.add-expense', type: 'offers' });
  return graph;
}

describe('cli offers', () => {
  it('passes when the subcommand names the command id', () => {
    write('Sources/CLI/AddExpense.swift', 'static let configuration = CommandConfiguration(commandName: "add-expense")');

    const report = verifyCliOffers(graphFor(['Sources/CLI']), root);
    expect(report.issues).toEqual([]);
    expect(report.checked).toBe(1);
  });

  it('reports a subcommand the source never names', () => {
    // swift-argument-parser would derive "add-expense" from the type name, so
    // the literal is missing — which is what the convention exists to prevent.
    write('Sources/CLI/AddExpense.swift', 'struct AddExpense: ParsableCommand {}');

    expect(verifyCliOffers(graphFor(['Sources/CLI']), root).issues).toEqual([
      { surface: 'app.expenses-cli', command: 'app.add-expense', name: 'add-expense' },
    ]);
  });

  it('flags a pointer that matched no readable file', () => {
    const report = verifyCliOffers(graphFor(['Sources/CLI']), root);
    expect(report.unsearchable).toEqual(['app.expenses-cli']);
    expect(report.issues).toEqual([]);
  });

  it('says nothing about a surface with no source pointer', () => {
    expect(verifyCliOffers(graphFor(undefined), root).checked).toBe(0);
  });

  it('leaves other surface kinds alone', () => {
    write('ui/Screen.swift', 'nothing');

    expect(verifyCliOffers(graphFor(['ui/Screen.swift'], 'tool'), root).checked).toBe(0);
    expect(verifyCliOffers(graphFor(['ui/Screen.swift'], 'screen'), root).checked).toBe(0);
  });
});
