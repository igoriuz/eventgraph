import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  addNodeToContext,
  addEdgeToContext,
  removeNodeFromContext,
  rewriteContextCompact,
  generateYamlDiff,
} from '../writer.js';
import { parseContextModel } from '../model-file.js';
import type { ContextModelNode, GraphEdge } from '../schema.js';
import { parse as parseYaml } from 'yaml';

const TMP = join(tmpdir(), 'eventgraph-writer-test-' + Date.now());

function setupContext(contextName: string, content: string): string {
  const dir = join(TMP, 'eventgraph');
  mkdirSync(join(dir, 'contexts', contextName), { recursive: true });
  writeFileSync(join(dir, 'contexts', contextName, 'model.yaml'), content);
  return dir;
}

function readModel(dir: string, contextName: string) {
  const path = join(dir, 'contexts', contextName, 'model.yaml');
  return parseContextModel(parseYaml(readFileSync(path, 'utf-8')));
}

function readRaw(dir: string, contextName: string): string {
  return readFileSync(join(dir, 'contexts', contextName, 'model.yaml'), 'utf-8');
}

const COMPACT = `context: payments
# the only actor here
nodes:
  existing: { type: event, label: Existing }
edges: {}
`;

describe('writer', () => {
  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('adds a node to a context', () => {
    const dir = setupContext('payments', COMPACT);
    const node: ContextModelNode = { id: 'new-cmd', type: 'command', label: 'New Command' };
    addNodeToContext(dir, 'payments', node);

    expect(readModel(dir, 'payments').nodes.map(n => n.id)).toEqual(['existing', 'new-cmd']);
  });

  it('keeps the comments in the file it edits', () => {
    const dir = setupContext('payments', COMPACT);
    addNodeToContext(dir, 'payments', { id: 'new-cmd', type: 'command', label: 'New Command' });

    expect(readRaw(dir, 'payments')).toContain('# the only actor here');
  });

  it('writes a node flag through as given', () => {
    const dir = setupContext('payments', COMPACT);
    addNodeToContext(dir, 'payments', {
      id: 'orders-api',
      type: 'screen',
      label: 'POST /orders',
      data: { kind: 'endpoint', implemented_by: ['src/api.ts'] },
    });

    const node = readModel(dir, 'payments').nodes.find(n => n.id === 'orders-api')!;
    expect(node.data).toMatchObject({ kind: 'endpoint', implemented_by: ['src/api.ts'] });
    expect(readRaw(dir, 'payments')).toContain('src: src/api.ts');
  });

  it('adds an edge to a context', () => {
    const dir = setupContext('payments', COMPACT);
    const edge: GraphEdge = { from: 'a', to: 'b', type: 'produces' };
    addEdgeToContext(dir, 'payments', edge);

    expect(readModel(dir, 'payments').edges).toEqual([edge]);
  });

  it('removes a node and its edges', () => {
    const dir = setupContext(
      'payments',
      `context: payments\nnodes:\n  a: { type: command }\n  b: { type: event }\nedges:\n  produces:\n    a: [b]\n`
    );
    removeNodeFromContext(dir, 'payments', 'a');

    const model = readModel(dir, 'payments');
    expect(model.nodes.map(n => n.id)).toEqual(['b']);
    expect(model.edges).toHaveLength(0);
  });

  it('generates a diff for a node addition', () => {
    const dir = setupContext('payments', `context: payments\nnodes: {}\nedges: {}\n`);
    const node: ContextModelNode = { id: 'new-cmd', type: 'command', label: 'New Command' };
    const diff = generateYamlDiff(dir, 'payments', { addNodes: [node] });

    expect(diff).toContain('new-cmd');
    expect(diff).toContain('+');
  });

  it('leaves the file alone while generating a diff', () => {
    const dir = setupContext('payments', COMPACT);
    generateYamlDiff(dir, 'payments', { addNodes: [{ id: 'x', type: 'command', label: 'X' }] });

    expect(readRaw(dir, 'payments')).toBe(COMPACT);
  });

  it('swaps an empty list container from an older scaffold', () => {
    const dir = setupContext('payments', `context: payments\nnodes: []\nedges: []\n`);
    addNodeToContext(dir, 'payments', { id: 'a', type: 'command', label: 'A' });

    expect(readModel(dir, 'payments').nodes.map(n => n.id)).toEqual(['a']);
  });

  it('refuses to edit a populated list-form context, pointing at migrate', () => {
    const dir = setupContext(
      'payments',
      `context: payments\nnodes:\n  - id: a\n    type: command\n    label: A\nedges: []\n`
    );
    expect(() => addNodeToContext(dir, 'payments', { id: 'b', type: 'event', label: 'B' })).toThrow(
      /migrate/
    );
  });
});

describe('rewriteContextCompact', () => {
  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('converts a list-form context in place, losing no nodes or edges', () => {
    const dir = setupContext(
      'payments',
      `context: payments
nodes:
  - id: place-order
    type: command
    label: Place Order
    data:
      status: implemented
      implemented_by: [src/orders/place.ts]
  - id: order-placed
    type: event
    label: Order Placed
edges:
  - { from: place-order, to: order-placed, type: produces }
`
    );

    const before = rewriteContextCompact(dir, 'payments');
    const after = readModel(dir, 'payments');

    expect(after.nodes).toEqual(before.nodes);
    expect(after.edges).toEqual(before.edges);
    expect(readRaw(dir, 'payments')).toContain('src: src/orders/place.ts');
    expect(readRaw(dir, 'payments')).not.toContain('status:');
  });

  it('makes the context editable afterwards', () => {
    const dir = setupContext(
      'payments',
      `context: payments\nnodes:\n  - id: a\n    type: command\n    label: A\nedges: []\n`
    );
    rewriteContextCompact(dir, 'payments');
    addNodeToContext(dir, 'payments', { id: 'b', type: 'event', label: 'B' });

    expect(readModel(dir, 'payments').nodes.map(n => n.id)).toEqual(['a', 'b']);
  });
});
