import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tryCli } from './cli-runner.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eventgraph-cli-impact-'));
  mkdirSync(join(root, 'eventgraph', 'contexts', 'app'), { recursive: true });
  writeFileSync(join(root, 'eventgraph', 'eventgraph.yaml'), 'name: t\npreset: event-modeling\ncontexts: [app]\n');
  writeFileSync(
    join(root, 'eventgraph', 'contexts', 'app', 'model.yaml'),
    'context: app\nnodes:\n  pay: { type: command }\n  paid: { type: event }\nedges:\n  produces: { pay: [paid] }\n'
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('impact', () => {
  it('refuses a depth that is not a positive number', () => {
    for (const depth of ['abc', '0', '-2']) {
      const { stdout, status } = tryCli(`impact pay --depth ${depth}`, { cwd: root });
      expect(status).toBe(1);
      expect(stdout).toContain('--depth must be a positive whole number');
    }
  });

  it('takes a valid depth', () => {
    const { stdout, status } = tryCli('impact pay --depth 1', { cwd: root });
    expect(status).toBe(0);
    expect(stdout).toContain('app.paid');
  });
});
