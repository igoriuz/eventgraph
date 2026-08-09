import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EventGraph } from '@eventgraph/core';
import { computeFullLayout, SWIMLANE_HEIGHT } from './layout.js';

export function generateViewerHtml(graph: EventGraph, projectName: string): string {
  const layout = computeFullLayout(graph);
  const css = readFileSync(join(import.meta.dirname, 'templates', 'styles.css'), 'utf-8');
  const js = readFileSync(join(import.meta.dirname, 'templates', 'viewer.js'), 'utf-8');
  const contexts = graph.getContexts();

  // Wide enough that the longest lane label ("Aggregates & Rules") clears the
  // first node in its row.
  const NODE_LEFT_OFFSET = 155;

  const nodeElements = layout.nodes.map(n => {
    const left = NODE_LEFT_OFFSET + n.x;
    const top = 24 + n.y;
    return `<div class="node" data-type="${n.type}" data-id="${n.id}" data-context="${n.context}" style="left:${left}px;top:${top}px;width:${n.width}px">${n.label}</div>`;
  }).join('\n');

  const nodePositions = new Map(layout.nodes.map(n => [
    n.id,
    { x: NODE_LEFT_OFFSET + n.x + n.width / 2, y: 24 + n.y + 18 },
  ]));

  const edgeLines = layout.edges.map(e => {
    const from = nodePositions.get(e.from);
    const to = nodePositions.get(e.to);
    if (!from || !to) return '';
    const fromNode = layout.nodes.find(n => n.id === e.from);
    const toNode = layout.nodes.find(n => n.id === e.to);
    return `<line class="edge-line" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" data-from="${e.from}" data-to="${e.to}" data-type="${e.type}" data-from-context="${fromNode?.context}" data-to-context="${toNode?.context}" />`;
  }).join('\n');

  const filterButtons = [
    `<button class="pill active context-filter" data-context="__all__">All</button>`,
    ...contexts.map(c => `<button class="pill inactive context-filter" data-context="${c}">${c}</button>`),
  ].join('\n');

  const swimlaneLabels = layout.swimlanes.map((label, i) =>
    `<span class="swimlane-label" style="top:${28 + i * SWIMLANE_HEIGHT}px">${label}</span>`
  ).join('\n');

  const canvasHeight = (layout.swimlanes.length + 1) * SWIMLANE_HEIGHT;
  const maxX = Math.max(...layout.nodes.map(n => n.x + n.width + NODE_LEFT_OFFSET + 40), 800);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>eventgraph — ${projectName}</title>
<style>${css}</style>
</head>
<body>
<div class="toolbar">
  <div class="filters">${filterButtons}<span id="focus-hint"></span></div>
  <div class="legend">
    <span class="legend-item"><span class="legend-dot" style="background:#3b82f6"></span>Command</span>
    <span class="legend-item"><span class="legend-dot" style="background:#f59e0b"></span>Event</span>
    <span class="legend-item"><span class="legend-dot" style="background:#10b981"></span>Read Model</span>
    <span class="legend-item"><span class="legend-dot" style="background:#ef4444"></span>Policy</span>
    <span class="legend-item"><span class="legend-dot" style="background:#8b5cf6"></span>Screen</span>
  </div>
</div>
<div class="canvas" style="height:${canvasHeight}px;width:${maxX}px">
  ${swimlaneLabels}
  <svg class="edges" width="${maxX}" height="${canvasHeight}">
    ${edgeLines}
  </svg>
  ${nodeElements}
</div>
<div id="detail-panel" class="detail-panel"></div>
<script>
window.__EVENTGRAPH_DATA__ = ${JSON.stringify({ nodes: layout.nodes, edges: layout.edges, contexts })};
${js}
</script>
</body>
</html>`;
}
