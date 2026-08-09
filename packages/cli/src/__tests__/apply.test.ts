import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { parseContextModel } from 'eventgraph-core';
import { tryCli, type CliResult } from './cli-runner.js';

const TMP = join(tmpdir(), 'eventgraph-apply-test-' + Date.now());

function project(): string {
  const dir = join(TMP, 'eventgraph');
  mkdirSync(join(dir, 'contexts', 'shop'), { recursive: true });
  writeFileSync(
    join(dir, 'eventgraph.yaml'),
    `name: test\nversion: 1\npreset: event-modeling\nagent:\n  write: auto\ncontexts:\n  - shop\n`
  );
  writeFileSync(
    join(dir, 'contexts', 'shop', 'model.yaml'),
    `context: shop\nnodes:\n  customer: { type: actor }\nedges: {}\n`
  );
  return dir;
}

function run(args: string, cwd: string, stdin = ''): CliResult {
  return tryCli(args, { cwd, input: stdin });
}

function model(dir: string, context: string) {
  const path = join(dir, 'contexts', context, 'model.yaml');
  return parseContextModel(parseYaml(readFileSync(path, 'utf-8')));
}

const BATCH = `context: shop
nodes:
  place-order:  { type: command }
  order-placed: { type: event, terminal: nothing reacts yet }
  order:        { type: aggregate }
edges:
  issues:     { customer: [place-order] }
  produces:   { place-order: [order-placed] }
  acts-on:    { place-order: [order] }
  belongs-to: { order-placed: [order] }
`;

describe('apply', () => {
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('merges a batch read from stdin', () => {
    const dir = project();
    const result = run('apply -', TMP, BATCH);

    expect(result.status).toBe(0);
    expect(model(dir, 'shop').nodes.map(n => n.id)).toEqual([
      'customer',
      'place-order',
      'order-placed',
      'order',
    ]);
    expect(model(dir, 'shop').edges).toHaveLength(4);
  });

  it('carries semantic flags through', () => {
    const dir = project();
    run('apply -', TMP, BATCH);

    const event = model(dir, 'shop').nodes.find(n => n.id === 'order-placed')!;
    expect(event.data).toMatchObject({ terminal: 'nothing reacts yet' });
  });

  it('registers a context the batch introduces', () => {
    const dir = project();
    run('apply -', TMP, `context: fulfilment\nnodes:\n  shipment: { type: aggregate }\n`);

    const config = parseYaml(readFileSync(join(dir, 'eventgraph.yaml'), 'utf-8'));
    expect(config.contexts).toEqual(['shop', 'fulfilment']);
    expect(existsSync(join(dir, 'contexts', 'fulfilment', 'model.yaml'))).toBe(true);
  });

  it('takes several documents in one input', () => {
    const dir = project();
    const result = run('apply -', TMP, `${BATCH}---\ncontext: fulfilment\nnodes:\n  shipment: { type: aggregate }\n`);

    expect(result.status).toBe(0);
    expect(model(dir, 'shop').nodes).toHaveLength(4);
    expect(model(dir, 'fulfilment').nodes).toHaveLength(1);
  });

  it('replaces a node of the same id rather than duplicating it', () => {
    const dir = project();
    run('apply -', TMP, `context: shop\nnodes:\n  customer: { type: actor, label: Buyer }\n`);

    const nodes = model(dir, 'shop').nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.label).toBe('Buyer');
  });

  it('does not duplicate an edge that is already there', () => {
    const dir = project();
    run('apply -', TMP, BATCH);
    run('apply -', TMP, BATCH);

    expect(model(dir, 'shop').edges).toHaveLength(4);
  });

  it('validates the merged whole and writes nothing when it fails', () => {
    const dir = project();
    const before = readFileSync(join(dir, 'contexts', 'shop', 'model.yaml'), 'utf-8');
    const result = run('apply -', TMP, `context: shop\nnodes:\n  bogus: { type: not-a-type }\n`);

    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/Refusing to apply/);
    expect(readFileSync(join(dir, 'contexts', 'shop', 'model.yaml'), 'utf-8')).toBe(before);
  });

  it('rejects an edge the preset does not allow', () => {
    project();
    const result = run(
      'apply -',
      TMP,
      `context: shop\nnodes:\n  a: { type: event }\nedges:\n  produces: { customer: [a] }\n`
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/edge-rule-violation/);
  });

  it('reports without writing under --dry-run', () => {
    const dir = project();
    const before = readFileSync(join(dir, 'contexts', 'shop', 'model.yaml'), 'utf-8');
    const result = run('apply - --dry-run', TMP, BATCH);

    expect(result.stdout).toMatch(/Would apply/);
    expect(readFileSync(join(dir, 'contexts', 'shop', 'model.yaml'), 'utf-8')).toBe(before);
  });

  it('drops what --replace does not mention', () => {
    const dir = project();
    run('apply - --replace', TMP, `context: shop\nnodes:\n  supplier: { type: actor }\n`);

    expect(model(dir, 'shop').nodes.map(n => n.id)).toEqual(['supplier']);
  });

  it('refuses an empty input rather than reporting success', () => {
    project();
    expect(run('apply -', TMP, '').status).toBe(2);
  });
});

describe('init --yes', () => {
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('scaffolds without prompting', () => {
    mkdirSync(TMP, { recursive: true });
    const result = run('init --yes --name demo --context shop,billing --agent-write auto', TMP);

    expect(result.status).toBe(0);
    const config = parseYaml(readFileSync(join(TMP, 'eventgraph', 'eventgraph.yaml'), 'utf-8'));
    expect(config).toMatchObject({ name: 'demo', contexts: ['shop', 'billing'], agent: { write: 'auto' } });
  });

  it('scaffolds each context in the compact form', () => {
    mkdirSync(TMP, { recursive: true });
    run('init --yes --context shop', TMP);

    const raw = readFileSync(join(TMP, 'eventgraph', 'contexts', 'shop', 'model.yaml'), 'utf-8');
    expect(raw).toBe('context: shop\nnodes: {}\nedges: {}\n');
  });

  it('rejects an unknown write mode', () => {
    mkdirSync(TMP, { recursive: true });
    expect(run('init --yes --agent-write sideways', TMP).status).toBe(2);
  });
});

describe('add flags', () => {
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('sets semantic flags and source pointers', () => {
    const dir = project();
    run('add screen orders-api --label "POST /orders" --set kind=endpoint --src backend/api.ts', TMP);

    const node = model(dir, 'shop').nodes.find(n => n.id === 'orders-api')!;
    expect(node.data).toMatchObject({
      kind: 'endpoint',
      implemented_by: ['backend/api.ts'],
      status: 'implemented',
    });
  });

  it('keeps booleans boolean and prose prose', () => {
    const dir = project();
    run('add policy on-order --set idempotent=true --set "terminal=nothing reacts"', TMP);

    const node = model(dir, 'shop').nodes.find(n => n.id === 'on-order')!;
    expect(node.data).toMatchObject({ idempotent: true, terminal: 'nothing reacts' });
  });

  it('rejects a --set without a value', () => {
    project();
    expect(run('add command x --set kind', TMP).status).toBe(2);
  });
});

describe('migrate', () => {
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('converts a list-form context and leaves the model unchanged', () => {
    const dir = project();
    writeFileSync(
      join(dir, 'contexts', 'shop', 'model.yaml'),
      `context: shop\nnodes:\n  - id: customer\n    type: actor\n    label: Customer\nedges: []\n`
    );

    const result = run('migrate', TMP);
    expect(result.status).toBe(0);
    expect(model(dir, 'shop').nodes).toEqual([{ id: 'customer', type: 'actor', label: 'Customer' }]);
    expect(readFileSync(join(dir, 'contexts', 'shop', 'model.yaml'), 'utf-8')).toContain('customer: { type: actor }');
  });

  it('says so when there is nothing to convert', () => {
    project();
    expect(run('migrate', TMP).stdout).toMatch(/already use the compact form/);
  });
});

describe('query', () => {
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('fails loudly on a filter it does not know', () => {
    project();
    const result = run('query "bogus:key"', TMP);

    expect(result.status).toBe(2);
    expect(result.stdout).toMatch(/unknown filter/);
  });

  it('still finds nodes by a known filter', () => {
    project();
    expect(run('query "type:actor"', TMP).stdout).toMatch(/customer/);
  });
});
