import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

const TMP = join(tmpdir(), 'eventgraph-cli-test-' + Date.now());

function setupTestProject() {
  const egDir = join(TMP, 'eventgraph');
  mkdirSync(join(egDir, 'contexts', 'payments'), { recursive: true });
  writeFileSync(join(egDir, 'eventgraph.yaml'), `
name: test
version: 1
preset: event-modeling
agent:
  write: prompt
contexts:
  - payments
`);
  writeFileSync(join(egDir, 'contexts', 'payments', 'model.yaml'), `
context: payments
nodes:
  - id: place-order
    type: command
    label: Place Order
  - id: order-placed
    type: event
    label: Order Placed
  - id: order-summary
    type: read-model
    label: Order Summary
edges:
  - from: place-order
    to: order-placed
    type: produces
  - from: order-placed
    to: order-summary
    type: projects-to
`);
  return TMP;
}

function runCli(args: string, cwd: string): string {
  const cliPath = join(import.meta.dirname, '..', 'index.ts');
  return execSync(`npx tsx ${cliPath} ${args}`, { cwd, encoding: 'utf-8', env: { ...process.env } });
}

describe('CLI commands', () => {
  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('list shows all nodes', () => {
    const cwd = setupTestProject();
    const output = runCli('list', cwd);
    expect(output).toContain('place-order');
    expect(output).toContain('order-placed');
    expect(output).toContain('order-summary');
  });

  it('list filters by type', () => {
    const cwd = setupTestProject();
    const output = runCli('list --type event', cwd);
    expect(output).toContain('order-placed');
    expect(output).not.toContain('place-order');
  });

  it('query filters by expression', () => {
    const cwd = setupTestProject();
    const output = runCli('query "type:command"', cwd);
    expect(output).toContain('place-order');
    expect(output).not.toContain('order-placed');
  });

  it('validate passes for valid project', () => {
    const cwd = setupTestProject();
    const output = runCli('validate', cwd);
    expect(output).toContain('valid');
  });
});
