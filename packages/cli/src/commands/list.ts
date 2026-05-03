import { Command } from 'commander';
import { loadOrFail, formatNode } from '../util.js';

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List all nodes')
    .option('-c, --context <name>', 'Filter by context')
    .option('-t, --type <type>', 'Filter by node type')
    .action((opts) => {
      const { graph } = loadOrFail();
      let nodes = graph.getAllNodes();

      if (opts.context) {
        nodes = nodes.filter(n => n.context === opts.context);
      }
      if (opts.type) {
        nodes = nodes.filter(n => n.type === opts.type);
      }

      if (nodes.length === 0) {
        console.log('No nodes found.');
        return;
      }

      console.log(`${nodes.length} node(s):\n`);
      for (const node of nodes) {
        console.log('  ' + formatNode(node));
      }
    });
}
