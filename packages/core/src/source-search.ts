import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { GraphNode } from './schema.js';
import { pointerPath, pointersOf } from './verify.js';

/**
 * Substring search over the source a node's `implemented_by` points at.
 *
 * Several checks ask the same question of the code: does this constant or name
 * appear anywhere in it? Matching is a substring search, deliberately — a parser
 * per language is not worth owning to find something that is missing entirely.
 */

/** Files worth searching for a constant. Broad, because callers are polyglot. */
const SOURCE_EXT =
  /\.(cs|lua|tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|kts|swift|rb|php|dart|scala|ex|exs|c|cc|cpp|h|hpp|m|mm|sh|sql|yaml|yml|json|toml)$/i;

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'bin',
  'obj',
  'target',
  'coverage',
  'vendor',
  '.next',
  '.expo',
]);

/** Anything larger is a bundle or a fixture, not code someone wrote. */
const MAX_BYTES = 2_000_000;

/** Every readable source file under a pointer, which may be a file or a tree. */
function filesUnder(root: string, into: string[]): void {
  let stats;
  try {
    stats = statSync(root);
  } catch {
    return;
  }

  if (stats.isFile()) {
    if (stats.size <= MAX_BYTES) into.push(root);
    return;
  }
  if (!stats.isDirectory()) return;

  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(root, entry);
    let entryStats;
    try {
      entryStats = statSync(full);
    } catch {
      continue;
    }
    if (entryStats.isDirectory()) filesUnder(full, into);
    else if (SOURCE_EXT.test(entry) && entryStats.size <= MAX_BYTES) into.push(full);
  }
}

/**
 * Every readable source file under a node's pointers, resolved from
 * `sourceRoot`. Empty when the node names no source or none of it exists.
 */
export function sourceFilesOf(node: GraphNode, sourceRoot: string): string[] {
  const files: string[] = [];
  for (const { pointer } of pointersOf(node)) {
    const path = pointerPath(pointer);
    if (path.length === 0) continue;
    filesUnder(isAbsolute(path) ? path : join(sourceRoot, path), files);
  }
  return files;
}

/**
 * Which of `needles` occur in any of `files`, reading each file once.
 * `fold` is applied to both sides before comparing, so a caller can decide
 * which spellings count as the same name.
 */
export function foundIn(
  files: string[],
  needles: Iterable<string>,
  fold: (text: string) => string = text => text
): Set<string> {
  const wanted = new Map([...needles].map(needle => [needle, fold(needle)]));
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.size === wanted.size) break;
    let content: string;
    try {
      content = fold(readFileSync(file, 'utf-8'));
    } catch {
      continue;
    }
    for (const [needle, folded] of wanted) {
      if (!seen.has(needle) && content.includes(folded)) seen.add(needle);
    }
  }
  return seen;
}

/** TOO_FAST, tooFast, TooFast, too-fast and too_fast as one spelling. */
export const ignoringCase = (text: string): string => text.toLowerCase().replace(/[_-]/g, '');
