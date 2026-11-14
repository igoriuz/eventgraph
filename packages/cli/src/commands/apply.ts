import { Command } from 'commander';
import { readFileSync, readSync } from 'node:fs';
import {
  applyModels,
  findProjectDir,
  loadConfig,
  loadPreset,
  parseContextModels,
  qualifiedId,
  type ContextChange,
  type ContextModel,
} from 'eventgraph-core';
import { presetsDir } from '../util.js';

/** The merge itself lives in core (`applyModels`); this reads the input and prints the outcome. */

function readInput(file: string | undefined): string {
  if (file && file !== '-') return readFileSync(file, 'utf-8');
  return readStdin();
}

/**
 * Reads stdin to the end.
 *
 * `readFileSync(0)` looks like the obvious way and fails with EAGAIN the
 * moment stdin is a pipe rather than a file — which is every use of the
 * documented `eventgraph scaffold | eventgraph apply -`. A pipe hands over
 * whatever has been written so far, so the read has to be retried until the
 * writer closes it.
 */
function readStdin(): string {
  const chunks: Buffer[] = [];
  const buffer = Buffer.alloc(64 * 1024);

  for (;;) {
    let read: number;
    try {
      read = readSync(0, buffer, 0, buffer.length, null);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EAGAIN') {
        // Nothing buffered yet; yield rather than spin the CPU.
        sleep(5);
        continue;
      }
      if (code === 'EOF') break;
      throw error;
    }
    if (read === 0) break;
    chunks.push(Buffer.from(buffer.subarray(0, read)));
  }

  return Buffer.concat(chunks).toString('utf-8');
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function registerApplyCommand(program: Command): void {
  program
    .command('apply')
    .argument('[file]', 'Model file, or - for stdin', '-')
    .description('Merge one or more context models into the project')
    .option('--replace', 'Replace the named contexts instead of merging into them')
    .option('--dry-run', 'Report what would change without writing')
    .option('--json', 'machine-readable output')
    .action((file, opts) => {
      const projectDir = findProjectDir();
      if (!projectDir) {
        console.error('Error: No eventgraph project found. Run "eventgraph init" first.');
        process.exit(1);
      }
      let incoming: ContextModel[];
      try {
        incoming = parseContextModels(readInput(file));
      } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        process.exit(2);
      }

      const preset = loadPreset(loadConfig(projectDir).preset, presetsDir());
      const { changes: applied, errors } = applyModels(projectDir, incoming, preset, {
        replace: Boolean(opts.replace),
        dryRun: Boolean(opts.dryRun),
      });
      if (errors.length > 0) {
        console.error(`Refusing to apply — ${errors.length} validation error(s):\n`);
        for (const e of errors) console.error(`  ✗ [${e.type}] ${e.message}`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify({ dryRun: Boolean(opts.dryRun), contexts: applied.map(summary) }, null, 2));
        return;
      }

      const verb = opts.dryRun ? 'Would apply' : 'Applied';
      console.log(`${verb} ${applied.length} context(s):`);
      for (const change of applied) {
        const bits = [
          `${change.nodesAdded} node(s) added`,
          change.nodesReplaced > 0 ? `${change.nodesReplaced} replaced` : '',
          `${change.edgesAdded} edge(s) added`,
          change.isNew ? 'new context' : '',
        ].filter(Boolean);
        console.log(`  ${change.context}: ${bits.join(', ')}`);
      }
    });
}

function summary(change: ContextChange) {
  return {
    context: change.context,
    nodesAdded: change.nodesAdded,
    nodesReplaced: change.nodesReplaced,
    edgesAdded: change.edgesAdded,
    isNew: change.isNew,
    nodes: change.model.nodes.map(n => qualifiedId(change.context, n.id)),
  };
}
