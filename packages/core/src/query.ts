import type { GraphNode } from './schema.js';
import type { EventGraph } from './graph.js';

interface QueryFilter {
  type?: string;
  context?: string;
  downstream?: string;
  upstream?: string;
  path?: { from: string; to: string };
  text?: string;
}

const KNOWN_FILTERS = ['type:', 'context:', 'downstream:', 'upstream:', 'path:'];

export class QueryEngine {
  constructor(private graph: EventGraph) {}

  query(expr: string): GraphNode[] {
    const filter = this.parseExpression(expr);

    if (filter.path) {
      const fromId = this.resolveNodeId(filter.path.from);
      const toId = this.resolveNodeId(filter.path.to);
      if (!fromId || !toId) return [];
      return this.graph.findPath(fromId, toId) ?? [];
    }

    if (filter.downstream) {
      const nodeId = this.resolveNodeId(filter.downstream);
      if (!nodeId) return [];
      return this.graph.getDownstream(nodeId);
    }

    if (filter.upstream) {
      const nodeId = this.resolveNodeId(filter.upstream);
      if (!nodeId) return [];
      return this.graph.getUpstream(nodeId);
    }

    let nodes = this.graph.getAllNodes();

    if (filter.type) {
      nodes = nodes.filter(n => n.type === filter.type);
    }

    if (filter.context) {
      nodes = nodes.filter(n => n.context === filter.context);
    }

    if (filter.text) {
      const lower = filter.text.toLowerCase();
      nodes = nodes.filter(n =>
        n.label.toLowerCase().includes(lower) ||
        n.id.toLowerCase().includes(lower)
      );
    }

    return nodes;
  }

  private parseExpression(expr: string): QueryFilter {
    const filter: QueryFilter = {};
    const parts = expr.trim().split(/\s+/);

    for (const part of parts) {
      // A token shaped like a filter but naming no known one used to fall
      // through to free-text search, so a typo returned "no matches" — the
      // same answer as a correct query with nothing to find.
      const looksLikeFilter = /^[a-z][a-z-]*:/.exec(part);
      if (looksLikeFilter && !KNOWN_FILTERS.some(f => part.startsWith(f))) {
        throw new Error(
          `unknown filter "${looksLikeFilter[0]}" — known filters are ${KNOWN_FILTERS.join(', ')}`
        );
      }

      if (part.startsWith('type:')) {
        filter.type = part.substring(5);
      } else if (part.startsWith('context:')) {
        filter.context = part.substring(8);
      } else if (part.startsWith('downstream:')) {
        filter.downstream = part.substring(11);
      } else if (part.startsWith('upstream:')) {
        filter.upstream = part.substring(9);
      } else if (part.startsWith('path:')) {
        const pathExpr = part.substring(5);
        const [from, to] = pathExpr.split('..');
        if (from && to) {
          filter.path = { from, to };
        }
      } else if (part.length > 0) {
        filter.text = (filter.text ? filter.text + ' ' : '') + part;
      }
    }

    return filter;
  }

  private resolveNodeId(shortId: string): string | null {
    if (shortId.includes('.')) {
      return this.graph.getNode(shortId) ? shortId : null;
    }
    const allNodes = this.graph.getAllNodes();
    const match = allNodes.find(n => n.id === shortId);
    if (!match) return null;
    return `${match.context}.${match.id}`;
  }
}
