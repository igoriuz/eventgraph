import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/core',
      'packages/cli',
      'packages/viewer',
      'packages/mcp',
    ],
  },
});
