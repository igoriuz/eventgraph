import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { EventGraph } from '../graph.js';
import { verifyAll } from '../verify-all.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eventgraph-verify-all-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relative: string, content: string): void {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

/** One command offered by a screen and a CLI, each pointing at a file. */
function graph(): EventGraph {
  const g = new EventGraph();
  g.addNode({ context: 'app', id: 'pay', type: 'command', label: 'pay', data: { rejects: ['DECLINED'], implemented_by: ['src/pay.ts'] } });
  g.addNode({ context: 'app', id: 'pay-screen', type: 'screen', label: 's', data: { implemented_by: ['ui/Pay.swift'] } });
  g.addNode({ context: 'app', id: 'pay-cli', type: 'screen', label: 'c', data: { kind: 'cli', implemented_by: ['cli/pay.ts'] } });
  g.addEdge({ from: 'app.pay-screen', to: 'app.pay', type: 'offers' });
  g.addEdge({ from: 'app.pay-cli', to: 'app.pay', type: 'offers' });
  return g;
}

function allGood(): void {
  write('src/pay.ts', '');
  write('ui/Pay.swift', 'case .declined:');
  write('cli/pay.ts', "command('pay')");
}

describe('verifyAll', () => {
  it('is ok when every check is', () => {
    allGood();
    expect(verifyAll(graph(), root).ok).toBe(true);
  });

  it('fails on a broken pointer', () => {
    allGood();
    rmSync(join(root, 'src/pay.ts'));
    expect(verifyAll(graph(), root).ok).toBe(false);
  });

  it('fails on an unhandled rejection', () => {
    allGood();
    write('ui/Pay.swift', 'nothing');
    expect(verifyAll(graph(), root).ok).toBe(false);
  });

  it('fails on a CLI subcommand the source never names', () => {
    allGood();
    write('cli/pay.ts', 'nothing');
    expect(verifyAll(graph(), root).ok).toBe(false);
  });

  it('only warns about a node claiming to be built without a source', () => {
    allGood();
    const g = graph();
    g.addNode({ context: 'app', id: 'refund', type: 'command', label: 'r', data: { status: 'implemented' } });
    const report = verifyAll(g, root);
    expect(report.ok).toBe(true);
    expect(report.undeclared).toEqual(['app.refund']);
  });
});
