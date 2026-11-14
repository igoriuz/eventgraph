import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
      applied: true,
      changes: [{ context: 'shop', nodesAdded: 2, nodesReplaced: 0, edgesAdded: 2, isNew: false }],
    });
    expect(ids()).toEqual(['shop.customer', 'shop.place-order', 'shop.order-placed']);
  });

  it('writes nothing on a dry run', () => {
    const before = readFileSync(join(dir, 'contexts', 'shop', 'model.yaml'), 'utf-8');
    const outcome = applyModels(dir, parseContextModels(BATCH), PRESET, { dryRun: true });
    expect(outcome.applied).toBe(false);
    expect(outcome.errors).toEqual([]);
    expect(outcome.changes[0]).toMatchObject({ nodesAdded: 2 });
    expect(readFileSync(join(dir, 'contexts', 'shop', 'model.yaml'), 'utf-8')).toBe(before);
  });

  it('refuses a batch whose merged result is invalid, and leaves the project alone', () => {
    const bad = 'context: shop\nnodes:\n  ok: { type: command }\nedges:\n  produces: { ok: [missing] }\n';
    const outcome = applyModels(dir, parseContextModels(bad), PRESET);
    expect(outcome.applied).toBe(false);
    expect(outcome.errors.map(e => e.type)).toEqual(['dangling-edge']);
    expect(ids()).toEqual(['shop.customer']);
  });

  it('creates and registers a context the project does not have', () => {
    const outcome = applyModels(dir, parseContextModels('context: billing\nnodes:\n  payer: { type: actor }\nedges: {}\n'), PRESET);
    expect(outcome.changes[0]).toMatchObject({ context: 'billing', isNew: true });
    expect(loadConfig(dir).contexts).toEqual(['shop', 'billing']);
    expect(ids()).toContain('billing.payer');
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

  it('throws on empty input and on broken YAML', () => {
    expect(() => parseContextModels('')).toThrow(/no context models/);
    expect(() => parseContextModels('context: a\nnodes: {')).toThrow();
  });
});
