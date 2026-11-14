import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProject } from 'eventgraph-core';
import { generateViewerHtml } from 'eventgraph-viewer';
import { tool } from './define.js';

export function createMetaTools(projectDir: string) {
  return {
    eventgraph_view: tool({
      description: 'Generate the HTML viewer',
      input: {},
      async run() {
        // Rendered from the model as it is on disk now, not as it was at startup.
        const { config, graph } = loadProject(projectDir);
        const path = join(projectDir, '..', 'eventgraph-viewer.html');
        writeFileSync(path, generateViewerHtml(graph, config.name));
        return { path };
      },
    }),
  };
}
