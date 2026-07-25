import { EventGraph } from './graph.js';
import type { GraphNode } from './schema.js';
import { qualifiedId } from './schema.js';

/**
 * Views onto a part of the graph.
 *
 * A whole-graph picture stops being usable within a few dozen nodes — which is
 * the same failure that makes a growing event-modeling board unreadable. The
 * point of keeping this as a queryable graph is that the board is a *view*: you
 * ask for the slice you care about and it is rendered on demand.
 */

const idOf = (n: GraphNode) => qualifiedId(n.context, n.id);

/** Resolves a bare id like "place-order" to "context.place-order". */
export function resolveId(graph: EventGraph, id: string): string | undefined {
  if (graph.getNode(id)) return id;
  const matches = graph.getAllNodes().filter(n => n.id === id);
  return matches.length === 1 ? idOf(matches[0]!) : undefined;
}

export interface Slice {
  event: GraphNode;
  /** Who sets it in motion, and where. */
  actors: GraphNode[];
  screens: GraphNode[];
  causedBy: GraphNode[];
  aggregate: GraphNode | undefined;
  /** What reacts to it. */
  readModels: GraphNode[];
  policies: GraphNode[];
  /** Surfaces where the resulting projections are shown. */
  shownOn: GraphNode[];
}

/**
 * The classic swimlane, reconstructed around a single event.
 *
 * This is a projection, not the storage format — which is exactly why the model
 * stays workable as it grows: you never maintain the board, you ask for it.
 */
export function slice(graph: EventGraph, eventId: string): Slice {
  const id = resolveId(graph, eventId);
  const event = id ? graph.getNode(id) : undefined;
  if (!event) throw new Error(`unknown node "${eventId}"`);
  if (event.type !== 'event') throw new Error(`"${eventId}" is a ${event.type}, slice expects an event`);

  const incoming = (type: string) =>
    graph
      .getIncomingEdges(id!)
      .filter(e => e.type === type)
      .map(e => graph.getNode(e.from))
      .filter((n): n is GraphNode => n !== undefined);

  const outgoing = (type: string) =>
    graph
      .getOutgoingEdges(id!)
      .filter(e => e.type === type)
      .map(e => graph.getNode(e.to))
      .filter((n): n is GraphNode => n !== undefined);

  const causedBy = incoming('produces');
  const readModels = outgoing('projects-to');

  const actors = new Map<string, GraphNode>();
  const screens = new Map<string, GraphNode>();
  for (const command of causedBy) {
    for (const e of graph.getIncomingEdges(idOf(command))) {
      const source = graph.getNode(e.from);
      if (!source) continue;
      if (e.type === 'issues') actors.set(idOf(source), source);
      if (e.type === 'offers') screens.set(idOf(source), source);
    }
  }

  const shownOn = new Map<string, GraphNode>();
  for (const rm of readModels) {
    for (const e of graph.getIncomingEdges(idOf(rm))) {
      const surface = graph.getNode(e.from);
      if (e.type === 'reads' && surface?.type === 'screen') shownOn.set(idOf(surface), surface);
    }
  }

  return {
    event,
    actors: [...actors.values()],
    screens: [...screens.values()],
    causedBy,
    aggregate: outgoing('belongs-to')[0],
    readModels,
    policies: outgoing('triggers'),
    shownOn: [...shownOn.values()],
  };
}

/** Every event belonging to an aggregate, lifecycle-ending ones last. */
export function lifecycle(graph: EventGraph, aggregateId: string): GraphNode[] {
  const id = resolveId(graph, aggregateId);
  const aggregate = id ? graph.getNode(id) : undefined;
  if (!aggregate) throw new Error(`unknown node "${aggregateId}"`);
  if (aggregate.type !== 'aggregate') {
    throw new Error(`"${aggregateId}" is a ${aggregate.type}, lifecycle expects an aggregate`);
  }

  return graph
    .getIncomingEdges(id!)
    .filter(e => e.type === 'belongs-to')
    .map(e => graph.getNode(e.from))
    .filter((n): n is GraphNode => n?.type === 'event')
    .sort((a, b) => {
      const closes = (n: GraphNode) => (n.data?.ends_lifecycle === true ? 1 : 0);
      return closes(a) - closes(b) || a.id.localeCompare(b.id);
    });
}

/**
 * A new graph holding only `ids` and the edges between them. Used to render a
 * part of the model rather than the whole thing.
 */
export function subgraph(graph: EventGraph, ids: Iterable<string>): EventGraph {
  const keep = new Set(ids);
  const result = new EventGraph();

  for (const id of keep) {
    const node = graph.getNode(id);
    if (node) result.addNode(node);
  }
  for (const edge of graph.getAllEdges()) {
    if (keep.has(edge.from) && keep.has(edge.to)) result.addEdge(edge);
  }
  return result;
}

/** Ids within `depth` undirected hops of `startId`, including it. */
export function neighbourhood(graph: EventGraph, startId: string, depth = 1): Set<string> {
  const start = resolveId(graph, startId);
  if (!start) throw new Error(`unknown node "${startId}"`);

  const seen = new Set([start]);
  let frontier = [start];

  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      const adjacent = [
        ...graph.getOutgoingEdges(id).map(e => e.to),
        ...graph.getIncomingEdges(id).map(e => e.from),
      ];
      for (const other of adjacent) {
        if (seen.has(other)) continue;
        seen.add(other);
        next.push(other);
      }
    }
    frontier = next;
  }
  return seen;
}

/** The nodes of one slice, as a graph — the swimlane for a single event. */
export function sliceGraph(graph: EventGraph, eventId: string): EventGraph {
  const s = slice(graph, eventId);
  const members = [
    s.event,
    ...s.actors,
    ...s.screens,
    ...s.causedBy,
    ...s.readModels,
    ...s.policies,
    ...s.shownOn,
    ...(s.aggregate ? [s.aggregate] : []),
  ];
  return subgraph(graph, members.map(idOf));
}
