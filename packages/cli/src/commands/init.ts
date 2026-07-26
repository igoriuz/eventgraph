import { Command } from 'commander';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import inquirer from 'inquirer';

const WRITE_MODES = ['prompt', 'auto', 'locked'] as const;
type WriteMode = (typeof WRITE_MODES)[number];

interface Answers {
  name: string;
  preset: string;
  agentWrite: WriteMode;
  contexts: string[];
}

/**
 * Everything the prompts ask for is also a flag, and `--yes` skips the prompts
 * entirely. An agent cannot answer an inquirer prompt, so an interactive-only
 * init meant the very first step of the workflow needed a human.
 */
function optionAnswers(opts: Record<string, unknown>): Answers | null {
  if (!opts.yes) return null;
  const contexts = String(opts.context ?? 'core')
    .split(',')
    .map(c => c.trim())
    .filter(Boolean);

  return {
    name: String(opts.name ?? 'my-project'),
    preset: String(opts.preset ?? 'event-modeling'),
    agentWrite: (opts.agentWrite ?? 'prompt') as WriteMode,
    contexts: contexts.length > 0 ? contexts : ['core'],
  };
}

async function promptAnswers(opts: Record<string, unknown>): Promise<Answers> {
  const answers = await inquirer.prompt([
    { type: 'input', name: 'name', message: 'Project name:', default: opts.name ?? 'my-project' },
    {
      type: 'list',
      name: 'preset',
      message: 'Choose a preset:',
      choices: ['event-modeling', 'generic'],
      default: opts.preset ?? 'event-modeling',
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
      default: opts.agentWrite ?? 'prompt',
    },
    {
      type: 'input',
      name: 'firstContext',
      message: 'Bounded contexts (comma-separated):',
      default: opts.context ?? 'core',
    },
  ]);

  return {
    name: answers.name,
    preset: answers.preset,
    agentWrite: answers.agentWrite,
    contexts: String(answers.firstContext).split(',').map((c: string) => c.trim()).filter(Boolean),
  };
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new eventgraph project')
    .option('-d, --dir <path>', 'Target directory', process.cwd())
    .option('-y, --yes', 'Skip the prompts and use the flags below')
    .option('-n, --name <name>', 'Project name')
    .option('-p, --preset <preset>', 'Preset (event-modeling or generic)')
    .option('-c, --context <names>', 'Bounded contexts, comma-separated')
    .option('--agent-write <mode>', `Agent write mode (${WRITE_MODES.join(', ')})`)
    .action(async (opts) => {
      const targetDir = join(opts.dir, 'eventgraph');

      if (existsSync(join(targetDir, 'eventgraph.yaml'))) {
        console.error('Error: eventgraph project already exists in this directory.');
        process.exit(1);
      }

      if (opts.agentWrite && !WRITE_MODES.includes(opts.agentWrite)) {
        console.error(`Error: --agent-write must be one of ${WRITE_MODES.join(', ')}`);
        process.exit(2);
      }

      const answers = optionAnswers(opts) ?? (await promptAnswers(opts));

      const config = {
        name: answers.name,
        version: 1,
        preset: answers.preset,
        agent: { write: answers.agentWrite },
        contexts: answers.contexts,
      };

      for (const context of answers.contexts) {
        mkdirSync(join(targetDir, 'contexts', context), { recursive: true });
        writeFileSync(
          join(targetDir, 'contexts', context, 'model.yaml'),
          `context: ${context}\nnodes: {}\nedges: {}\n`
        );
      }
      writeFileSync(join(targetDir, 'eventgraph.yaml'), stringifyYaml(config, { lineWidth: 120 }));

      console.log(`\nEventgraph project initialized at ${targetDir}`);
      console.log(`  Preset: ${answers.preset}`);
      console.log(`  Agent mode: ${answers.agentWrite}`);
      console.log(`  Contexts: ${answers.contexts.join(', ')}`);
      console.log(`\nNext steps:`);
      console.log(`  1. Describe the model: eventgraph apply model.yaml`);
      console.log(`  2. Find the gaps:      eventgraph check --next`);
      console.log(`  3. Look at it:         eventgraph view`);
    });
}
