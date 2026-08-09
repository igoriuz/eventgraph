import { Command } from 'commander';
import { resolve } from 'node:path';
import { verifyImplementations, verifyRejectionHandling } from 'eventgraph-core';
import { loadOrFail } from '../util.js';

/**
 * Both checks here need the filesystem, which is what separates them from
 * `check`: one asks whether the graph still describes code that exists, the
 * other whether two codebases still agree on a contract only the graph holds
 * both ends of.
 */
export function registerVerifyCommand(program: Command): void {
  program
    .command('verify')
    .description('Check the model against the code: pointers resolve, callers know the rejections')
    .option('-r, --root <path>', 'Where source pointers resolve from (default: the project parent)')
    .option('--json', 'machine-readable output')
    .action((opts: { root?: string; json?: boolean }) => {
      const { projectDir, graph } = loadOrFail();
      const sourceRoot = resolve(opts.root ?? resolve(projectDir, '..'));
      const report = verifyImplementations(graph, sourceRoot);
      const contract = verifyRejectionHandling(graph, sourceRoot);

      if (opts.json) {
        console.log(JSON.stringify({ sourceRoot, ...report, contract }, null, 2));
        process.exit(report.issues.length + contract.issues.length > 0 ? 1 : 0);
      }

      const clean =
        report.issues.length === 0 && report.undeclared.length === 0 && contract.issues.length === 0;

      if (clean) {
        console.log(`✓ ${report.checked} pointer(s) across ${report.nodesWithPointers} node(s) all resolve`);
        if (contract.checked > 0) {
          console.log(
            `✓ ${contract.checked} rejection code(s) recognised by the ${contract.actors} actor(s) that can meet them`
          );
        }
        console.log(`  resolved from ${sourceRoot}`);
        return;
      }

      for (const issue of report.issues) {
        const where = issue.platform ? ` [${issue.platform}]` : '';
        console.log(`✗ ${issue.node}${where}`);
        console.log(`  ${issue.pointer}`);
        console.log(`  → file no longer exists; update the pointer or the code moved without the graph\n`);
      }

      // Grouped by actor: one caller falling behind usually misses several
      // codes at once, and reading them together is what shows the pattern.
      const byActor = new Map<string, typeof contract.issues>();
      for (const issue of contract.issues) {
        const list = byActor.get(issue.actor) ?? [];
        list.push(issue);
        byActor.set(issue.actor, list);
      }

      for (const [actor, missing] of byActor) {
        console.log(`✗ ${actor}`);
        for (const issue of missing) {
          console.log(`  ${issue.code} — from ${issue.command}, appears nowhere in this actor's source`);
        }
        console.log(
          `  → handle the code, or drop it from the command's rejects if the service no longer answers with it\n`
        );
      }

      for (const id of report.undeclared) {
        console.log(`! ${id}`);
        console.log(`  marked implemented but names no source`);
        console.log(`  → add implemented_by, or drop the status back to draft\n`);
      }

      for (const id of contract.unsearchable) {
        console.log(`! ${id}`);
        console.log(`  issues commands that reject, but its pointers matched no readable file`);
        console.log(`  → point implemented_by at the caller's source, or the contract goes unchecked\n`);
      }

      const parts = [`${report.issues.length} broken pointer(s)`];
      if (contract.issues.length > 0) parts.push(`${contract.issues.length} unhandled rejection(s)`);
      parts.push(`${report.undeclared.length} undeclared`, `${report.checked} checked`);
      console.log(`${parts.join(', ')} (from ${sourceRoot})`);

      process.exit(report.issues.length + contract.issues.length > 0 ? 1 : 0);
    });
}
