import { Command } from 'commander';

export function registerViewCommand(program: Command): void {
  program
    .command('view')
    .description('Generate and open the HTML viewer')
    .option('-o, --output <path>', 'Output file path')
    .option('--no-open', 'Do not open in browser')
    .action(() => {
      console.log('Viewer not yet available. Coming soon.');
    });
}
