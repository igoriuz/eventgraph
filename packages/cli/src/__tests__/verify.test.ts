import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { tryCli } from './cli-runner.js';

/**
 * `verify` as a person reads it: what it prints for each kind of problem, and
 * the exit status a script relies on. Pointers resolve from the directory
 * holding eventgraph/, so the fixture is a small repository.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eventgraph-cli-verify-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relative: string, content: string): void {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

/** A screen and a CLI offering a command that can refuse, both pointing at code. */
function project(extraNodes = ''): void {
  write('eventgraph/eventgraph.yaml', 'name: t\npreset: event-modeling\ncontexts: [app]\n');
  write(
    'eventgraph/contexts/app/model.yaml',
    `context: app
nodes:
  pay:        { type: command, rejects: [CARD_DECLINED], src: src/pay.ts }
  pay-screen: { type: screen, src: ui/PayScreen.swift }
  pay-cli:    { type: screen, kind: cli, src: cli/pay.ts }
${extraNodes}edges:
  offers: { pay-screen: [pay], pay-cli: [pay] }
`
  );
}

const verify = (args = '') => tryCli(`verify ${args}`, { cwd: root });

describe('verify', () => {
  it('reports everything resolved, and exits 0', () => {
    project();
    write('src/pay.ts', '');
    write('ui/PayScreen.swift', 'case .cardDeclined: showRetry()');
    write('cli/pay.ts', "program.command('pay')");

    const { stdout, status } = verify();
    expect(status).toBe(0);
    expect(stdout).toContain('✓ 3 pointer(s) across 3 node(s) all resolve');
    expect(stdout).toContain('✓ 1 rejection code(s) recognised by the 1 caller(s) that can meet them');
    expect(stdout).toContain('✓ 1 CLI subcommand(s) named in their source');
  });

  it('lists each kind of problem, and exits 1', () => {
    project();
    write('ui/PayScreen.swift', 'nothing');
    write('cli/pay.ts', 'nothing');

    const { stdout, status } = verify();
    expect(status).toBe(1);
    expect(stdout).toContain('✗ app.pay\n  src/pay.ts\n  → file no longer exists');
    expect(stdout).toContain('✗ app.pay-screen\n  CARD_DECLINED — from app.pay, appears nowhere in this caller\'s source');
    expect(stdout).toContain('✗ app.pay-cli\n  offers app.pay, but "pay" appears nowhere in its source');
    expect(stdout).toContain('1 broken pointer(s), 1 unhandled rejection(s), 1 unnamed subcommand(s), 0 undeclared, 3 checked');
  });

  it('warns about a node that claims to be built without a source, without failing', () => {
    project('  refund:     { type: command, status: implemented }\n');
    write('src/pay.ts', '');
    write('ui/PayScreen.swift', 'CARD_DECLINED');
    write('cli/pay.ts', "'pay'");

    const { stdout, status } = verify();
    expect(status).toBe(0);
    expect(stdout).toContain('! app.refund\n  marked implemented but names no source');
  });

  it('still warns about source it could not search when everything else is clean', () => {
    project();
    write('src/pay.ts', '');
    write('ui/PayScreen.swift', 'CARD_DECLINED');
    write('cli/pay.ts', "'pay'");
    // Point the CLI surface at a directory holding no source at all.
    write(
      'eventgraph/contexts/app/model.yaml',
      `context: app
nodes:
  pay:        { type: command, rejects: [CARD_DECLINED], src: src/pay.ts }
  pay-screen: { type: screen, src: ui/PayScreen.swift }
  pay-cli:    { type: screen, kind: cli, src: cli/docs }
edges:
  offers: { pay-screen: [pay], pay-cli: [pay] }
`
    );
    write('cli/docs/README.md', 'notes');

    const { stdout, status } = verify();
    expect(status).toBe(0);
    expect(stdout).toContain('! app.pay-cli\n  offers commands, but its pointers matched no readable file');
  });

  it('says ok in JSON, and fails the exit status on any issue', () => {
    project();
    write('src/pay.ts', '');
    write('ui/PayScreen.swift', 'CARD_DECLINED');
    write('cli/pay.ts', 'nothing');

    const { stdout, status } = verify('--json');
    expect(status).toBe(1);
    const report = JSON.parse(stdout);
    expect(report.ok).toBe(false);
    expect(report.cli.issues).toEqual([{ surface: 'app.pay-cli', command: 'app.pay', name: 'pay' }]);
    expect(report.contract.issues).toEqual([]);
  });
});
