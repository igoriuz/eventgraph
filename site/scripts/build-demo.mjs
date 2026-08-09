import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/**
 * The landing page does not describe what eventgraph reports — it shows what
 * eventgraph actually reported, for the model in site/demo. Every finding and
 * every rule blurb on the page comes through here, so a rule whose wording
 * changed cannot leave a stale claim on the site.
 */
const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');
const demo = join(site, 'demo');

// The site depends on the CLI as a workspace package, so resolve its bin the
// way any consumer would rather than reaching across the repo by path.
const require_ = createRequire(import.meta.url);
const manifest = require_('@eventgraph/cli/package.json');
const cli = join(require_.resolve('@eventgraph/cli/package.json'), '..', manifest.bin.eventgraph);

if (!existsSync(cli)) {
  console.error(`Missing ${cli} — run \`pnpm build\` in the repo root first.`);
  process.exit(1);
}

/**
 * `check` exits non-zero when it finds something, which is the normal case
 * here — the demo model carries a deliberate gap. Only an empty stdout means
 * the CLI actually failed.
 */
function run(...args) {
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [cli, ...args], { cwd: demo, encoding: 'utf-8' });
  } catch (error) {
    stdout = error.stdout ?? '';
    if (!stdout.trim()) throw error;
  }
  return stdout;
}

const generated = join(site, 'src', 'generated');
mkdirSync(generated, { recursive: true });
mkdirSync(join(site, 'public'), { recursive: true });

// The interactive graph, straight out of `eventgraph view`.
run('view', '--no-open', '-o', join(site, 'public', 'demo.html'));

// The findings and the rule catalogue, as JSON.
for (const [name, args] of [
  ['check', ['check', '--json']],
  ['rules', ['rules', '--json']],
]) {
  const json = run(...args);
  JSON.parse(json); // fail loudly here rather than at render time
  writeFileSync(join(generated, `${name}.json`), json);
}

// The human-readable check output, for the terminal block in the hero.
writeFileSync(join(generated, 'check.txt'), run('check'));

console.log('demo: viewer, findings and rule catalogue regenerated');
