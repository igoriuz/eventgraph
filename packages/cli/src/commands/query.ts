import { Command } from 'commander';
import { QueryEngine } from '@eventgraph/core';
import { loadOrFail, formatNode } from '../util.js';

export function registerQueryCommand(program: Command): void {
  program
    .command('query')
    .argument('<expression>', 'Query expression')
    .description('Query the graph (e.g., "type:event context:payments")')
    .action((expression) => {
      const { graph } = loadOrFail();
      const engine = new QueryEngine(graph);
      const results = engine.query(expression);

      if (results.length === 0) {
        console.log('No matching nodes found.');
        return;
      }

      console.log(`Found ${results.length} node(s):\n`);
      for (const node of results) {
        console.log('  ' + formatNode(node));
      }
    });
}
