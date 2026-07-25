import type { EventGraph } from '../graph.js';
import type { GraphNode } from '../schema.js';
import { defineRule, finding } from './kit.js';

/**
 * Drift between separate codebases of one product.
 *
 * When the same product ships as two independent apps, they drift apart and
 * nobody notices until a user reports it. No linter or test can see this,
 * because the information lives *between* the repositories rather than inside
 * either one — which makes it the one check only a shared model can do.
 *
 * Active only when the project config declares platforms.
 */

/** Per-platform pointers, or null when the node is not platform-specific. */
function platformsOf(node: GraphNode): Map<string, string[]> | null {
  const raw = node.data?.implemented_by;
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') return null;
  return new Map(
    Object.entries(raw as Record<string, unknown>).map(([platform, list]) => [
      platform,
      (Array.isArray(list) ? list : []).filter((p): p is string => typeof p === 'string'),
    ])
  );
}

function declaredPlatforms(graph: EventGraph): string[] {
  return graph.platforms ?? [];
}

function platformNodes(graph: EventGraph): Array<{ node: GraphNode; impl: Map<string, string[]> }> {
  if (declaredPlatforms(graph).length === 0) return [];
  return graph
    .getAllNodes()
    .map(node => ({ node, impl: platformsOf(node) }))
    .filter((x): x is { node: GraphNode; impl: Map<string, string[]> } => x.impl !== null);
}

defineRule(
  {
    id: 'platform-drift',
    severity: 'warn',
    lane: 'platform',
    about:
      'A node built on one platform but missing on another. Two codebases of the same product drift apart silently, and the evidence sits between the repositories where no single-repo tool can reach it.',
  },
  (g, self) =>
    platformNodes(g).flatMap(({ node, impl }) => {
      const platforms = declaredPlatforms(g);
      const missing = platforms.filter(p => (impl.get(p) ?? []).length === 0);
      if (missing.length === 0) return [];
      const built = platforms.filter(p => (impl.get(p) ?? []).length > 0);
      return [
        finding(
          self,
          node,
          `built on ${built.join('/') || 'no platform'}, missing on ${missing.join('/')}`,
          `Implement it on ${missing.join('/')}, or use a flat implemented_by list if it is deliberately platform-specific.`
        ),
      ];
    })
);

defineRule(
  {
    id: 'platform-unknown',
    severity: 'error',
    lane: 'platform',
    about: 'An implementation is claimed for a platform the project never declared.',
  },
  (g, self) =>
    platformNodes(g).flatMap(({ node, impl }) =>
      [...impl.keys()]
        .filter(p => !declaredPlatforms(g).includes(p))
        .map(p =>
          finding(
            self,
            node,
            `implemented_by names undeclared platform "${p}"`,
            `Add it to platforms in eventgraph.yaml, or fix the key. Declared: ${declaredPlatforms(g).join(', ')}.`
          )
        )
    )
);

export { platformsOf };
