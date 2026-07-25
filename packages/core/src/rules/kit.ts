import type { EventGraph } from '../graph.js';
import type { GraphNode } from '../schema.js';
import { qualifiedId } from '../schema.js';

export type Severity = 'error' | 'warn';
export type Lane = 'bootstrap' | 'structure' | 'ux' | 'platform';

export interface Finding {
  rule: string;
  severity: Severity;
  lane: Lane;
  /** Qualified node id, or "(graph)" for findings about the graph as a whole. */
  node: string;
  message: string;
  /** The concrete next action — this is what `next` hands to an agent. */
  hint: string;
}

export interface Rule {
  id: string;
  severity: Severity;
  lane: Lane;
  /** Why the rule exists, shown by `eventgraph rules`. */
  about: string;
  check: (graph: EventGraph) => Finding[];
}

const registry = new Map<string, Rule>();

export function defineRule(spec: Omit<Rule, 'check'>, check: (graph: EventGraph, self: Rule) => Finding[]): Rule {
  if (registry.has(spec.id)) throw new Error(`duplicate rule id "${spec.id}"`);
  const rule: Rule = { ...spec, check: g => check(g, rule) };
  registry.set(spec.id, rule);
  return rule;
}

export function allRules(): Rule[] {
  return [...registry.values()];
}

export function getRule(id: string): Rule | undefined {
  return registry.get(id);
}

export function finding(rule: Rule, node: GraphNode | string, message: string, hint: string): Finding {
  return {
    rule: rule.id,
    severity: rule.severity,
    lane: rule.lane,
    node: typeof node === 'string' ? node : qualifiedId(node.context, node.id),
    message,
    hint,
  };
}

/** Placeholder id for findings that are about the whole graph, not one node. */
export const GRAPH = '(graph)';

// --- traversal helpers, so rules read as intent rather than edge plumbing ---

export const idOf = (node: GraphNode) => qualifiedId(node.context, node.id);

/** Nodes this node points at along `edgeType`. */
export function targets(graph: EventGraph, node: GraphNode, edgeType: string): GraphNode[] {
  return graph
    .getOutgoingEdges(idOf(node))
    .filter(e => e.type === edgeType)
    .map(e => graph.getNode(e.to))
    .filter((n): n is GraphNode => n !== undefined);
}

/** Nodes pointing at this node along `edgeType`, optionally of one node type. */
export function sources(
  graph: EventGraph,
  node: GraphNode,
  edgeType: string,
  fromType?: string
): GraphNode[] {
  return graph
    .getIncomingEdges(idOf(node))
    .filter(e => e.type === edgeType)
    .map(e => graph.getNode(e.from))
    .filter((n): n is GraphNode => n !== undefined && (!fromType || n.type === fromType));
}

/** A node's semantic flag, e.g. `terminal` on an event. */
export function flag<T = unknown>(node: GraphNode, key: string): T | undefined {
  return node.data?.[key] as T | undefined;
}

export function hasFlag(node: GraphNode, key: string): boolean {
  const value = flag(node, key);
  return value === true || (typeof value === 'string' && value.length > 0);
}
