import { Document, isMap, isSeq, parseDocument, YAMLMap, YAMLSeq } from 'yaml';
import type { ContextModel, ContextModelNode, GraphEdge } from './schema.js';

/**
 * The on-disk shape of a context model, and the translation to the flat
 * `ContextModel` every other module works with.
 *
 * The two differ on purpose. In memory a node is a record and an edge is a
 * triple, because that is what rules and queries traverse. On disk that shape
 * costs three lines per node before saying anything — an `id:` line, a `data:`
 * line, and a `status:` line derivable from the source pointer beside it. On a
 * real model that was 17% of the file carrying no information, which is enough
 * ceremony to make people stop reading the thing.
 *
 * Compact form:
 *
 *     nodes:
 *       place-order: { type: command, label: Place Order, src: src/orders/place.ts }
 *       order-placed:
 *         type: event
 *         label: Order Placed
 *         terminal: nothing reacts, deliberately
 *     edges:
 *       produces:
 *         place-order: [order-placed]
 *
 * Anything on a node that is not `type`, `label` or `src` is a semantic flag
 * and lands in `data` untouched, so adding a flag to a preset needs no change
 * here.
 */

/** Keys with a fixed meaning on a node; everything else is a flag. */
const RESERVED = new Set(['type', 'label', 'src']);

/** How wide an inlined node may get before it earns its own lines. */
const FLOW_WIDTH = 80;

function titleise(id: string): string {
  return id
    .split('-')
    .filter(Boolean)
    .map(w => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * `src` is the same information `implemented_by` holds, under a name short
 * enough to sit inline. It stays `implemented_by` in memory so verify and the
 * platform lane are untouched.
 */
function srcToImplementedBy(src: unknown): unknown {
  if (typeof src === 'string') return [src];
  return src;
}

function implementedByToSrc(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') return value[0];
  return value;
}

/**
 * True when a pointer set names no source at all. A platform map whose every
 * list is empty is the total-drift case, not an implemented node — claiming
 * otherwise would hide exactly what the platform lane exists to find.
 */
function isEmptySrc(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.values(value as object).every(isEmptySrc);
  return false;
}

// --- reading ---------------------------------------------------------------

/** True when a parsed model uses the compact form rather than the list form. */
export function isCompactModel(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const nodes = (raw as { nodes?: unknown }).nodes;
  const edges = (raw as { edges?: unknown }).edges;
  if (nodes !== undefined && !Array.isArray(nodes) && typeof nodes === 'object') return true;
  if (edges !== undefined && !Array.isArray(edges) && typeof edges === 'object') return true;
  return false;
}

function nodeFromCompact(id: string, raw: unknown): ContextModelNode {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`node "${id}" must be a mapping of type, label and flags`);
  }
  const entries = raw as Record<string, unknown>;
  const type = entries.type;
  if (typeof type !== 'string' || type.length === 0) {
    throw new Error(`node "${id}" has no type`);
  }

  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (!RESERVED.has(key)) data[key] = value;
  }

  if (entries.src !== undefined) {
    data.implemented_by = srcToImplementedBy(entries.src);
    // A node naming real source is implemented by definition. Saying so again
    // on its own line was the single most repeated statement in the format,
    // and an explicit status still wins so "planned" stays sayable.
    if (data.status === undefined && !isEmptySrc(data.implemented_by)) {
      data.status = 'implemented';
    }
  }

  const label = typeof entries.label === 'string' ? entries.label : titleise(id);
  const node: ContextModelNode = { id, type, label };
  if (Object.keys(data).length > 0) node.data = data;
  return node;
}

function edgesFromCompact(raw: unknown): GraphEdge[] {
  if (raw === undefined || raw === null) return [];
  if (!raw || typeof raw !== 'object') throw new Error('edges must be a mapping of edge type to source');

  const edges: GraphEdge[] = [];
  for (const [type, bySource] of Object.entries(raw as Record<string, unknown>)) {
    if (!bySource || typeof bySource !== 'object' || Array.isArray(bySource)) {
      throw new Error(`edges.${type} must map a source id to a list of targets`);
    }
    for (const [from, targets] of Object.entries(bySource as Record<string, unknown>)) {
      const list = Array.isArray(targets) ? targets : [targets];
      for (const to of list) {
        if (typeof to !== 'string') {
          throw new Error(`edges.${type}.${from} must be a list of node ids`);
        }
        edges.push({ from, to, type });
      }
    }
  }
  return edges;
}

/**
 * Normalises either on-disk form into the flat model. Both are accepted so a
 * project can be migrated file by file rather than all at once.
 */
export function parseContextModel(raw: unknown): ContextModel {
  if (!raw || typeof raw !== 'object') throw new Error('model must be a mapping');
  const model = raw as Record<string, unknown>;
  const context = model.context;
  if (typeof context !== 'string' || context.length === 0) {
    throw new Error('model has no context name');
  }

  if (!isCompactModel(raw)) {
    return {
      context,
      nodes: (model.nodes as ContextModelNode[]) ?? [],
      edges: (model.edges as GraphEdge[]) ?? [],
    };
  }

  const nodes = Object.entries((model.nodes as Record<string, unknown>) ?? {}).map(([id, raw]) =>
    nodeFromCompact(id, raw)
  );

  return { context, nodes, edges: edgesFromCompact(model.edges) };
}

// --- writing ---------------------------------------------------------------

/** The compact mapping for one node, `src` and flags folded back together. */
export function nodeToCompact(node: ContextModelNode): Record<string, unknown> {
  const out: Record<string, unknown> = { type: node.type };
  if (node.label && node.label !== titleise(node.id)) out.label = node.label;

  const data = { ...(node.data ?? {}) };
  const implementedBy = data.implemented_by;
  delete data.implemented_by;
  // Derivable from src, so writing it back would reintroduce the noise.
  if (data.status === 'implemented' && !isEmptySrc(implementedBy)) delete data.status;

  if (implementedBy !== undefined) out.src = implementedByToSrc(implementedBy);
  for (const [key, value] of Object.entries(data)) out[key] = value;
  return out;
}

function groupEdges(edges: GraphEdge[]): Record<string, Record<string, string[]>> {
  const byType: Record<string, Record<string, string[]>> = {};
  for (const edge of edges) {
    const bySource = (byType[edge.type] ??= {});
    const targets = (bySource[edge.from] ??= []);
    if (!targets.includes(edge.to)) targets.push(edge.to);
  }
  return byType;
}

/** Renders a whole model in compact form. Used by `migrate`, not by edits. */
export function stringifyContextModel(model: ContextModel): string {
  const doc = new Document({
    context: model.context,
    nodes: Object.fromEntries(model.nodes.map(n => [n.id, nodeToCompact(n)])),
    edges: groupEdges(model.edges),
  });

  const nodes = doc.get('nodes');
  if (isMap(nodes)) {
    for (const item of nodes.items) {
      if (isMap(item.value)) applyFlowIfShort(item.value, String(item.key));
    }
  }
  const edges = doc.get('edges');
  if (isMap(edges)) {
    for (const byType of edges.items) {
      if (!isMap(byType.value)) continue;
      for (const bySource of byType.value.items) {
        if (isSeq(bySource.value)) bySource.value.flow = true;
      }
    }
  }

  return doc.toString({ lineWidth: 0 });
}

/**
 * Inline a node only while it still fits on a line. A long `terminal:` reason
 * on one line is worse than the two lines it saves. The key sits on that same
 * line, so it counts toward the width.
 */
function applyFlowIfShort(map: YAMLMap, key = ''): void {
  const probe = new Document(map.toJSON());
  probe.contents && ((probe.contents as YAMLMap).flow = true);
  const flat = probe.toString({ lineWidth: 0 }).replace(/\n/g, ' ').trim();
  if (key.length + 2 + flat.length <= FLOW_WIDTH) map.flow = true;
}

// --- editing, without losing the file around the change --------------------

/**
 * Edits go through the YAML document tree rather than parse-mutate-restringify.
 * The round trip through plain objects dropped every comment in the file, so an
 * agent adding one node silently deleted the prose explaining the rest.
 */
export function editContextDocument(
  content: string,
  edit: (doc: Document) => void,
): string {
  const doc = parseDocument(content);
  if (doc.errors.length > 0) throw new Error(doc.errors[0]!.message);
  ensureCompactContainers(doc);
  edit(doc);
  return doc.toString({ lineWidth: 0 });
}

/**
 * Writes only produce the compact form. An empty `nodes: []` left over from an
 * older scaffold is just swapped for a mapping, but a file with real list-form
 * content is refused rather than silently reshaped — converting it would drop
 * the comments in it, which is a thing to opt into, not to discover.
 */
function ensureCompactContainers(doc: Document): void {
  for (const key of ['nodes', 'edges']) {
    const value = doc.get(key);
    if (isSeq(value)) {
      if (value.items.length > 0) {
        throw new Error(`"${key}" still uses the list form — run "eventgraph migrate" to convert this context`);
      }
      doc.set(key, new YAMLMap());
      continue;
    }
    // An empty `{}` from the scaffold is a flow map, and adding to it would
    // keep the whole node list on one line as it grew.
    if (isMap(value)) value.flow = false;
  }
}

/** Adds or replaces a node in a compact document. */
export function setNodeInDocument(doc: Document, node: ContextModelNode): void {
  if (!doc.has('nodes') || doc.get('nodes') === null) doc.set('nodes', new YAMLMap());
  const compact = nodeToCompact(node);
  const map = doc.createNode(compact) as YAMLMap;
  applyFlowIfShort(map, node.id);
  doc.setIn(['nodes', node.id], map);
}

/** Adds an edge to a compact document, leaving an existing group in place. */
export function addEdgeToDocument(doc: Document, edge: GraphEdge): void {
  if (!doc.has('edges') || doc.get('edges') === null) doc.set('edges', new YAMLMap());

  const existing = doc.getIn(['edges', edge.type, edge.from]);
  if (isSeq(existing)) {
    if (!existing.toJSON().includes(edge.to)) existing.add(doc.createNode(edge.to));
    return;
  }

  const seq = doc.createNode([edge.to]) as YAMLSeq;
  seq.flow = true;
  doc.setIn(['edges', edge.type, edge.from], seq);
}

/** Removes a node and every edge touching it, by local or qualified id. */
export function removeNodeFromDocument(doc: Document, nodeId: string): void {
  doc.deleteIn(['nodes', nodeId]);

  const edges = doc.get('edges');
  if (!isMap(edges)) return;

  const matches = (id: unknown) =>
    typeof id === 'string' && (id === nodeId || id.split('.').pop() === nodeId);

  for (const byType of [...edges.items]) {
    if (!isMap(byType.value)) continue;
    for (const bySource of [...byType.value.items]) {
      if (matches(bySource.key?.toString())) {
        byType.value.delete(bySource.key);
        continue;
      }
      if (!isSeq(bySource.value)) continue;
      const kept = (bySource.value.toJSON() as string[]).filter(t => !matches(t));
      if (kept.length === 0) byType.value.delete(bySource.key);
      else if (kept.length !== bySource.value.items.length) {
        const seq = doc.createNode(kept) as YAMLSeq;
        seq.flow = true;
        bySource.value = seq;
      }
    }
    if (byType.value.items.length === 0) edges.delete(byType.key);
  }
}
