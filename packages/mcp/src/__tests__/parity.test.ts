import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
      const result = await createWriteTools(dir).eventgraph_apply({ model: BATCH });
      expect(result).toMatchObject({ success: true, changes: [{ context: 'shop', nodesAdded: 1, edgesAdded: 1 }] });
      expect(modelFile()).toContain('order-placed');
    });

    it('reports validation errors and writes nothing', async () => {
      const before = modelFile();
      const result = await createWriteTools(dir).eventgraph_apply({ model: 'context: shop\nnodes: {}\nedges:\n  produces: { place-order: [nowhere] }\n' });
      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toMatch(/dangling-edge/);
      expect(modelFile()).toBe(before);
    });

    it('reports unparseable input as an error rather than throwing', async () => {
      const result = await createWriteTools(dir).eventgraph_apply({ model: 'context: shop\nnodes: {' });
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('only says what it would do in prompt mode', async () => {
      rmSync(root, { recursive: true, force: true });
      setup('prompt');
      const before = modelFile();
      const result = await createWriteTools(dir).eventgraph_apply({ model: BATCH });
      expect(result.success).toBe(false);
      expect(result.pendingDiff).toMatch(/shop: 1 node\(s\) added, 1 edge\(s\) added/);
      expect(modelFile()).toBe(before);
    });

    it('refuses in locked mode', async () => {
      rmSync(root, { recursive: true, force: true });
      setup('locked');
      const result = await createWriteTools(dir).eventgraph_apply({ model: BATCH });
      expect(result).toMatchObject({ success: false, error: expect.stringMatching(/locked/) });
    });

    it('honours dryRun in auto mode', async () => {
      const before = modelFile();
      const result = await createWriteTools(dir).eventgraph_apply({ model: BATCH, dryRun: true });
      expect(result).toMatchObject({ success: true, dryRun: true });
      expect(modelFile()).toBe(before);
    });
  });

  describe('eventgraph_verify', () => {
    it('resolves pointers from the directory above the project by default', async () => {
      const broken = await createReadTools(dir).eventgraph_verify({});
      expect(broken.ok).toBe(false);
      expect(broken.issues.map(i => i.pointer)).toEqual(['src/place.ts']);

      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'src', 'place.ts'), '');
      const fixed = await createReadTools(dir).eventgraph_verify({});
      expect(fixed).toMatchObject({ ok: true, issues: [], sourceRoot: root });
    });

    it('takes a root relative to that directory', async () => {
      mkdirSync(join(root, 'app', 'src'), { recursive: true });
      writeFileSync(join(root, 'app', 'src', 'place.ts'), '');
      expect((await createReadTools(dir).eventgraph_verify({ root: 'app' })).ok).toBe(true);
    });
  });

  describe('eventgraph_scaffold', () => {
    it('returns a model to review, and writes nothing', async () => {
      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'src', 'cli.ts'), `import { Command } from 'commander';\nprogram.command('place');`);
      const before = modelFile();
      const result = await createReadTools(dir).eventgraph_scaffold({ context: 'shop' });
      expect(result.scanned).toBe(1);
      expect(result.model).toContain('place-cli');
      expect(result.counts?.headless).toBe(1);
      expect(modelFile()).toBe(before);
    });

    it('names the languages it cannot read instead of returning an empty model silently', async () => {
      mkdirSync(join(root, 'App'));
      writeFileSync(join(root, 'App', 'Main.swift'), '');
      const result = await createReadTools(dir).eventgraph_scaffold({});
      expect(result).toMatchObject({ scanned: 0, model: null, unread: [{ language: 'Swift', files: 1 }] });
    });
  });
});
