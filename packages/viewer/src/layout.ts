import type { EventGraph, GraphNode } from 'eventgraph-core';

export interface LayoutNode {
  id: string;
  label: string;
  type: string;
  context: string;
  swimlane: number;
  x: number;
  y: number;
  /** Rendered width. The renderer uses this, so layout and picture agree. */
  width: number;
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

/** Nominal column width, and the floor for a short label. */
export const NODE_WIDTH = 170;
const NODE_SPACING = 30;

/**
 * A node is as wide as its label needs. The renderer sets this width on the
 * element rather than letting the text size it, because a layout that packs
 * nodes against a width the picture does not use produces overlaps — which is
 * exactly what a node offset by a fraction of a column used to do.
 *
 * 11px/500 in the UI sans face measures under 7px per character across the
 * labels this renders; rounding up trades a little whitespace for never
 * clipping a name.
 */
const CHAR_WIDTH = 7;
const LABEL_PADDING = 30;

export function nodeWidth(label: string): number {
  return Math.max(NODE_WIDTH, Math.ceil(label.length * CHAR_WIDTH) + LABEL_PADDING);
}

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

  const placed = graph.getAllNodes().map(node => ({
    node,
    id: idOf(node),
    swimlane: SWIMLANE_ORDER[node.type] ?? SWIMLANE_LABELS.length - 1,
    column: columns.get(idOf(node)) ?? 0,
    width: nodeWidth(node.label),
  }));

  /*
   * Several nodes can share one lane of one column — three screens showing the
   * same read-model, say. They sit side by side, so the column has to be wide
   * enough for the busiest lane in it. Sizing every column that way keeps the
   * vertical alignment that makes a swimlane readable: a command still lines up
   * with the event it produces, however crowded a neighbouring lane gets.
   */
  const cellWidth = new Map<number, Map<number, number>>();
  for (const p of placed) {
    const lanes = cellWidth.get(p.column) ?? new Map<number, number>();
    lanes.set(p.swimlane, (lanes.get(p.swimlane) ?? -NODE_SPACING) + p.width + NODE_SPACING);
    cellWidth.set(p.column, lanes);
  }

  const lastColumn = Math.max(0, ...placed.map(p => p.column));
  const columnX: number[] = [];
  let x = 0;
  for (let column = 0; column <= lastColumn; column++) {
    columnX[column] = x;
    const lanes = cellWidth.get(column);
    const widest = Math.max(NODE_WIDTH, ...(lanes ? [...lanes.values()] : []));
    x += widest + NODE_SPACING;
  }

  const cellOffset = new Map<string, number>();
  return placed.map(p => {
    const key = `${p.swimlane}:${p.column}`;
    const offset = cellOffset.get(key) ?? 0;
    cellOffset.set(key, offset + p.width + NODE_SPACING);

    return {
      id: p.id,
      label: p.node.label,
      type: p.node.type,
      context: p.node.context,
      swimlane: p.swimlane,
      x: columnX[p.column] + offset,
      y: p.swimlane * SWIMLANE_HEIGHT,
      width: p.width,
      data: p.node.data,
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
