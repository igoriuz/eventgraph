import { Command } from 'commander';
import { resolve } from 'node:path';
import { verifyImplementations } from '@eventgraph/core';
import { loadOrFail } from '../util.js';

export function registerVerifyCommand(program: Command): void {
  program
    .command('verify')
    .description('Check that implemented_by still points at files that exist')
    .option('-r, --root <path>', 'Where source pointers resolve from (default: the project parent)')
    .option('--json', 'machine-readable output')
    .action((opts: { root?: string; json?: boolean }) => {
      const { projectDir, graph } = loadOrFail();
      const sourceRoot = resolve(opts.root ?? resolve(projectDir, '..'));
      const report = verifyImplementations(graph, sourceRoot);

      if (opts.json) {
        console.log(JSON.stringify({ sourceRoot, ...report }, null, 2));
        process.exit(report.issues.length > 0 ? 1 : 0);
      }

      if (report.issues.length === 0 && report.undeclared.length === 0) {
        console.log(`✓ ${report.checked} pointer(s) across ${report.nodesWithPointers} node(s) all resolve`);
        console.log(`  resolved from ${sourceRoot}`);
        return;
      }

      for (const issue of report.issues) {
        const where = issue.platform ? ` [${issue.platform}]` : '';
        console.log(`✗ ${issue.node}${where}`);
        console.log(`  ${issue.pointer}`);
        console.log(`  → file no longer exists; update the pointer or the code moved without the graph\n`);
      }

      for (const id of report.undeclared) {
        console.log(`! ${id}`);
        console.log(`  marked implemented but names no source`);
        console.log(`  → add implemented_by, or drop the status back to draft\n`);
      }

      console.log(
        `${report.issues.length} broken pointer(s), ${report.undeclared.length} undeclared, ` +
          `${report.checked} checked (from ${sourceRoot})`
      );
      process.exit(report.issues.length > 0 ? 1 : 0);
    });
}
