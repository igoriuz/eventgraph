import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addNodeToContext, addEdgeToContext, removeNodeFromContext, generateYamlDiff } from '../writer.js';
import type { ContextModelNode, GraphEdge } from '../schema.js';
import { parse as parseYaml } from 'yaml';

const TMP = join(tmpdir(), 'eventgraph-writer-test-' + Date.now());

function setupContext(contextName: string, content: string): string {
  const dir = join(TMP, 'eventgraph');
  mkdirSync(join(dir, 'contexts', contextName), { recursive: true });
  writeFileSync(join(dir, 'contexts', contextName, 'model.yaml'), content);
  return dir;
}

describe('writer', () => {
  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('adds a node to a context YAML file', () => {
    const dir = setupContext('payments', `context: payments\nnodes:\n  - id: existing\n    type: event\n    label: Existing\nedges: []\n`);
    const node: ContextModelNode = { id: 'new-cmd', type: 'command', label: 'New Command' };
    addNodeToContext(dir, 'payments', node);

    const content = readFileSync(join(dir, 'contexts', 'payments', 'model.yaml'), 'utf-8');
    const model = parseYaml(content);
    expect(model.nodes).toHaveLength(2);
    expect(model.nodes[1].id).toBe('new-cmd');
  });

  it('adds an edge to a context YAML file', () => {
    const dir = setupContext('payments', `context: payments\nnodes:\n  - id: a\n    type: command\n    label: A\n  - id: b\n    type: event\n    label: B\nedges: []\n`);
    const edge: GraphEdge = { from: 'a', to: 'b', type: 'produces' };
    addEdgeToContext(dir, 'payments', edge);

    const content = readFileSync(join(dir, 'contexts', 'payments', 'model.yaml'), 'utf-8');
    const model = parseYaml(content);
    expect(model.edges).toHaveLength(1);
    expect(model.edges[0].type).toBe('produces');
  });

  it('removes a node and its edges from a context YAML file', () => {
    const dir = setupContext('payments', `context: payments\nnodes:\n  - id: a\n    type: command\n    label: A\n  - id: b\n    type: event\n    label: B\nedges:\n  - from: a\n    to: b\n    type: produces\n`);
    removeNodeFromContext(dir, 'payments', 'a');

    const content = readFileSync(join(dir, 'contexts', 'payments', 'model.yaml'), 'utf-8');
    const model = parseYaml(content);
    expect(model.nodes).toHaveLength(1);
    expect(model.nodes[0].id).toBe('b');
    expect(model.edges).toHaveLength(0);
  });

  it('generates a YAML diff for a node addition', () => {
    const dir = setupContext('payments', `context: payments\nnodes: []\nedges: []\n`);
    const node: ContextModelNode = { id: 'new-cmd', type: 'command', label: 'New Command' };
    const diff = generateYamlDiff(dir, 'payments', { addNodes: [node] });

    expect(diff).toContain('new-cmd');
    expect(diff).toContain('+');
  });
});
