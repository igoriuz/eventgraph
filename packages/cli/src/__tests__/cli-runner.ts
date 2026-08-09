import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * These tests used to reach the CLI through `npx tsx`, which resolves tsx from
 * the registry rather than from this repo — the suite needed network access,
 * and a slow fetch under parallel load failed a run outright rather than
 * slowing it down. tsx is a devDependency now, and this runs its cli entry on
 * the node binary already executing the tests.
 */
const require_ = createRequire(import.meta.url);
const manifest = require_('tsx/package.json') as { bin: string | Record<string, string> };
const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.tsx;
const TSX = join(require_.resolve('tsx/package.json'), '..', entry);

export const CLI = join(import.meta.dirname, '..', 'index.ts');

export interface CliResult {
  stdout: string;
  status: number;
}

/** Runs the CLI and throws if it exits non-zero, as execSync would. */
export function execCli(args: string, opts: { cwd: string; input?: string }): string {
  return execSync(`"${process.execPath}" "${TSX}" "${CLI}" ${args}`, {
    cwd: opts.cwd,
    input: opts.input,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** Runs the CLI and reports the exit status instead of throwing. */
export function tryCli(args: string, opts: { cwd: string; input?: string }): CliResult {
  try {
    return { stdout: execCli(args, opts), status: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number };
    return { stdout: (e.stdout ?? '') + (e.stderr ?? ''), status: e.status ?? 1 };
  }
}
