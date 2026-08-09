import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { findProjectDir, isCompactModel, loadConfig, rewriteContextCompact } from '@eventgraph/core';

/**
 * Converts contexts from the original list form to the compact one.
 *
 * The conversion is the one place comments cannot be carried across — the list
 * form has no stable anchor to reattach them to — so it is a command you run
 * deliberately rather than something a write does behind your back.
 */
export function registerMigrateCommand(program: Command): void {
  program
    .command('migrate')
    .description('Rewrite contexts in the compact form')
    .option('--dry-run', 'Report what would be rewritten without writing')
    .action((opts) => {
      const projectDir = findProjectDir();
      if (!projectDir) {
        console.error('Error: No eventgraph project found. Run "eventgraph init" first.');
        process.exit(1);
      }
      const config = loadConfig(projectDir);

      const legacy = config.contexts.filter(context => {
        const path = join(projectDir, 'contexts', context, 'model.yaml');
        return !isCompactModel(parseYaml(readFileSync(path, 'utf-8')));
      });

      if (legacy.length === 0) {
        console.log(`✓ all ${config.contexts.length} context(s) already use the compact form`);
        return;
      }

      if (opts.dryRun) {
        console.log(`Would rewrite ${legacy.length} context(s): ${legacy.join(', ')}`);
        console.log('Comments in those files cannot be carried across the conversion.');
        return;
      }

      for (const context of legacy) {
        const model = rewriteContextCompact(projectDir, context);
        console.log(`  ${context}: ${model.nodes.length} node(s), ${model.edges.length} edge(s)`);
      }
      console.log(`\nRewrote ${legacy.length} context(s). Run "eventgraph validate" to confirm.`);
    });
}
