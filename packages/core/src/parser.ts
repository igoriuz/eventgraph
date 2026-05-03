import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ProjectConfig, ContextModel } from './schema.js';
import { qualifiedId } from './schema.js';
import { EventGraph } from './graph.js';

export function loadConfig(projectDir: string): ProjectConfig {
  const configPath = join(projectDir, 'eventgraph.yaml');
  const content = readFileSync(configPath, 'utf-8');
  return parseYaml(content) as ProjectConfig;
}

export function loadContext(projectDir: string, contextName: string): EventGraph {
  const modelPath = join(projectDir, 'contexts', contextName, 'model.yaml');
  const content = readFileSync(modelPath, 'utf-8');
  const raw = parseYaml(content) as ContextModel;

  const graph = new EventGraph();
  loadContextIntoGraph(graph, raw);
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

  for (const contextName of config.contexts) {
    const modelPath = join(projectDir, 'contexts', contextName, 'model.yaml');
    const content = readFileSync(modelPath, 'utf-8');
    const model = parseYaml(content) as ContextModel;
    loadContextIntoGraph(graph, model);
  }

  return { config, graph };
}

export function findProjectDir(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, 'eventgraph');
    try {
      readFileSync(join(candidate, 'eventgraph.yaml'));
      return candidate;
    } catch {
      const parent = join(dir, '..');
      if (parent === dir) return null;
      dir = parent;
    }
  }
}
