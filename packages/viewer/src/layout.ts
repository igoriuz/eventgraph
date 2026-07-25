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

/**
 * Rows, top to bottom: who acts, what they see, what they do, what happened,
 * what reacts, what owns it. This is the event-modeling reading order.
 */
const SWIMLANE_ORDER: Record<string, number> = {
  actor: 0,
  screen: 1,
  'read-model': 2,
  command: 3,
  event: 4,
  policy: 5,
  aggregate: 6,
  invariant: 6,
  decision: 7,
  question: 7,
  service: 7,
  custom: 7,
};

export const SWIMLANE_LABELS = [
  'Actors',
  'Screens',
  'Read Models',
  'Commands',
  'Events',
  'Policies',
  'Aggregates & Rules',
  'Notes',
];

export const SWIMLANE_HEIGHT = 110;
export const NODE_WIDTH = 170;
const NODE_SPACING = 30;

const idOf = (n: GraphNode) => `${n.context}.${n.id}`;

/**
 * Assigns every node an x-column derived from the flow it belongs to, rather
 * than from its position in a list.
 *
 * Each event opens a column; the command that produces it, the read-models it
 * projects into, the screens showing those and the policies reacting to it all
 * join that same column. That is what makes a swimlane readable — related
 * nodes line up vertically instead of the edges criss-crossing the grid.
 */
function assignColumns(graph: EventGraph): Map<string, number> {
  const column = new Map<string, number>();
  const claim = (id: string, col: number) => {
    if (!column.has(id)) column.set(id, col);
  };

  const events = graph
    .getNodesByType('event')
    .sort((a, b) => idOf(a).localeCompare(idOf(b)));

  let col = 0;
  for (const event of events) {
    const here = col++;
    claim(idOf(event), here);

    for (const edge of graph.getIncomingEdges(idOf(event))) {
      // The command that caused it, and the actor issuing that command.
      if (edge.type !== 'produces') continue;
      claim(edge.from, here);
      for (const up of graph.getIncomingEdges(edge.from)) {
        if (up.type === 'issues' || up.type === 'offers') claim(up.from, here);
      }
    }

    for (const edge of graph.getOutgoingEdges(idOf(event))) {
      // Read-models it feeds, plus the surfaces showing them; policies too.
      if (edge.type === 'projects-to') {
        claim(edge.to, here);
        for (const down of graph.getIncomingEdges(edge.to)) {
          if (down.type === 'reads') claim(down.from, here);
        }
      }
      if (edge.type === 'triggers') claim(edge.to, here);
      if (edge.type === 'belongs-to') claim(edge.to, here);
    }
  }

  // Anything the flow never reached — unattached notes, idle actors — trails
  // at the end rather than being dropped or piled onto column zero. Only
  // genuinely unplaced nodes consume a column; advancing on every node would
  // stretch the canvas to several times its needed width.
  for (const node of graph.getAllNodes()) {
    if (column.has(idOf(node))) continue;
    claim(idOf(node), col++);
  }

  return column;
}

export function computeLayout(graph: EventGraph): LayoutNode[] {
  const columns = assignColumns(graph);
  const usedSlots = new Map<string, number>();

  return graph.getAllNodes().map(node => {
    const id = idOf(node);
    const swimlane = SWIMLANE_ORDER[node.type] ?? SWIMLANE_LABELS.length - 1;
    const column = columns.get(id) ?? 0;

    // Two nodes of the same type in the same column would overlap, so the
    // second one steps sideways by a fraction of a column.
    const slotKey = `${swimlane}:${column}`;
    const slot = usedSlots.get(slotKey) ?? 0;
    usedSlots.set(slotKey, slot + 1);

    return {
      id,
      label: node.label,
      type: node.type,
      context: node.context,
      swimlane,
      x: column * (NODE_WIDTH + NODE_SPACING) + slot * (NODE_WIDTH / 3),
      y: swimlane * SWIMLANE_HEIGHT + slot * 26,
      data: node.data,
    };
  });
}

export function computeFullLayout(graph: EventGraph): ViewerLayout {
  return {
    nodes: computeLayout(graph),
    edges: graph.getAllEdges().map(e => ({ from: e.from, to: e.to, type: e.type })),
    swimlanes: SWIMLANE_LABELS,
  };
}
