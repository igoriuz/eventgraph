import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { generateViewerHtml } from '@eventgraph/viewer';
import { loadOrFail } from '../util.js';

export function registerViewCommand(program: Command): void {
  program
    .command('view')
    .description('Generate and open the HTML viewer')
    .option('-o, --output <path>', 'Output file path')
    .option('--no-open', 'Do not open in browser')
    .action((opts) => {
      const { projectDir, config, graph } = loadOrFail();

      const html = generateViewerHtml(graph, config.name);
      const outputPath = opts.output ?? join(projectDir, '..', 'eventgraph-viewer.html');

      writeFileSync(outputPath, html);
      console.log(`Viewer generated: ${outputPath}`);

      if (opts.open !== false) {
        const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${openCmd} "${outputPath}"`);
      }
    });
}
