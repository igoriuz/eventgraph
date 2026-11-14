import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** One source file, with its path relative to the scanned root. */
export interface ScaffoldSource {
  /** Always forward-slashed, so ids and pointers look the same on any platform. */
  path: string;
  content: string;
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.expo',
  '__snapshots__',
]);

/**
 * Generated wrappers in a Flutter or React Native project, so nothing is read
 * from them. They are still counted as unread: the same name holds a whole
 * native app when one sits beside a backend.
 */
const NATIVE_DIRS = new Set(['ios', 'android']);

const SOURCE_EXT = /\.(tsx?|jsx?|mjs|cjs|mts|cts|prisma|dart)$/;
// Generated Dart is enormous and describes nothing the source does not.
const TEST_FILE = /(^|[./-])(test|spec)\.[cm]?[tj]sx?$|__tests__|\.stories\.[tj]sx?$|\.(g|freezed|gr)\.dart$/;

/**
 * Source files scaffold walks past, by extension. Not a complete list of
 * languages — only what `unreadLanguages` can name instead of dropping silently.
 */
const UNREAD_EXT: Record<string, string> = {
  swift: 'Swift',
  kt: 'Kotlin',
  kts: 'Kotlin',
  java: 'Java',
  go: 'Go',
  py: 'Python',
  rb: 'Ruby',
  rs: 'Rust',
  cs: 'C#',
  php: 'PHP',
  gd: 'GDScript',
  m: 'Objective-C',
  mm: 'Objective-C',
  c: 'C/C++',
  cc: 'C/C++',
  cpp: 'C/C++',
  ex: 'Elixir',
  exs: 'Elixir',
  scala: 'Scala',
  vue: 'Vue',
  svelte: 'Svelte',
};

/** Every file under a root, skipping hidden entries and build output. */
function* walk(dir: string, skipNative: boolean): Generator<{ full: string; name: string }> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const name of entries) {
    if (name.startsWith('.')) continue;

    const full = join(dir, name);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      if (SKIP_DIRS.has(name) || (skipNative && NATIVE_DIRS.has(name))) continue;
      yield* walk(full, skipNative);
    } else {
      yield { full, name };
    }
  }
}

/** Reads the files worth scanning under a root, skipping build output and tests. */
export function collectSources(root: string, limit = 5000): ScaffoldSource[] {
  const sources: ScaffoldSource[] = [];

  for (const { full, name } of walk(root, true)) {
    if (sources.length >= limit) break;
    if (!SOURCE_EXT.test(name) || TEST_FILE.test(name)) continue;

    const path = relative(root, full).split(sep).join('/');
    try {
      sources.push({ path, content: readFileSync(full, 'utf-8') });
    } catch {
      // Unreadable file; a scaffold is a best effort, not an audit.
    }
  }

  return sources.sort((a, b) => a.path.localeCompare(b.path));
}

export interface UnreadLanguage {
  language: string;
  files: number;
}

/**
 * Source under a root in languages no extractor reads, most files first.
 *
 * Without this a Swift or Kotlin tree scaffolds to nothing, or to the few
 * TypeScript files beside it, and the output cannot be told apart from an app
 * that simply has little in it.
 */
export function unreadLanguages(root: string): UnreadLanguage[] {
  const files = new Map<string, number>();
  for (const { name } of walk(root, false)) {
    const dot = name.lastIndexOf('.');
    if (dot === -1) continue;
    const ext = name.slice(dot + 1).toLowerCase();
    if (!Object.hasOwn(UNREAD_EXT, ext)) continue;
    const language = UNREAD_EXT[ext]!;
    files.set(language, (files.get(language) ?? 0) + 1);
  }
  return [...files]
    .map(([language, count]) => ({ language, files: count }))
    .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));
}
