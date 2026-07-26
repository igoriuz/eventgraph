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

      let results;
      try {
        results = engine.query(expression);
      } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        process.exit(2);
      }

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
