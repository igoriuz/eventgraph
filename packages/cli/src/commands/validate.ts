import { Command } from 'commander';
import { loadPreset, validateGraph } from 'eventgraph-core';
import { loadOrFail, presetsDir } from '../util.js';

export function registerValidateCommand(program: Command): void {
  program
    .command('validate')
    .description('Validate the model against preset rules')
    .action(() => {
      const { config, graph } = loadOrFail();

      const preset = loadPreset(config.preset, presetsDir());
      const errors = validateGraph(graph, preset);

      if (errors.length === 0) {
        console.log(`Model is valid. (${graph.getAllNodes().length} nodes, ${graph.getAllEdges().length} edges, preset: ${config.preset})`);
        return;
      }

      console.error(`Found ${errors.length} validation error(s):\n`);
      for (const err of errors) {
        console.error(`  ✗ [${err.type}] ${err.message}`);
      }
      process.exit(1);
    });
}
