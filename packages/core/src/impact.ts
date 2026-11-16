import type { GraphNode } from './schema.js';
import type { EventGraph } from './graph.js';

/**
 * Edges whose source depends on their target rather than the other way round.
 * A screen that reads a read-model changes when the read-model does; a command
 * that calls a service is affected when the service changes or fails. Impact
 * follows these backwards, which is what makes it answer "who depends on this?"
 * and not only "what does this set off?".
 */
const DEPENDS_ON = new Set(['reads', 'calls']);

/**
 * Everything a change to `startId` reaches, with the hop count it was reached
 * at. A surface reached because it reads something is a leaf: what it shows
 * changes, what it offers and where it leads do not.
 */
function affected(graph: EventGraph, startId: string, maxDepth: number): Map<string, number> {
  const depth = new Map<string, number>([[startId, 0]]);
  const leaves = new Set<string>();
  const queue = [startId];

  const visit = (id: string, at: number, leaf: boolean) => {
    if (depth.has(id)) return;
    depth.set(id, at);
    if (leaf) leaves.add(id);
    queue.push(id);
  };

  while (queue.length > 0) {
    const id = queue.shift()!;
    const at = depth.get(id)!;
    if (at >= maxDepth || leaves.has(id)) continue;

    for (const edge of graph.getOutgoingEdges(id)) {
      if (!DEPENDS_ON.has(edge.type)) visit(edge.to, at + 1, false);
    }
    for (const edge of graph.getIncomingEdges(id)) {
      if (!DEPENDS_ON.has(edge.type)) continue;
      visit(edge.from, at + 1, graph.getNode(edge.from)?.type === 'screen');
    }
  }

  depth.delete(startId);
  return depth;
}

export interface ImpactOptions {
  maxDepth?: number;
}

export interface ImpactResult {
  node: GraphNode;
  direct: GraphNode[];
  transitive: GraphNode[];
  upstreamDependents: GraphNode[];
  affectedContexts: string[];
  crossContext: boolean;
  totalAffected: number;
  risk: 'low' | 'medium' | 'high';
}

export function analyzeImpact(
  graph: EventGraph,
  qualifiedId: string,
  options: ImpactOptions = {},
): ImpactResult {
  const maxDepth = options.maxDepth ?? Infinity;
  const sourceNode = graph.getNode(qualifiedId);
  if (!sourceNode) {
    throw new Error(`Node not found: ${qualifiedId}`);
  }

  const reached = affected(graph, qualifiedId, maxDepth);
  const nodesAt = (match: (hops: number) => boolean) =>
    [...reached]
      .filter(([, hops]) => match(hops))
      .map(([id]) => graph.getNode(id))
      .filter((n): n is GraphNode => n !== undefined);

  const direct = nodesAt(hops => hops === 1);
  const transitive = nodesAt(hops => hops > 1);
  const allDownstream = [...direct, ...transitive];

  // What leads here, minus what is already listed as affected.
  const upstreamDependents = graph.getUpstream(qualifiedId, 1).filter(n => !reached.has(`${n.context}.${n.id}`));

  const affectedContexts = new Set<string>();
  for (const node of allDownstream) {
    affectedContexts.add(node.context);
  }
  if (allDownstream.length > 0) {
    affectedContexts.add(sourceNode.context);
  }

  const totalAffected = allDownstream.length;
  const crossContext = affectedContexts.size > 1;

  let risk: 'low' | 'medium' | 'high';
  if (totalAffected === 0) {
    risk = 'low';
  } else if (totalAffected <= 3 && !crossContext) {
    risk = 'low';
  } else if (totalAffected <= 6 || !crossContext) {
    risk = 'medium';
  } else {
    risk = 'high';
  }

  return {
    node: sourceNode,
    direct,
    transitive,
    upstreamDependents,
    affectedContexts: [...affectedContexts],
    crossContext,
    totalAffected,
    risk,
  };
}
