import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tryCli } from './cli-runner.js';

/**
 * Output read through a pipe — `check --json | jq`, or any test harness — must
 * arrive whole. Exiting with process.exit() right after writing cuts it at the
 * pipe's buffer (64 KiB on macOS), which a large model easily passes.
 */
let root: string;
const EVENTS = 600;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'eventgraph-cli-large-'));
  mkdirSync(join(root, 'eventgraph', 'contexts', 'app'), { recursive: true });
  writeFileSync(join(root, 'eventgraph', 'eventgraph.yaml'), 'name: t\npreset: event-modeling\ncontexts: [app]\n');
  const nodes = Array.from({ length: EVENTS }, (_, i) => `  something-happened-${i}: { type: event }`).join('\n');
  writeFileSync(join(root, 'eventgraph', 'contexts', 'app', 'model.yaml'), `context: app\nnodes:\n${nodes}\n`);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('large output through a pipe', () => {
  it('check --json arrives whole', () => {
    const { stdout, status } = tryCli('check --json', { cwd: root });
    expect(status).toBe(1);
    expect(stdout.length).toBeGreaterThan(65_536);
    const report = JSON.parse(stdout);
    expect(report.findings.filter((f: { rule: string }) => f.rule === 'event-uncaused')).toHaveLength(EVENTS);
  });

  it('check as text arrives whole', () => {
    const { stdout } = tryCli('check', { cwd: root });
    expect(stdout).toContain('something-happened-599');
    expect(stdout).toMatch(/error\(s\).*across \d+ nodes/);
  });
});
