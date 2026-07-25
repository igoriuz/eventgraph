import type { GraphNode, GraphEdge } from './schema.js';
import { qualifiedId } from './schema.js';

export class EventGraph {
  /**
   * Platforms this product ships as, from the project config. Empty for a
   * single-codebase project, which is what switches the drift rules off.
   */
  platforms: string[] = [];

  private nodes = new Map<string, GraphNode>();
  private outgoing = new Map<string, GraphEdge[]>();
  private incoming = new Map<string, GraphEdge[]>();

  addNode(node: GraphNode): void {
    const qid = qualifiedId(node.context, node.id);
    this.nodes.set(qid, node);
  }

  getNode(qualifiedId: string): GraphNode | undefined {
    return this.nodes.get(qualifiedId);
  }

  removeNode(qualifiedId: string): void {
    this.nodes.delete(qualifiedId);
    const edgesToRemove = [
      ...(this.outgoing.get(qualifiedId) ?? []),
      ...(this.incoming.get(qualifiedId) ?? []),
    ];
    for (const edge of edgesToRemove) {
      this.removeEdgeInternal(edge);
    }
    this.outgoing.delete(qualifiedId);
    this.incoming.delete(qualifiedId);
  }

  getAllNodes(): GraphNode[] {
    return [...this.nodes.values()];
  }

  getNodesByContext(context: string): GraphNode[] {
    return this.getAllNodes().filter(n => n.context === context);
  }

  getNodesByType(type: string): GraphNode[] {
    return this.getAllNodes().filter(n => n.type === type);
  }

  getContexts(): string[] {
    const contexts = new Set<string>();
    for (const node of this.nodes.values()) {
      contexts.add(node.context);
    }
    return [...contexts];
  }

  addEdge(edge: GraphEdge): void {
    const out = this.outgoing.get(edge.from) ?? [];
    out.push(edge);
    this.outgoing.set(edge.from, out);

    const inc = this.incoming.get(edge.to) ?? [];
    inc.push(edge);
    this.incoming.set(edge.to, inc);
  }

  getOutgoingEdges(qualifiedId: string): GraphEdge[] {
    return this.outgoing.get(qualifiedId) ?? [];
  }

  getIncomingEdges(qualifiedId: string): GraphEdge[] {
    return this.incoming.get(qualifiedId) ?? [];
  }

  getAllEdges(): GraphEdge[] {
    const edges: GraphEdge[] = [];
    for (const list of this.outgoing.values()) {
      edges.push(...list);
    }
    return edges;
  }

  getDownstream(startId: string, maxDepth = Infinity): GraphNode[] {
    const visited = new Set<string>();
    const result: GraphNode[] = [];
    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);

      if (id !== startId) {
        const node = this.nodes.get(id);
        if (node) result.push(node);
      }

      if (depth < maxDepth) {
        for (const edge of this.getOutgoingEdges(id)) {
          if (!visited.has(edge.to)) {
            queue.push({ id: edge.to, depth: depth + 1 });
          }
        }
      }
    }

    return result;
  }

  getUpstream(startId: string, maxDepth = Infinity): GraphNode[] {
    const visited = new Set<string>();
    const result: GraphNode[] = [];
    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);

      if (id !== startId) {
        const node = this.nodes.get(id);
        if (node) result.push(node);
      }

      if (depth < maxDepth) {
        for (const edge of this.getIncomingEdges(id)) {
          if (!visited.has(edge.from)) {
            queue.push({ id: edge.from, depth: depth + 1 });
          }
        }
      }
    }

    return result;
  }

  findPath(fromId: string, toId: string): GraphNode[] | null {
    const visited = new Set<string>();
    const parent = new Map<string, string>();
    const queue = [fromId];
    visited.add(fromId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === toId) {
        const path: GraphNode[] = [];
        let id: string | undefined = toId;
        while (id !== undefined) {
          const node = this.nodes.get(id);
          if (node) path.unshift(node);
          id = parent.get(id);
        }
        return path;
      }

      for (const edge of this.getOutgoingEdges(current)) {
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          parent.set(edge.to, current);
          queue.push(edge.to);
        }
      }
    }

    return null;
  }

  private removeEdgeInternal(edge: GraphEdge): void {
    const out = this.outgoing.get(edge.from);
    if (out) {
      const idx = out.indexOf(edge);
      if (idx !== -1) out.splice(idx, 1);
    }
    const inc = this.incoming.get(edge.to);
    if (inc) {
      const idx = inc.indexOf(edge);
      if (idx !== -1) inc.splice(idx, 1);
    }
  }
}
