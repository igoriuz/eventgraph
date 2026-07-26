import type { ContextModelNode } from '../schema.js';
import { IdSet, kebab, singularise, titleise, type ScaffoldSource } from './sources.js';

/**
 * Finds the consistency boundaries a persistence layer already declares.
 *
 * A table is not automatically an aggregate — join tables and projections live
 * there too — so these are candidates. But the set of tables is the closest
 * thing a codebase has to a written-down list of what owns state, and starting
 * from it beats starting from nothing.
 */

const PATTERNS: Array<{ tool: string; pattern: RegExp; group: number }> = [
  // Drizzle: export const users = pgTable('users', …)
  { tool: 'drizzle', pattern: /\b(?:pg|sqlite|mysql)Table\s*\(\s*['"`]([\w-]+)['"`]/g, group: 1 },
  // Prisma: model User {
  { tool: 'prisma', pattern: /^\s*model\s+(\w+)\s*\{/gm, group: 1 },
  // TypeORM / MikroORM: @Entity(…) … export class User
  { tool: 'typeorm', pattern: /@Entity\s*\([^)]*\)\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g, group: 1 },
  // Sequelize: sequelize.define('User', …)
  { tool: 'sequelize', pattern: /\.define\s*\(\s*['"`](\w+)['"`]/g, group: 1 },
];

/**
 * Tables that hold a projection or a join rather than an aggregate root. The
 * list is short on purpose — guessing too hard here hides real aggregates.
 */
const NOT_AN_AGGREGATE = /(^|_)(migrations?|sessions?|logs?|audit|cache|views?)$/;

export interface AggregateResult {
  nodes: ContextModelNode[];
  notes: string[];
}

export function extractAggregates(sources: ScaffoldSource[], ids: IdSet): AggregateResult {
  const found = new Map<string, { id: string; src: Set<string>; table: string }>();
  const tools = new Set<string>();
  let skipped = 0;

  for (const source of sources) {
    for (const { tool, pattern, group } of PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source.content)) !== null) {
        const table = match[group]!;
        if (NOT_AN_AGGREGATE.test(kebab(table))) {
          skipped++;
          continue;
        }
        tools.add(tool);

        const id = kebab(singularise(table));
        const existing = found.get(id);
        if (existing) {
          existing.src.add(source.path);
          continue;
        }
        found.set(id, { id: ids.claim(id), src: new Set([source.path]), table });
      }
    }
  }

  const nodes = [...found.values()].map(entry => ({
    id: entry.id,
    type: 'aggregate',
    label: titleise(entry.id),
    data: { implemented_by: [...entry.src], status: 'implemented' },
  }));

  const notes: string[] = [];
  if (nodes.length > 0) {
    notes.push(`${nodes.length} table(s) via ${[...tools].join(', ')}, singularised into aggregate names`);
    notes.push('a table is a candidate aggregate; join tables and projections are not aggregates');
  }
  if (skipped > 0) notes.push(`${skipped} table(s) skipped as infrastructure`);

  return { nodes, notes };
}
