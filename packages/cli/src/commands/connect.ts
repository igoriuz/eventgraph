import { Command } from 'commander';
import { addEdgeToContext, findProjectDir, loadConfig } from '@eventgraph/core';

export function registerConnectCommand(program: Command): void {
  program
    .command('connect')
    .argument('<from>', 'Source node ID')
    .argument('<to>', 'Target node ID')
    .description('Create an edge between two nodes')
    .option('-t, --type <type>', 'Edge type', 'depends-on')
    .option('-c, --context <context>', 'Context to add the edge to')
    .action((from, to, opts) => {
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

      addEdgeToContext(projectDir, context, { from, to, type: opts.type });

      console.log(`Connected ${from} → ${to} [${opts.type}] in context "${context}"`);
    });
}
