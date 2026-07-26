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
  if (/(ss|us|is|s s)$/.test(name)) return name;
  if (/ies$/.test(name)) return name.replace(/ies$/, 'y');
  if (/s$/.test(name)) return name.replace(/s$/, '');
  return name;
}

export function titleise(id: string): string {
  return id
    .split('-')
    .filter(Boolean)
    .map(w => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}
