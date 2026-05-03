import { Command } from 'commander';
import { analyzeImpact } from '@eventgraph/core';
import { loadOrFail, formatNode } from '../util.js';

export function registerImpactCommand(program: Command): void {
  program
    .command('impact')
    .argument('<node-id>', 'Node ID (e.g., order-placed or payments.order-placed)')
    .description('Analyze impact: what is affected downstream?')
    .option('--depth <n>', 'Max traversal depth', '100')
    .action((nodeId, opts) => {
      const { graph } = loadOrFail();

      let qualifiedId = nodeId;
      if (!nodeId.includes('.')) {
        const match = graph.getAllNodes().find(n => n.id === nodeId);
        if (!match) {
          console.error(`Node not found: ${nodeId}`);
          process.exit(1);
        }
        qualifiedId = `${match.context}.${match.id}`;
      }

      const result = analyzeImpact(graph, qualifiedId, { maxDepth: parseInt(opts.depth) });

      const riskColors: Record<string, string> = {
        low: '\x1b[32m',
        medium: '\x1b[33m',
        high: '\x1b[31m',
      };
      const reset = '\x1b[0m';

      console.log(`\nImpact Analysis: ${qualifiedId}`);
      console.log(`Risk: ${riskColors[result.risk]}${result.risk.toUpperCase()}${reset} (${result.totalAffected} affected nodes)`);
      console.log(`Cross-context: ${result.crossContext ? 'yes' : 'no'}`);
      console.log(`Affected contexts: ${result.affectedContexts.join(', ') || 'none'}`);

      if (result.direct.length > 0) {
        console.log(`\nDirect (${result.direct.length}):`);
        for (const node of result.direct) {
          console.log('  ' + formatNode(node));
        }
      }

      if (result.transitive.length > 0) {
        console.log(`\nTransitive (${result.transitive.length}):`);
        for (const node of result.transitive) {
          console.log('  ' + formatNode(node));
        }
      }

      if (result.upstreamDependents.length > 0) {
        console.log(`\nUpstream dependents (${result.upstreamDependents.length}):`);
        for (const node of result.upstreamDependents) {
          console.log('  ' + formatNode(node));
        }
      }
    });
}
