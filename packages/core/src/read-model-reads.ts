import type { EventGraph } from './graph.js';
import type { GraphNode } from './schema.js';
import { qualifiedId } from './schema.js';
import { readFileSync } from 'node:fs';
import { referencedBy, sourceFilesOf, sourceFilesUnder } from './source-search.js';
import { pointersOf } from './verify.js';

/**
 * Checks that a reader of a core read-model actually reads it.
 *
 * In an app built around a core, the read-models are core types the CLI and
 * the screens both read. A migration stops halfway without anyone noticing:
 * the CLI reads the core type, the screen keeps computing the same answer from
 * raw state, and the model still says the screen `reads` the read-model. Both
 * answers work until they drift apart.
 *
 * Opt-in by naming the symbol: a read-model whose `implemented_by` carries
 * `#Symbol` is a type the code can be searched for. Without one the read-model
 * names a question the code answers under other names, which no search can
 * hold it to. The symbol must occur as a whole word in the reader's source or
 * in a file that source refers to (one hop: a screen reading through a
 * repository or a view model is still reading it).
 */

export interface ReadModelReadIssue {
  /** Qualified id of the screen or policy said to read it. */
  reader: string;
  /** Qualified id of the read-model. */
  readModel: string;
  /** The symbol searched for. */
  symbol: string;
}

export interface ReadModelReadReport {
  /** Reader/read-model pairs examined. */
  checked: number;
  issues: ReadModelReadIssue[];
  /** Readers whose pointers matched no readable file. */
  unsearchable: string[];
}

/** The symbols a read-model's pointers name, the last dotted segment of each. */
function symbolsOf(node: GraphNode): string[] {
  const symbols = new Set<string>();
  for (const { pointer } of pointersOf(node)) {
    const hash = pointer.indexOf('#');
    if (hash === -1) continue;
    const symbol = pointer.slice(hash + 1).split('.').pop()!.trim();
    if (symbol.length > 0) symbols.add(symbol);
  }
  return [...symbols];
}

function namesSymbol(files: string[], symbol: string): boolean {
  const word = new RegExp(`(^|[^A-Za-z0-9_])${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_])`);
  return files.some(f => {
    try {
      return word.test(readFileSync(f, 'utf-8'));
    } catch {
      return false;
    }
  });
}

export function verifyReadModelReads(graph: EventGraph, sourceRoot: string): ReadModelReadReport {
  const issues: ReadModelReadIssue[] = [];
  const unsearchable: string[] = [];
  let checked = 0;
  let allFiles: string[] | undefined;

  for (const edge of graph.getAllEdges().filter(e => e.type === 'reads')) {
    const readModel = graph.getNode(edge.to);
    const reader = graph.getNode(edge.from);
    if (!readModel || !reader || readModel.type !== 'read-model') continue;
    const symbols = symbolsOf(readModel);
    if (symbols.length === 0 || pointersOf(reader).length === 0) continue;

    const readerId = qualifiedId(reader.context, reader.id);
    const own = sourceFilesOf(reader, sourceRoot);
    if (own.length === 0) {
      if (!unsearchable.includes(readerId)) unsearchable.push(readerId);
      continue;
    }

    checked++;
    if (symbols.some(s => namesSymbol(own, s))) continue;
    allFiles ??= sourceFilesUnder(sourceRoot);
    const near = referencedBy(own, allFiles);
    if (symbols.some(s => namesSymbol(near, s))) continue;

    issues.push({ reader: readerId, readModel: qualifiedId(readModel.context, readModel.id), symbol: symbols.join(' | ') });
  }

  return { checked, issues, unsearchable };
}
