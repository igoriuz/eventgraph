import { Command } from 'commander';
import { addNodeToContext, loadConfig, findProjectDir } from '@eventgraph/core';
import type { ContextModelNode } from '@eventgraph/core';

export function registerAddCommand(program: Command): void {
  program
    .command('add')
    .argument('<type>', 'Node type (e.g., command, event, read-model)')
    .argument('<id>', 'Node ID (kebab-case)')
    .description('Add a node to a context')
    .option('-l, --label <label>', 'Human-readable label')
    .option('-c, --context <context>', 'Target context')
    .action((type, id, opts) => {
      const projectDir = findProjectDir();
      if (!projectDir) {
        console.error('Error: No eventgraph project found. Run "eventgraph init" first.');
        process.exit(1);
      }

      const config = loadConfig(projectDir);
      const context = opts.context ?? config.contexts[0];

      if (!config.contexts.includes(context)) {
        console.error(`Error: Context "${context}" not found. Available: ${config.contexts.join(', ')}`);
        process.exit(1);
      }

      const label = opts.label ?? id.split('-').map((w: string) => w[0].toUpperCase() + w.slice(1)).join(' ');

      const node: ContextModelNode = { id, type, label };
      addNodeToContext(projectDir, context, node);

      console.log(`Added [${type}] ${context}.${id} — ${label}`);
    });
}
