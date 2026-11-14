import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { tryCli } from './cli-runner.js';

const TMP = join(tmpdir(), 'eventgraph-scaffold-test-' + Date.now());

function tree(files: Record<string, string>): string {
  for (const [file, content] of Object.entries(files)) {
    const full = join(TMP, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return TMP;
}

const ROUTE = `import express from 'express';\nconst app = express();\napp.post('/orders', (req, res) => res.json({}));\n`;

afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('scaffold and languages it cannot read', () => {
  it('fails on a Swift-only tree and names Swift', () => {
    const root = tree({ 'App/Main.swift': '', 'App/Store.swift': '' });
    const result = tryCli(`scaffold --root "${root}"`, { cwd: root });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('2 Swift file(s)');
    expect(result.stdout).toContain('TypeScript');
  });

  it('scaffolds the readable part and says what it walked past', () => {
    const root = tree({ 'src/api.ts': ROUTE, 'App/Main.swift': '' });
    // Notes go to stderr, which the runner only keeps on failure.
    const result = tryCli(`scaffold --root "${root}" 2>&1`, { cwd: root });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('kind: endpoint');
    expect(result.stdout).toContain('Not read, no extractor for the language: 1 Swift file(s)');
  });

  it('reports unread languages in --json', () => {
    const root = tree({ 'src/api.ts': ROUTE, 'App/Main.swift': '', 'tools/a.py': '', 'tools/b.py': '' });
    const result = tryCli(`scaffold --root "${root}" --json`, { cwd: root });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).unread).toEqual([
      { language: 'Python', files: 2 },
      { language: 'Swift', files: 1 },
    ]);
  });

  it('says nothing extra for a tree it reads in full', () => {
    const root = tree({ 'src/api.ts': ROUTE });
    const result = tryCli(`scaffold --root "${root}" --json`, { cwd: root });
    expect(JSON.parse(result.stdout).unread).toEqual([]);
  });
});
