import type { GraphNode } from './schema.js';
import type { EventGraph } from './graph.js';

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

  const direct = graph.getDownstream(qualifiedId, 1);

  const allDownstream = graph.getDownstream(qualifiedId, maxDepth);
  const directIds = new Set(direct.map(n => `${n.context}.${n.id}`));
  const transitive = allDownstream.filter(n => !directIds.has(`${n.context}.${n.id}`));

  const upstreamDependents = graph.getUpstream(qualifiedId, 1);

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
