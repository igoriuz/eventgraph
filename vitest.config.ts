import { defineConfig } from 'vitest/config';

/**
 * Compiled output holds copies of the test files. Vitest 3 skipped them
 * implicitly, Vitest 4 does not — and running them means testing a stale build
 * alongside the source. `exclude` has to sit on each project, since a root-level
 * one is not inherited.
 */
const project = (name: string) => ({
  test: {
    name,
    root: `packages/${name}`,
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});

export default defineConfig({
  test: {
    projects: [project('core'), project('cli'), project('viewer'), project('mcp')],
  },
});
