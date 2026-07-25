import { defineConfig } from 'vitest/config';

/**
 * Compiled output holds copies of the test files. Vitest 3 skipped them
 * implicitly, Vitest 4 does not — and running them means testing a stale build
 * alongside the source. `exclude` has to sit on each project, since a root-level
 * one is not inherited.
 */
const project = (name: string, testTimeout?: number) => ({
  test: {
    name,
    root: `packages/${name}`,
    exclude: ['**/node_modules/**', '**/dist/**'],
    ...(testTimeout ? { testTimeout } : {}),
  },
});

export default defineConfig({
  test: {
    projects: [
      project('core'),
      // The CLI tests spawn real processes; 5s is not enough under load and
      // made the end-to-end test fail at random.
      project('cli', 30_000),
      project('viewer'),
      project('mcp'),
    ],
  },
});
