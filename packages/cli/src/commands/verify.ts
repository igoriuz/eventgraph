import { Command } from 'commander';
import { resolve } from 'node:path';
import { sourceRootOf, verifyAll } from 'eventgraph-core';
import { loadOrFail } from '../util.js';

/**
 * The checks here need the filesystem, which is what separates them from
 * `check`: whether the graph still describes code that exists, whether two
 * codebases still agree on a contract only the graph holds both ends of, and
 * whether a CLI subcommand the model claims is really there.
 */
export function registerVerifyCommand(program: Command): void {
  program
    .command('verify')
    .description('Check the model against the code: pointers resolve, callers know the rejections')
    .option('-r, --root <path>', 'Where source pointers resolve from (default: the directory holding eventgraph/)')
    .option('--json', 'machine-readable output')
    .action((opts: { root?: string; json?: boolean }) => {
      const { projectDir, graph } = loadOrFail();
      const sourceRoot = opts.root ? resolve(opts.root) : sourceRootOf(projectDir);
      const report = verifyAll(graph, sourceRoot);
      const { contract, cli } = report;
      const failed = !report.ok;

      if (opts.json) {
        console.log(JSON.stringify({ sourceRoot, ...report }, null, 2));
        process.exit(failed ? 1 : 0);
      }

      const clean = !failed && report.undeclared.length === 0;

      if (clean) {
        console.log(`✓ ${report.checked} pointer(s) across ${report.nodesWithPointers} node(s) all resolve`);
        if (contract.checked > 0) {
          console.log(
            `✓ ${contract.checked} rejection code(s) recognised by the ${contract.callers} caller(s) that can meet them`
          );
        }
        if (cli.checked > 0) {
          console.log(`✓ ${cli.checked} CLI subcommand(s) named in their source`);
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

      // Grouped by caller: one caller falling behind usually misses several
      // codes at once, and reading them together is what shows the pattern.
      const byCaller = new Map<string, typeof contract.issues>();
      for (const issue of contract.issues) {
        const list = byCaller.get(issue.caller) ?? [];
        list.push(issue);
        byCaller.set(issue.caller, list);
      }

      for (const [caller, missing] of byCaller) {
        console.log(`✗ ${caller}`);
        for (const issue of missing) {
          console.log(`  ${issue.code} — from ${issue.command}, appears nowhere in this caller's source`);
        }
        console.log(
          `  → handle the code, or drop it from the command's rejects if the service no longer answers with it\n`
        );
      }

      for (const issue of cli.issues) {
        console.log(`✗ ${issue.surface}`);
        console.log(`  offers ${issue.command}, but "${issue.name}" appears nowhere in its source`);
        console.log(`  → name the subcommand with the command id as a literal, or drop the offers edge\n`);
      }

      for (const id of report.undeclared) {
        console.log(`! ${id}`);
        console.log(`  marked implemented but names no source`);
        console.log(`  → add implemented_by, or drop the status back to draft\n`);
      }

      for (const id of contract.unsearchable) {
        console.log(`! ${id}`);
        console.log(`  issues or offers commands that reject, but its pointers matched no readable file`);
        console.log(`  → point implemented_by at the caller's source, or the contract goes unchecked\n`);
      }

      for (const id of cli.unsearchable) {
        console.log(`! ${id}`);
        console.log(`  offers commands, but its pointers matched no readable file`);
        console.log(`  → point implemented_by at the subcommand's source, or its names go unchecked\n`);
      }

      const parts = [`${report.issues.length} broken pointer(s)`];
      if (contract.issues.length > 0) parts.push(`${contract.issues.length} unhandled rejection(s)`);
      if (cli.issues.length > 0) parts.push(`${cli.issues.length} unnamed subcommand(s)`);
      parts.push(`${report.undeclared.length} undeclared`, `${report.checked} checked`);
      console.log(`${parts.join(', ')} (from ${sourceRoot})`);

      process.exit(failed ? 1 : 0);
    });
}
