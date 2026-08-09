import { Command } from 'commander';
import { addNodeToContext, loadConfig, findProjectDir } from 'eventgraph-core';
import type { ContextModelNode } from 'eventgraph-core';

/**
 * Flag values are typed the way they read: `true`, `false` and numbers become
 * their own type, everything else stays a string. Rules distinguish the two —
 * `terminal: <reason>` carries prose, `idempotent: true` is a boolean — so a
 * setter that stringified everything could not express half the vocabulary.
 */
function coerce(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

function parseSets(pairs: string[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) {
      console.error(`Error: --set expects key=value, got "${pair}"`);
      process.exit(2);
    }
    data[pair.slice(0, eq)] = coerce(pair.slice(eq + 1));
  }
  return data;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function registerAddCommand(program: Command): void {
  program
    .command('add')
    .argument('<type>', 'Node type (e.g., command, event, read-model)')
    .argument('<id>', 'Node ID (kebab-case)')
    .description('Add a node to a context')
    .option('-l, --label <label>', 'Human-readable label')
    .option('-c, --context <context>', 'Target context')
    .option('-s, --set <key=value>', 'Set a semantic flag; repeatable', collect, [])
    .option('--src <path>', 'Source pointer for implemented_by; repeatable', collect, [])
    .action((type, id, opts) => {
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

      const label = opts.label ?? id.split('-').map((w: string) => w[0].toUpperCase() + w.slice(1)).join(' ');

      const data: Record<string, unknown> = parseSets(opts.set);
      if (opts.src.length > 0) {
        data.implemented_by = opts.src;
        data.status ??= 'implemented';
      }

      const node: ContextModelNode = { id, type, label };
      if (Object.keys(data).length > 0) node.data = data;

      try {
        addNodeToContext(projectDir, context, node);
      } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
      }

      const flags = Object.keys(data);
      console.log(
        `Added [${type}] ${context}.${id} — ${label}${flags.length ? ` (${flags.join(', ')})` : ''}`
      );
    });
}
