import type { EventGraph, GraphNode } from '@eventgraph/core';

export interface LayoutNode {
  id: string;
  label: string;
  type: string;
  context: string;
  swimlane: number;
  x: number;
  y: number;
  data?: Record<string, unknown>;
}

export interface LayoutEdge {
  from: string;
  to: string;
  type: string;
}

export interface ViewerLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  swimlanes: string[];
}

const SWIMLANE_ORDER: Record<string, number> = {
  screen: 0,
  'read-model': 1,
  event: 2,
  command: 3,
  policy: 4,
  aggregate: 3,
  service: 5,
  custom: 5,
};

const SWIMLANE_HEIGHT = 80;
const NODE_WIDTH = 160;
const NODE_SPACING = 40;

export function computeLayout(graph: EventGraph): LayoutNode[] {
  const nodes = graph.getAllNodes();
  const edges = graph.getAllEdges();

  const order = topologicalOrder(nodes, edges);

  const layoutNodes: LayoutNode[] = [];
  const columnCounts = new Map<number, number>();

  for (const qid of order) {
    const node = graph.getNode(qid)!;
    const swimlane = SWIMLANE_ORDER[node.type] ?? 5;
    const col = columnCounts.get(swimlane) ?? 0;
    columnCounts.set(swimlane, col + 1);

    layoutNodes.push({
      id: qid,
      label: node.label,
      type: node.type,
      context: node.context,
      swimlane,
      x: col * (NODE_WIDTH + NODE_SPACING),
      y: swimlane * SWIMLANE_HEIGHT,
      data: node.data,
    });
  }

  return layoutNodes;
}

export function computeFullLayout(graph: EventGraph): ViewerLayout {
  const nodes = computeLayout(graph);
  const edges = graph.getAllEdges().map(e => ({
    from: e.from,
    to: e.to,
    type: e.type,
  }));

  return {
    nodes,
    edges,
    swimlanes: ['Screens', 'Read Models', 'Events', 'Commands', 'Policies', 'Other'],
  };
}

function topologicalOrder(nodes: GraphNode[], edges: { from: string; to: string }[]): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    const qid = `${node.context}.${node.id}`;
    inDegree.set(qid, 0);
    adjacency.set(qid, []);
  }

  for (const edge of edges) {
    const current = inDegree.get(edge.to) ?? 0;
    inDegree.set(edge.to, current + 1);
    const adj = adjacency.get(edge.from) ?? [];
    adj.push(edge.to);
    adjacency.set(edge.from, adj);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      const deg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, deg);
      if (deg === 0) queue.push(neighbor);
    }
  }

  for (const node of nodes) {
    const qid = `${node.context}.${node.id}`;
    if (!result.includes(qid)) result.push(qid);
  }

  return result;
}
