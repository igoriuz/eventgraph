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
  'ios',
  'android',
  '__snapshots__',
]);

const SOURCE_EXT = /\.(tsx?|jsx?|mjs|cjs|prisma|dart)$/;
// Generated Dart is enormous and describes nothing the source does not.
const TEST_FILE = /(^|[./-])(test|spec)\.[tj]sx?$|__tests__|\.stories\.[tj]sx?$|\.(g|freezed|gr)\.dart$/;

/** Reads the files worth scanning under a root, skipping build output and tests. */
export function collectSources(root: string, limit = 5000): ScaffoldSource[] {
  const sources: ScaffoldSource[] = [];

  const walk = (dir: string): void => {
    if (sources.length >= limit) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (sources.length >= limit) return;
      if (entry.startsWith('.') && entry !== '.') continue;

      const full = join(dir, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        if (SKIP_DIRS.has(entry)) continue;
        walk(full);
        continue;
      }
      if (!SOURCE_EXT.test(entry) || TEST_FILE.test(entry)) continue;

      const path = relative(root, full).split(sep).join('/');
      try {
        sources.push({ path, content: readFileSync(full, 'utf-8') });
      } catch {
        // Unreadable file; a scaffold is a best effort, not an audit.
      }
    }
  };

  walk(root);
  return sources.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The source text of the call or object starting at `open`, brackets balanced.
 *
 * Every extractor that reads a declaration spanning lines needs this: a route
 * table entry, a reducer body, a table declaration.
 *
 * Comments are skipped before quotes are, because they are what actually breaks
 * this. An apostrophe in `// partner's encounter` opens a string that never
 * closes, and the block then runs to the end of the file — which reads as one
 * reducer emitting every event in the module rather than as a parse failure.
 */
export function blockAt(content: string, open: number): string {
  const closing: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const opening = content[open];
  if (!opening || !(opening in closing)) return '';
  const close = closing[opening]!;

  let depth = 0;
  for (let i = open; i < content.length; i++) {
    const char = content[i]!;

    if (char === '/' && content[i + 1] === '/') {
      const end = content.indexOf('\n', i);
      if (end === -1) break;
      i = end;
      continue;
    }
    if (char === '/' && content[i + 1] === '*') {
      const end = content.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      for (i++; i < content.length; i++) {
        if (content[i] === '\\') i++;
        else if (content[i] === quote) break;
      }
      continue;
    }

    if (char === opening) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return content.slice(open, i + 1);
    }
  }
  return content.slice(open);
}

// --- id helpers ------------------------------------------------------------

export function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s.]+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

/**
 * Keeps ids unique without renaming what came before, so scanning the same
 * tree twice produces the same model.
 */
export class IdSet {
  private taken = new Set<string>();

  /** `preferred` first, then each fallback, then a numeric suffix. */
  claim(preferred: string, ...fallbacks: string[]): string {
    for (const candidate of [preferred, ...fallbacks]) {
      const id = kebab(candidate);
      if (id && !this.taken.has(id)) {
        this.taken.add(id);
        return id;
      }
    }
    const base = kebab(preferred) || 'node';
    for (let n = 2; ; n++) {
      const id = `${base}-${n}`;
      if (!this.taken.has(id)) {
        this.taken.add(id);
        return id;
      }
    }
  }

  has(id: string): boolean {
    return this.taken.has(id);
  }
}

/**
 * Table names are plural and aggregate names are not. Naive, and wrong often
 * enough that the scaffold says so rather than presenting it as a fact.
 */
export function singularise(name: string): string {
  // address, status, analysis — an `s` that was never a plural.
  if (/(ss|us|is)$/.test(name)) return name;
  if (/ies$/.test(name)) return name.replace(/ies$/, 'y');
  if (/s$/.test(name)) return name.replace(/s$/, '');
  return name;
}

/**
 * The inverse, for naming a projection after the rows it holds.
 *
 * An aggregate is one encounter and a read-model is the list of them, so the
 * plural keeps the two apart in one namespace without a `-view` suffix that
 * would collide with a screen named after the same thing.
 */
export function pluralise(name: string): string {
  if (/(s|x|z|ch|sh)$/.test(name)) return `${name}es`;
  if (/[^aeiou]y$/.test(name)) return name.replace(/y$/, 'ies');
  return `${name}s`;
}

export function titleise(id: string): string {
  return id
    .split('-')
    .filter(Boolean)
    .map(w => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}
