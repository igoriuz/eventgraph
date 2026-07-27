import { Command } from 'commander';
import { resolve } from 'node:path';
import {
  collectSources,
  scaffold,
  stringifyContextModel,
  EXTRACTORS,
  type Extractor,
} from '@eventgraph/core';

/**
 * Emits a partial model to stdout rather than writing it, so the usual shape is
 *
 *     eventgraph scaffold --root ../ --context app | eventgraph apply -
 *
 * with a look at the middle when you want one. Writing straight into the
 * project would make a guess indistinguishable from a decision.
 */
export function registerScaffoldCommand(program: Command): void {
  program
    .command('scaffold')
    .description('Extract surfaces, navigation and aggregates from source')
    .option('-r, --root <path>', 'Directory to scan', process.cwd())
    .option('-c, --context <name>', 'Context name for the emitted model', 'core')
    .option('--only <list>', `Limit extractors (${EXTRACTORS.join(', ')})`)
    .option('--json', 'machine-readable output')
    .action((opts) => {
      let only: Extractor[] | undefined;
      if (opts.only) {
        only = String(opts.only).split(',').map(s => s.trim()) as Extractor[];
        const unknown = only.filter(e => !EXTRACTORS.includes(e));
        if (unknown.length > 0) {
          console.error(`Error: unknown extractor(s) ${unknown.join(', ')}. Known: ${EXTRACTORS.join(', ')}`);
          process.exit(2);
        }
      }

      const root = resolve(opts.root);
      const sources = collectSources(root);
      if (sources.length === 0) {
        console.error(`Error: no source files under ${root}`);
        process.exit(1);
      }

      const report = scaffold(sources, { context: opts.context, only });

      if (opts.json) {
        console.log(JSON.stringify({ ...report, scanned: sources.length }, null, 2));
        return;
      }

      if (report.model.nodes.length === 0) {
        console.error(`Scanned ${sources.length} file(s) under ${root} and recognised nothing.`);
        console.error(
          'Supported: HTTP route registrations, file-routed and router-table screens,\n' +
            'ORM table declarations, and modules that declare commands and events outright.'
        );
        process.exit(1);
      }

      // Notes go to stderr so the document on stdout stays pipeable into apply.
      console.error(`Scanned ${sources.length} file(s) under ${root}`);
      for (const note of report.notes) console.error(`  · ${note}`);
      console.error(`\n${caveat(report.counts.domain > 0)}\nReview, then: eventgraph apply -\n`);

      console.log(header(report.model.context, report.counts.domain > 0));
      console.log(stringifyContextModel(report.model));
    });
}

/**
 * What was read versus what is still open, which differs by source.
 *
 * A module that names its own reducers and events hands over most of the write
 * model; an HTTP service hands over none of it. Saying the same thing in both
 * cases would either undersell the first or overstate the second.
 */
function caveat(hasDomain: boolean): string {
  return hasDomain
    ? 'Commands and events here were read from declarations, not guessed. Policies,\n' +
        'invariants and actors are still the modelling, as is which aggregate each\n' +
        'event belongs to.'
    : 'Commands, events, policies and invariants are not guessed — they are the modelling.';
}

function header(context: string, hasDomain: boolean): string {
  const scope = hasDomain
    ? 'surfaces, navigation, and the commands and events the module declares'
    : 'surfaces, navigation and aggregates only';
  return [
    `# Scaffolded from source: ${scope}.`,
    `# Every node here is a candidate — check the entry screen, the aggregate`,
    `# names, and whether each table really owns state before applying.`,
    `# Context: ${context}`,
  ].join('\n');
}
