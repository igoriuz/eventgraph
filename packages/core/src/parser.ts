import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ProjectConfig, ContextModel } from './schema.js';
import { qualifiedId } from './schema.js';
import { parseContextModel } from './model-file.js';
import { EventGraph } from './graph.js';

export function loadConfig(projectDir: string): ProjectConfig {
  const configPath = join(projectDir, 'eventgraph.yaml');
  const content = readFileSync(configPath, 'utf-8');
  return parseYaml(content) as ProjectConfig;
}

/** Reads one context file, accepting either on-disk form. */
export function readContextModel(projectDir: string, contextName: string): ContextModel {
  const modelPath = join(projectDir, 'contexts', contextName, 'model.yaml');
  try {
    return parseContextModel(parseYaml(readFileSync(modelPath, 'utf-8')));
  } catch (error) {
    throw new Error(`contexts/${contextName}/model.yaml: ${(error as Error).message}`);
  }
}

export function loadContext(projectDir: string, contextName: string): EventGraph {
  const graph = new EventGraph();
  loadContextIntoGraph(graph, readContextModel(projectDir, contextName));
  return graph;
}

export function loadContextIntoGraph(graph: EventGraph, model: ContextModel): void {
  for (const node of model.nodes) {
    graph.addNode({
      ...node,
      context: model.context,
    });
  }

  for (const edge of model.edges) {
    const from = edge.from.includes('.')
      ? edge.from
      : qualifiedId(model.context, edge.from);
    const to = edge.to.includes('.')
      ? edge.to
      : qualifiedId(model.context, edge.to);

    graph.addEdge({ ...edge, from, to });
  }
}

export function loadProject(projectDir: string): { config: ProjectConfig; graph: EventGraph } {
  const config = loadConfig(projectDir);
  const graph = new EventGraph();
  graph.platforms = config.platforms ?? [];
  graph.backend = config.backend ?? false;

  for (const contextName of config.contexts) {
    loadContextIntoGraph(graph, readContextModel(projectDir, contextName));
  }

  return { config, graph };
}

function isProjectDir(dir: string): boolean {
  try {
    readFileSync(join(dir, 'eventgraph.yaml'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Walks up looking for the project.
 *
 * The directory itself counts, not only a child named `eventgraph`. Checking
 * only for the child meant standing inside your own project reported that no
 * project existed, and renaming the directory broke every command — the name
 * was load-bearing without ever being documented as such.
 */
export function findProjectDir(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  while (true) {
    if (isProjectDir(dir)) return dir;
    const nested = join(dir, 'eventgraph');
    if (isProjectDir(nested)) return nested;

    const parent = join(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
}
