import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReadTools } from '../tools/read.js';
import { createWriteTools } from '../tools/write.js';

/**
 * The tools that bring the MCP server level with the CLI: apply, verify and
 * scaffold. Each is a thin adapter over core, so these tests are about the
 * adapter — the write mode, where paths resolve from, what comes back.
 */
describe('MCP tools on a par with the CLI', () => {
  let root: string;
  let dir: string;

  const setup = (write: 'auto' | 'prompt' | 'locked') => {
    root = mkdtempSync(join(tmpdir(), 'eventgraph-mcp-parity-'));
    dir = join(root, 'eventgraph');
    mkdirSync(join(dir, 'contexts', 'shop'), { recursive: true });
    writeFileSync(join(dir, 'eventgraph.yaml'), `name: test\nversion: 1\npreset: event-modeling\nagent:\n  write: ${write}\ncontexts:\n  - shop\n`);
    writeFileSync(
      join(dir, 'contexts', 'shop', 'model.yaml'),
      'context: shop\nnodes:\n  customer: { type: actor }\n  place-order: { type: command, src: src/place.ts }\nedges:\n  issues: { customer: [place-order] }\n'
    );
  };
  const modelFile = () => readFileSync(join(dir, 'contexts', 'shop', 'model.yaml'), 'utf-8');

  beforeEach(() => setup('auto'));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const BATCH = 'context: shop\nnodes:\n  order-placed: { type: event }\nedges:\n  produces: { place-order: [order-placed] }\n';

  describe('eventgraph_apply', () => {
    it('merges a model in auto mode', async () => {
      const result = await createWriteTools(dir).eventgraph_apply.run({ model: BATCH });
      expect(result).toMatchObject({ status: 'applied', changes: [{ context: 'shop', nodesAdded: 1, edgesAdded: 1 }] });
      expect(modelFile()).toContain('order-placed');
    });

    it('reports validation errors and writes nothing', async () => {
      const before = modelFile();
      const result = await createWriteTools(dir).eventgraph_apply.run({ model: 'context: shop\nnodes: {}\nedges:\n  produces: { place-order: [nowhere] }\n' });
      expect(result).toMatchObject({ status: 'invalid', errors: [expect.stringMatching(/dangling-edge/)] });
      expect(modelFile()).toBe(before);
    });

    it('reports unparseable input as an error rather than throwing', async () => {
      const result = await createWriteTools(dir).eventgraph_apply.run({ model: 'context: shop\nnodes: {' });
      expect(result).toMatchObject({ status: 'refused', error: expect.any(String) });
    });

    it('only says what it would do in prompt mode', async () => {
      rmSync(root, { recursive: true, force: true });
      setup('prompt');
      const before = modelFile();
      const result = await createWriteTools(dir).eventgraph_apply.run({ model: BATCH });
      expect(result).toMatchObject({ status: 'proposed', pendingDiff: expect.stringMatching(/shop: 1 node\(s\) added, 1 edge\(s\) added/) });
      expect(modelFile()).toBe(before);
    });

    it('refuses in locked mode', async () => {
      rmSync(root, { recursive: true, force: true });
      setup('locked');
      const result = await createWriteTools(dir).eventgraph_apply.run({ model: BATCH });
      expect(result).toMatchObject({ status: 'refused', error: expect.stringMatching(/locked/) });
    });

    it('honours dryRun in auto mode', async () => {
      const before = modelFile();
      const result = await createWriteTools(dir).eventgraph_apply.run({ model: BATCH, dryRun: true });
      expect(result).toMatchObject({ status: 'planned' });
      expect(modelFile()).toBe(before);
    });
  });

  describe('eventgraph_init_context', () => {
    it('creates and registers a context', async () => {
      expect(await createWriteTools(dir).eventgraph_init_context.run({ name: 'billing' })).toMatchObject({ status: 'applied' });
      expect(readFileSync(join(dir, 'eventgraph.yaml'), 'utf-8')).toContain('- billing');
      expect(readFileSync(join(dir, 'contexts', 'billing', 'model.yaml'), 'utf-8')).toContain('context: billing');
    });

    // It used to write an empty model over whatever was there.
    it('leaves an existing context alone', async () => {
      const before = modelFile();
      const result = await createWriteTools(dir).eventgraph_init_context.run({ name: 'shop' });
      expect(result).toMatchObject({ status: 'refused', error: expect.stringMatching(/already exists/) });
      expect(modelFile()).toBe(before);
    });

    it('refuses a name that is a path', async () => {
      const result = await createWriteTools(dir).eventgraph_init_context.run({ name: '../../escaped' });
      expect(result.status).toBe('invalid');
      expect(existsSync(join(root, 'escaped'))).toBe(false);
      expect(readFileSync(join(dir, 'eventgraph.yaml'), 'utf-8')).not.toContain('escaped');
    });

    it('obeys the write mode like every other write', async () => {
      rmSync(root, { recursive: true, force: true });
      setup('locked');
      expect(await createWriteTools(dir).eventgraph_init_context.run({ name: 'billing' })).toMatchObject({ status: 'refused' });
      expect(existsSync(join(dir, 'contexts', 'billing'))).toBe(false);
    });
  });

  describe('eventgraph_verify', () => {
    it('resolves pointers from the directory above the project by default', async () => {
      const broken = await createReadTools(dir).eventgraph_verify.run({});
      expect(broken.ok).toBe(false);
      expect(broken.issues.map(i => i.pointer)).toEqual(['src/place.ts']);

      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'src', 'place.ts'), '');
      const fixed = await createReadTools(dir).eventgraph_verify.run({});
      expect(fixed).toMatchObject({ ok: true, issues: [], sourceRoot: root });
    });

    it('takes a root relative to that directory', async () => {
      mkdirSync(join(root, 'app', 'src'), { recursive: true });
      writeFileSync(join(root, 'app', 'src', 'place.ts'), '');
      expect((await createReadTools(dir).eventgraph_verify.run({ root: 'app' })).ok).toBe(true);
    });
  });

  describe('a project whose eventgraph.yaml sits in the repository root', () => {
    // root/repo is the project itself; root/sibling is somebody else's code.
    const flat = () => {
      const repo = join(root, 'repo');
      mkdirSync(join(repo, 'contexts', 'app'), { recursive: true });
      mkdirSync(join(repo, 'src'));
      mkdirSync(join(root, 'sibling'));
      writeFileSync(join(repo, 'eventgraph.yaml'), 'name: flat\nversion: 1\npreset: event-modeling\nagent:\n  write: auto\ncontexts:\n  - app\n');
      writeFileSync(join(repo, 'contexts', 'app', 'model.yaml'), 'context: app\nnodes:\n  act: { type: command, src: src/cli.ts }\nedges: {}\n');
      writeFileSync(join(repo, 'src', 'cli.ts'), `import { Command } from 'commander';\nprogram.command('own');`);
      writeFileSync(join(root, 'sibling', 'cli.ts'), `import { Command } from 'commander';\nprogram.command('foreign');`);
      return repo;
    };

    it('scaffolds the repository, not its neighbours', async () => {
      const result = await createReadTools(flat()).eventgraph_scaffold.run({});
      expect(result.scanned).toBe(1);
      expect(result.model).toContain('own-cli');
      expect(result.model).not.toContain('foreign');
    });

    it('resolves pointers from the repository', async () => {
      expect(await createReadTools(flat()).eventgraph_verify.run({})).toMatchObject({ ok: true, checked: 1 });
    });
  });

  describe('eventgraph_scaffold', () => {
    it('returns a model to review, and writes nothing', async () => {
      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'src', 'cli.ts'), `import { Command } from 'commander';\nprogram.command('place');`);
      const before = modelFile();
      const result = await createReadTools(dir).eventgraph_scaffold.run({ context: 'shop' });
      expect(result.scanned).toBe(1);
      expect(result.model).toContain('place-cli');
      expect(result.counts?.headless).toBe(1);
      expect(modelFile()).toBe(before);
    });

    it('names the languages it cannot read instead of returning an empty model silently', async () => {
      mkdirSync(join(root, 'App'));
      writeFileSync(join(root, 'App', 'Main.swift'), '');
      const result = await createReadTools(dir).eventgraph_scaffold.run({});
      expect(result).toMatchObject({ scanned: 0, model: null, unread: [{ language: 'Swift', files: 1 }] });
    });
  });
});
