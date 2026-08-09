import { findProjectDir, loadProject, type ProjectConfig, type EventGraph } from 'eventgraph-core';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Locates the bundled presets.
 *
 * In the monorepo they sit at the repository root; in a published package they
 * are copied next to the compiled output. Resolving the repo layout only worked
 * as long as nobody installed the package, where "../../../presets" points
 * outside it entirely.
 */
export function presetsDir(): string {
  const candidates = [
    join(import.meta.dirname, 'presets'),
    join(import.meta.dirname, '..', 'presets'),
    join(import.meta.dirname, '..', '..', '..', 'presets'),
  ];
  return candidates.find(existsSync) ?? candidates[candidates.length - 1]!;
}

export interface LoadedProject {
  projectDir: string;
  config: ProjectConfig;
  graph: EventGraph;
}

export function loadOrFail(): LoadedProject {
  const projectDir = findProjectDir();
  if (!projectDir) {
    console.error('Error: No eventgraph project found. Run "eventgraph init" first.');
    process.exit(1);
  }
  const { config, graph } = loadProject(projectDir);
  return { projectDir, config, graph };
}

export function formatNode(node: { id: string; type: string; label: string; context: string }): string {
  const typeColors: Record<string, string> = {
    command: '\x1b[34m',
    event: '\x1b[33m',
    'read-model': '\x1b[32m',
    policy: '\x1b[31m',
    screen: '\x1b[35m',
    aggregate: '\x1b[36m',
    service: '\x1b[90m',
  };
  const color = typeColors[node.type] ?? '\x1b[37m';
  const reset = '\x1b[0m';
  return `${color}[${node.type}]${reset} ${node.context}.${node.id} — ${node.label}`;
}
