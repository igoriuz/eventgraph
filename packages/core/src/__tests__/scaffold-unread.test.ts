import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectSources, unreadLanguages } from '../scaffold/index.js';

const TMP = join(tmpdir(), 'eventgraph-unread-test-' + Date.now());

function tree(files: string[]): string {
  for (const file of files) {
    const full = join(TMP, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, '');
  }
  return TMP;
}

afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('unreadLanguages', () => {
  it('names the languages no extractor reads, most files first', () => {
    const root = tree(['App/Main.swift', 'App/Store.swift', 'tools/gen.py', 'src/api.ts']);
    expect(unreadLanguages(root)).toEqual([
      { language: 'Swift', files: 2 },
      { language: 'Python', files: 1 },
    ]);
  });

  it('counts two extensions of one language together', () => {
    const root = tree(['build.gradle.kts', 'src/Main.kt']);
    expect(unreadLanguages(root)).toEqual([{ language: 'Kotlin', files: 2 }]);
  });

  it('is empty for a tree scaffold reads in full', () => {
    const root = tree(['src/api.ts', 'lib/main.dart', 'README.md', 'package.json']);
    expect(unreadLanguages(root)).toEqual([]);
  });

  it('does not take an extensionless or oddly named file for a language', () => {
    // `go` and `m` are extensions only after a dot, and `constructor` is a key
    // every plain object answers to.
    const root = tree(['bin/go', 'm', 'Makefile', 'notes.constructor', 'constructor']);
    expect(unreadLanguages(root)).toEqual([]);
  });

  it('skips the directories the collector skips', () => {
    const root = tree(['ios/Runner/AppDelegate.swift', 'node_modules/x/setup.py', '.build/Gen.swift']);
    expect(unreadLanguages(root)).toEqual([]);
  });
});

describe('collectSources', () => {
  it('still reads only supported files, sorted, without tests or skipped directories', () => {
    const root = tree([
      'src/b.ts',
      'src/a.tsx',
      'src/a.test.ts',
      'App/Main.swift',
      'node_modules/x/index.js',
      '.hidden/c.ts',
    ]);
    expect(collectSources(root).map(s => s.path)).toEqual(['src/a.tsx', 'src/b.ts']);
  });
});
