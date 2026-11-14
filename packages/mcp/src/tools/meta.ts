import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyModels, loadConfig, loadPreset, loadProject } from 'eventgraph-core';
import { presetsDirPath } from './presets.js';
import { generateViewerHtml } from 'eventgraph-viewer';

export interface MetaToolsApi {
  eventgraph_view(input: Record<string, never>): Promise<{ path: string }>;
  eventgraph_init_context(input: { name: string }): Promise<{ success: boolean; error?: string; pendingDiff?: string }>;
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

    /**
     * A write like any other: it obeys `agent.write`, and it goes through the
     * same apply as a model does, so the name is checked and an existing
     * context is never replaced by an empty one.
     */
    async eventgraph_init_context({ name }) {
      const config = loadConfig(projectDir);
      if (config.agent.write === 'locked') {
        return { success: false, error: 'Write mode is locked. Agent cannot modify the model.' };
      }
      if (config.contexts.includes(name)) return { success: false, error: `Context "${name}" already exists.` };

      const outcome = applyModels(
        projectDir,
        [{ context: name, nodes: [], edges: [] }],
        loadPreset(config.preset, presetsDirPath()),
        { dryRun: config.agent.write !== 'auto' },
      );
      if (outcome.status === 'invalid') return { success: false, error: outcome.errors.map(e => e.message).join('; ') };
      if (outcome.status === 'planned') return { success: false, pendingDiff: `Would create context "${name}".` };
      return { success: true };
    },
  };
}
