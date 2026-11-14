import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyModels, parseContextModels } from '../apply.js';
import { loadConfig, loadProject } from '../parser.js';
import { loadPreset } from '../validate.js';

const PRESET = loadPreset('event-modeling', new URL('../../../../presets', import.meta.url).pathname);

const BATCH = `context: shop
nodes:
  place-order:  { type: command }
  order-placed: { type: event }
edges:
  issues:   { customer: [place-order] }
  produces: { place-order: [order-placed] }
`;

describe('applyModels', () => {
  let root: string;
  let dir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eventgraph-core-apply-'));
    dir = join(root, 'eventgraph');
    mkdirSync(join(dir, 'contexts', 'shop'), { recursive: true });
    writeFileSync(join(dir, 'eventgraph.yaml'), 'name: test\nversion: 1\npreset: event-modeling\nagent:\n  write: auto\ncontexts:\n  - shop\n');
    writeFileSync(join(dir, 'contexts', 'shop', 'model.yaml'), 'context: shop\nnodes:\n  customer: { type: actor }\nedges: {}\n');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const ids = () => loadProject(dir).graph.getAllNodes().map(n => `${n.context}.${n.id}`);

  it('merges into an existing context and reports what changed', () => {
    const outcome = applyModels(dir, parseContextModels(BATCH), PRESET);
    expect(outcome).toMatchObject({
      status: 'applied',
      changes: [{ context: 'shop', nodesAdded: 2, nodesReplaced: 0, edgesAdded: 2, isNew: false }],
    });
    expect(ids()).toEqual(['shop.customer', 'shop.place-order', 'shop.order-placed']);
  });

  it('writes nothing on a dry run', () => {
    const before = readFileSync(join(dir, 'contexts', 'shop', 'model.yaml'), 'utf-8');
    const outcome = applyModels(dir, parseContextModels(BATCH), PRESET, { dryRun: true });
    expect(outcome.status).toBe('planned');
    expect(outcome.errors).toEqual([]);
    expect(outcome.changes[0]).toMatchObject({ nodesAdded: 2 });
    expect(readFileSync(join(dir, 'contexts', 'shop', 'model.yaml'), 'utf-8')).toBe(before);
  });

  it('refuses a batch whose merged result is invalid, and leaves the project alone', () => {
    const bad = 'context: shop\nnodes:\n  ok: { type: command }\nedges:\n  produces: { ok: [missing] }\n';
    const outcome = applyModels(dir, parseContextModels(bad), PRESET);
    expect(outcome.status).toBe('invalid');
    expect(outcome.errors.map(e => e.type)).toEqual(['dangling-edge']);
    expect(ids()).toEqual(['shop.customer']);
  });

  it('creates and registers a context the project does not have', () => {
    const outcome = applyModels(dir, parseContextModels('context: billing\nnodes:\n  payer: { type: actor }\nedges: {}\n'), PRESET);
    expect(outcome.changes[0]).toMatchObject({ context: 'billing', isNew: true });
    expect(loadConfig(dir).contexts).toEqual(['shop', 'billing']);
    expect(ids()).toContain('billing.payer');
  });

  // The context name becomes a directory. Unchecked, `../../x` wrote a model
  // file outside the project and registered the path as a context.
  it('refuses a context name or node id that is not a plain name, and writes nothing', () => {
    for (const context of ['../../escaped', 'a/b', 'a.b', '']) {
      const text = `context: "${context}"\nnodes:\n  payer: { type: actor }\nedges: {}\n`;
      let outcome;
      try {
        outcome = applyModels(dir, parseContextModels(text), PRESET);
      } catch {
        continue; // an empty name is already refused while parsing
      }
      expect(outcome.status).toBe('invalid');
      expect(outcome.errors.map(e => e.type)).toContain('invalid-name');
    }
    expect(existsSync(join(root, 'escaped'))).toBe(false);
    expect(loadConfig(dir).contexts).toEqual(['shop']);

    const badNode = applyModels(dir, parseContextModels('context: shop\nnodes:\n  "a.b": { type: actor }\n  "c d/e": { type: actor }\nedges: {}\n'), PRESET);
    expect(badNode.errors.map(e => e.type)).toEqual(['invalid-name', 'invalid-name']);
    expect(ids()).toEqual(['shop.customer']);
  });

  // Each document used to be planned against the disk, so the last one naming
  // a context won and the earlier ones vanished behind a success message.
  it('folds documents naming the same context into one change', () => {
    const twice =
      'context: shop\nnodes:\n  place-order: { type: command }\nedges: {}\n---\n' +
      'context: shop\nnodes:\n  order-placed: { type: event }\nedges:\n  produces: { place-order: [order-placed] }\n';
    const outcome = applyModels(dir, parseContextModels(twice), PRESET);
    expect(outcome).toMatchObject({ status: 'applied', changes: [{ context: 'shop', nodesAdded: 2, edgesAdded: 1 }] });
    expect(outcome.changes).toHaveLength(1);
    expect(ids()).toEqual(['shop.customer', 'shop.place-order', 'shop.order-placed']);
  });

  it('keeps the comments of a context it merges into, and of the project file', () => {
    writeFileSync(
      join(dir, 'contexts', 'shop', 'model.yaml'),
      '# why this context exists\ncontext: shop\nnodes:\n  # the only person here\n  customer: { type: actor }\nedges: {}\n'
    );
    writeFileSync(join(dir, 'eventgraph.yaml'), '# project notes\n' + readFileSync(join(dir, 'eventgraph.yaml'), 'utf-8'));

    applyModels(dir, parseContextModels(BATCH + '---\ncontext: billing\nnodes:\n  payer: { type: actor }\nedges: {}\n'), PRESET);

    const model = readFileSync(join(dir, 'contexts', 'shop', 'model.yaml'), 'utf-8');
    expect(model).toContain('# why this context exists');
    expect(model).toContain('# the only person here');
    expect(ids()).toEqual(['shop.customer', 'shop.place-order', 'shop.order-placed', 'billing.payer']);
    expect(readFileSync(join(dir, 'eventgraph.yaml'), 'utf-8')).toContain('# project notes');
    expect(loadConfig(dir).contexts).toEqual(['shop', 'billing']);
  });

  it('takes a local and a qualified spelling of the same edge as one edge', () => {
    applyModels(dir, parseContextModels(BATCH), PRESET);
    const again = 'context: shop\nnodes: {}\nedges:\n  produces: { shop.place-order: [shop.order-placed] }\n';
    const outcome = applyModels(dir, parseContextModels(again), PRESET);
    expect(outcome.changes[0]).toMatchObject({ edgesAdded: 0 });
    expect(loadProject(dir).graph.getAllEdges().filter(e => e.type === 'produces')).toHaveLength(1);
  });


  it('replaces a context instead of merging when asked', () => {
    applyModels(dir, parseContextModels('context: shop\nnodes:\n  clerk: { type: actor }\nedges: {}\n'), PRESET, { replace: true });
    expect(ids()).toEqual(['shop.clerk']);
  });
});

describe('parseContextModels', () => {
  it('reads several documents separated by ---', () => {
    const models = parseContextModels('context: a\nnodes: {}\nedges: {}\n---\ncontext: b\nnodes: {}\nedges: {}\n');
    expect(models.map(m => m.context)).toEqual(['a', 'b']);
  });

  it('names what is wrong with a model that is not shaped like one', () => {
    expect(() => parseContextModels('context: a\nnodes: 5\n')).toThrow(/nodes must be/);
    expect(() => parseContextModels('context: a\nnodes:\n  - { type: actor }\n')).toThrow(/has no id/);
    expect(() => parseContextModels('context: a\nnodes: []\nedges: 7\n')).toThrow(/edges must be/);
  });

  it('throws on empty input and on broken YAML', () => {
    expect(() => parseContextModels('')).toThrow(/no context models/);
    expect(() => parseContextModels('context: a\nnodes: {')).toThrow();
  });
});
