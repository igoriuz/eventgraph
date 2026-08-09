import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { loadConfig, loadProject } from 'eventgraph-core';
import { generateViewerHtml } from 'eventgraph-viewer';

export interface MetaToolsApi {
  eventgraph_view(input: Record<string, never>): Promise<{ path: string }>;
  eventgraph_init_context(input: { name: string }): Promise<{ success: boolean }>;
}

export function createMetaTools(projectDir: string): MetaToolsApi {
  return {
    async eventgraph_view() {
      // Rendered from the model as it is on disk now, not as it was at startup.
      const { config, graph } = loadProject(projectDir);
      const html = generateViewerHtml(graph, config.name);
      const outputPath = join(projectDir, '..', 'eventgraph-viewer.html');
      writeFileSync(outputPath, html);
      return { path: outputPath };
    },

    async eventgraph_init_context({ name }) {
      mkdirSync(join(projectDir, 'contexts', name), { recursive: true });
      const model = { context: name, nodes: [], edges: [] };
      writeFileSync(
        join(projectDir, 'contexts', name, 'model.yaml'),
        stringifyYaml(model, { lineWidth: 120 }),
      );

      const currentConfig = loadConfig(projectDir);
      if (!currentConfig.contexts.includes(name)) {
        currentConfig.contexts.push(name);
        writeFileSync(
          join(projectDir, 'eventgraph.yaml'),
          stringifyYaml(currentConfig, { lineWidth: 120 }),
        );
      }

      return { success: true };
    },
  };
}
