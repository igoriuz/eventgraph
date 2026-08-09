import { Command } from 'commander';
import { checkGraph, loadPreset, ruleCatalog, unknownRuleIds, type Finding, type Lane } from 'eventgraph-core';
import { loadOrFail, presetsDir } from '../util.js';

const LANES: Lane[] = ['bootstrap', 'structure', 'ux', 'backend', 'platform'];

function print(findings: Finding[], total: number): void {
  for (const f of findings) {
    console.log(`${f.severity === 'error' ? '✗' : '!'} ${f.node}`);
    console.log(`  ${f.message}  [${f.rule}]`);
    console.log(`  → ${f.hint}\n`);
  }
  const errors = findings.filter(f => f.severity === 'error').length;
  console.log(`${errors} error(s), ${findings.length - errors} warning(s) across ${total} nodes`);
}

export function registerCheckCommand(program: Command): void {
  program
    .command('check')
    .description('Check the graph for completeness gaps, not just shape')
    .option('-l, --lane <lane>', `restrict to one lane (${LANES.join(', ')})`)
    .option('-n, --next [count]', 'show only the most pressing gaps')
    .option('--json', 'machine-readable output')
    .action((opts) => {
      const lane = opts.lane as Lane | undefined;
      if (lane && !LANES.includes(lane)) {
        console.error(`Error: --lane must be one of ${LANES.join(', ')}`);
        process.exit(2);
      }

      const { graph, config } = loadOrFail();
      const preset = loadPreset(config.preset, presetsDir());

      const unknown = unknownRuleIds(preset);
      if (unknown.length > 0) {
        console.error(`Warning: preset "${preset.name}" names unimplemented rules: ${unknown.join(', ')}`);
      }
      if (!preset.rules?.length) {
        console.error(
          `Preset "${preset.name}" declares no completeness rules, so there is nothing to check beyond shape.\n` +
            `Run "eventgraph validate" for shape, or switch to a preset that defines rules.`
        );
        process.exit(0);
      }

      let findings = checkGraph(graph, preset, { lane });
      const total = graph.getAllNodes().length;

      if (opts.next) {
        const limit = opts.next === true ? 3 : Number(opts.next);
        findings = findings.slice(0, Number.isFinite(limit) ? limit : 3);
      }

      if (opts.json) {
        console.log(JSON.stringify({ ok: findings.every(f => f.severity !== 'error'), nodes: total, findings }, null, 2));
      } else if (findings.length === 0) {
        console.log(`✓ ${total} nodes, no findings`);
      } else {
        print(findings, total);
      }

      process.exit(findings.some(f => f.severity === 'error') ? 1 : 0);
    });

  program
    .command('rules')
    .description('List the completeness rules and why each exists')
    .option('--json', 'machine-readable output')
    .action((opts) => {
      const catalog = ruleCatalog();
      if (opts.json) {
        console.log(JSON.stringify(catalog.map(({ id, lane, severity, about }) => ({ id, lane, severity, about })), null, 2));
        return;
      }
      let lane = '';
      for (const rule of catalog) {
        if (rule.lane !== lane) {
          lane = rule.lane;
          console.log(`\n── ${lane} ──\n`);
        }
        console.log(`${rule.severity === 'error' ? '✗' : '!'} ${rule.id}\n  ${rule.about}\n`);
      }
    });
}
