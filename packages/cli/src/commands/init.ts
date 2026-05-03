import { Command } from 'commander';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import inquirer from 'inquirer';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new eventgraph project')
    .option('-d, --dir <path>', 'Target directory', process.cwd())
    .action(async (opts) => {
      const targetDir = join(opts.dir, 'eventgraph');

      if (existsSync(join(targetDir, 'eventgraph.yaml'))) {
        console.error('Error: eventgraph project already exists in this directory.');
        process.exit(1);
      }

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Project name:',
          default: 'my-project',
        },
        {
          type: 'list',
          name: 'preset',
          message: 'Choose a preset:',
          choices: ['event-modeling', 'generic'],
          default: 'event-modeling',
        },
        {
          type: 'list',
          name: 'agentWrite',
          message: 'Agent write mode:',
          choices: [
            { name: 'prompt — Agent proposes changes, you confirm', value: 'prompt' },
            { name: 'auto — Agent writes directly', value: 'auto' },
            { name: 'locked — Read-only for agents', value: 'locked' },
          ],
          default: 'prompt',
        },
        {
          type: 'input',
          name: 'firstContext',
          message: 'Name of your first bounded context:',
          default: 'core',
        },
      ]);

      mkdirSync(join(targetDir, 'contexts', answers.firstContext), { recursive: true });

      const config = {
        name: answers.name,
        version: 1,
        preset: answers.preset,
        agent: { write: answers.agentWrite },
        contexts: [answers.firstContext],
      };
      writeFileSync(join(targetDir, 'eventgraph.yaml'), stringifyYaml(config, { lineWidth: 120 }));

      const contextModel = {
        context: answers.firstContext,
        nodes: [],
        edges: [],
      };
      writeFileSync(
        join(targetDir, 'contexts', answers.firstContext, 'model.yaml'),
        stringifyYaml(contextModel, { lineWidth: 120 }),
      );

      console.log(`\nEventgraph project initialized at ${targetDir}`);
      console.log(`  Preset: ${answers.preset}`);
      console.log(`  Agent mode: ${answers.agentWrite}`);
      console.log(`  Context: ${answers.firstContext}`);
      console.log(`\nNext steps:`);
      console.log(`  1. Add nodes: eventgraph add command place-order --label "Place Order"`);
      console.log(`  2. Validate: eventgraph validate`);
      console.log(`  3. View: eventgraph view`);
    });
}
