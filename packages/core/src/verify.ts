import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { EventGraph } from './graph.js';
import type { GraphNode } from './schema.js';
import { qualifiedId } from './schema.js';

/**
 * Checks that `implemented_by` still points at files that exist.
 *
 * Rules reason about the graph alone, so nothing they can see stops a model
 * from quietly describing code that was renamed or deleted. This is the one
 * check that needs the filesystem, and without it a graph slowly becomes a
 * document nobody trusts — which is how modelling efforts usually die.
 */

export interface VerifyIssue {
  node: string;
  /** The pointer as written, symbol suffix included. */
  pointer: string;
  path: string;
  platform?: string;
  reason: 'missing';
}

export interface VerifyReport {
  checked: number;
  nodesWithPointers: number;
  issues: VerifyIssue[];
  /** Nodes claiming to be implemented without naming any source. */
  undeclared: string[];
}

/**
 * Pointers may carry a `#symbol` suffix. Only the file part is verified —
 * resolving symbols would need a parser per language, and a missing file is
 * already the failure that matters.
 */
export function pointerPath(pointer: string): string {
  const hash = pointer.indexOf('#');
  return hash === -1 ? pointer : pointer.slice(0, hash);
}

/** Normalises `implemented_by` into (platform, pointer) pairs. */
export function pointersOf(node: GraphNode): Array<{ platform?: string; pointer: string }> {
  const raw = node.data?.implemented_by;
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.filter((p): p is string => typeof p === 'string').map(pointer => ({ pointer }));
  }
  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).flatMap(([platform, list]) =>
      (Array.isArray(list) ? list : [])
        .filter((p): p is string => typeof p === 'string')
        .map(pointer => ({ platform, pointer }))
    );
  }
  return [];
}

/**
 * `sourceRoot` is where pointers are resolved from — normally the repository
 * holding the code, which is the parent of the eventgraph project directory.
 */
export function verifyImplementations(graph: EventGraph, sourceRoot: string): VerifyReport {
  const issues: VerifyIssue[] = [];
  const undeclared: string[] = [];
  let checked = 0;
  let nodesWithPointers = 0;

  for (const node of graph.getAllNodes()) {
    const id = qualifiedId(node.context, node.id);
    const pointers = pointersOf(node);

    if (pointers.length === 0) {
      // Only a node that claims to be built is expected to say where.
      if (node.data?.status === 'implemented') undeclared.push(id);
      continue;
    }
    nodesWithPointers++;

    for (const { platform, pointer } of pointers) {
      const path = pointerPath(pointer);
      // A pointer with no file part is a pure marker, e.g. "shared".
      if (path.length === 0 || !path.includes('/')) continue;
      checked++;

      const resolved = isAbsolute(path) ? path : join(sourceRoot, path);
      if (!existsSync(resolved)) {
        issues.push({ node: id, pointer, path, platform, reason: 'missing' });
      }
    }
  }

  return { checked, nodesWithPointers, issues, undeclared };
}
