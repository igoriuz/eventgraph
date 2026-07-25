import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { generateViewerHtml } from '@eventgraph/viewer';
import { neighbourhood, sliceGraph, subgraph, resolveId, type EventGraph } from '@eventgraph/core';
import { loadOrFail } from '../util.js';

interface ViewOptions {
  output?: string;
  open?: boolean;
  focus?: string;
  depth?: string;
  slice?: string;
  type?: string;
}

/**
 * Narrows the graph before rendering.
 *
 * Drawing everything stops being useful within a few dozen nodes, which is the
 * failure that makes a growing event-modeling board unreadable. Rendering a
 * projection instead is the whole reason for storing this as a graph.
 */
function project(graph: EventGraph, opts: ViewOptions): { graph: EventGraph; label: string } {
  if (opts.slice) {
    return { graph: sliceGraph(graph, opts.slice), label: `slice of ${opts.slice}` };
  }

  if (opts.focus) {
    const depth = Number(opts.depth ?? 1);
    if (!Number.isFinite(depth) || depth < 1) throw new Error('--depth must be a positive number');
    const ids = neighbourhood(graph, opts.focus, depth);
    return { graph: subgraph(graph, ids), label: `${depth} hop(s) around ${opts.focus}` };
  }

  if (opts.type) {
    const types = opts.type.split(',').map(t => t.trim());
    const ids = graph
      .getAllNodes()
      .filter(n => types.includes(n.type))
      .map(n => `${n.context}.${n.id}`);
    return { graph: subgraph(graph, ids), label: `types: ${types.join(', ')}` };
  }

  return { graph, label: 'whole graph' };
}

export function registerViewCommand(program: Command): void {
  program
    .command('view')
    .description('Generate and open the HTML viewer')
    .option('-o, --output <path>', 'Output file path')
    .option('--no-open', 'Do not open in browser')
    .option('-f, --focus <node>', 'Render only the neighbourhood of one node')
    .option('-d, --depth <n>', 'How many hops --focus reaches (default 1)')
    .option('-s, --slice <event>', 'Render the swimlane around one event')
    .option('-t, --type <types>', 'Render only these node types (comma-separated)')
    .action((opts: ViewOptions) => {
      const { projectDir, config, graph } = loadOrFail();

      if (opts.focus && !resolveId(graph, opts.focus)) {
        console.error(`Error: unknown node "${opts.focus}"`);
        process.exit(1);
      }

      let projected;
      try {
        projected = project(graph, opts);
      } catch (e) {
        console.error(`Error: ${(e as Error).message}`);
        process.exit(1);
      }

      const shown = projected.graph.getAllNodes().length;
      const total = graph.getAllNodes().length;

      const html = generateViewerHtml(projected.graph, config.name);
      const outputPath = opts.output ?? join(projectDir, '..', 'eventgraph-viewer.html');

      writeFileSync(outputPath, html);
      console.log(`Viewer generated: ${outputPath}`);
      console.log(`  ${projected.label} — ${shown} of ${total} nodes`);

      if (opts.open !== false) {
        const openCmd =
          process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${openCmd} "${outputPath}"`);
      }
    });
}
