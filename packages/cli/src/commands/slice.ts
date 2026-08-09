import { Command } from 'commander';
import { lifecycle, slice, type GraphNode } from 'eventgraph-core';
import { loadOrFail } from '../util.js';

const lane = (name: string, nodes: GraphNode[]) => {
  const cells = nodes.length ? nodes.map(n => n.label).join(', ') : '—';
  console.log(`  ${name.padEnd(12)} ${cells}`);
};

export function registerSliceCommand(program: Command): void {
  program
    .command('slice <event>')
    .description('Show the swimlane around one event — actor, screen, command, event, projections')
    .option('--json', 'machine-readable output')
    .action((event: string, opts: { json?: boolean }) => {
      const { graph } = loadOrFail();
      let s;
      try {
        s = slice(graph, event);
      } catch (e) {
        console.error(`Error: ${(e as Error).message}`);
        process.exit(1);
      }

      if (opts.json) {
        const ids = (nodes: GraphNode[]) => nodes.map(n => `${n.context}.${n.id}`);
        console.log(
          JSON.stringify(
            {
              event: `${s.event.context}.${s.event.id}`,
              actors: ids(s.actors),
              screens: ids(s.screens),
              causedBy: ids(s.causedBy),
              aggregate: s.aggregate ? `${s.aggregate.context}.${s.aggregate.id}` : null,
              readModels: ids(s.readModels),
              policies: ids(s.policies),
              shownOn: ids(s.shownOn),
            },
            null,
            2
          )
        );
        return;
      }

      console.log(`\nslice: ${s.event.label}\n`);
      lane('actor', s.actors);
      lane('screen', s.screens);
      lane('command', s.causedBy);
      lane('event', [s.event]);
      lane('aggregate', s.aggregate ? [s.aggregate] : []);
      lane('read-model', s.readModels);
      lane('policy', s.policies);
      lane('shown on', s.shownOn);
      console.log();
    });

  program
    .command('lifecycle <aggregate>')
    .description("Show an aggregate's events, the one that ends its life last")
    .option('--json', 'machine-readable output')
    .action((aggregate: string, opts: { json?: boolean }) => {
      const { graph } = loadOrFail();
      let events: GraphNode[];
      try {
        events = lifecycle(graph, aggregate);
      } catch (e) {
        console.error(`Error: ${(e as Error).message}`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(
          JSON.stringify(
            events.map(e => ({ id: `${e.context}.${e.id}`, ends: e.data?.ends_lifecycle === true })),
            null,
            2
          )
        );
        return;
      }

      console.log(`\n${aggregate}\n`);
      for (const e of events) {
        const ends = e.data?.ends_lifecycle === true ? '  ⊣ ends lifecycle' : '';
        console.log(`  ${e.id.padEnd(30)} ${e.label}${ends}`);
      }
      if (events.length === 0) console.log('  (no events belong to this aggregate)');
      console.log();
    });
}
