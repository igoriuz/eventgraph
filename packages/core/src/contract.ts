import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { EventGraph } from './graph.js';
import type { GraphNode } from './schema.js';
import { qualifiedId } from './schema.js';
import { pointerPath, pointersOf } from './verify.js';

/**
 * Checks that whoever issues a command knows the ways it can refuse.
 *
 * A rejection code is a contract with two ends in two codebases: the service
 * throws it, the caller has to recognise it. Nothing inside either repository
 * can see both, so the service adds a code, every test still passes, and the
 * caller silently treats it as unknown. The model is the only place that holds
 * both ends — the command's `rejects` on one side, the actor's `implemented_by`
 * on the other — so this is the check that becomes possible once the graph
 * exists, and stays impossible without it.
 *
 * Matching is a substring search, deliberately. Codes are shouty constants and
 * a parser per language is not worth owning; the failure being caught is a code
 * that appears nowhere at all, which no amount of parsing precision changes. A
 * code found only in a comment counts as handled, and that is the honest limit.
 */

/** Files worth searching for a constant. Broad, because callers are polyglot. */
const SOURCE_EXT =
  /\.(cs|lua|tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|kts|swift|rb|php|dart|scala|ex|exs|c|cc|cpp|h|hpp|m|mm|sh|sql|yaml|yml|json|toml)$/i;

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'bin',
  'obj',
  'target',
  'coverage',
  'vendor',
  '.next',
  '.expo',
]);

/** Anything larger is a bundle or a fixture, not code someone wrote. */
const MAX_BYTES = 2_000_000;

export interface ContractIssue {
  /** Qualified id of the actor expected to recognise the code. */
  actor: string;
  /** Qualified id of the command that can answer with it. */
  command: string;
  code: string;
}

export interface ContractReport {
  /** Actor/code pairs examined. */
  checked: number;
  /** Actors carrying both an implemented_by and a command that rejects. */
  actors: number;
  issues: ContractIssue[];
  /** Actors whose pointers matched no readable file, so nothing was searched. */
  unsearchable: string[];
}

/** Every readable source file under a pointer, which may be a file or a tree. */
function filesUnder(root: string, into: string[]): void {
  let stats;
  try {
    stats = statSync(root);
  } catch {
    return;
  }

  if (stats.isFile()) {
    if (stats.size <= MAX_BYTES) into.push(root);
    return;
  }
  if (!stats.isDirectory()) return;

  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(root, entry);
    let entryStats;
    try {
      entryStats = statSync(full);
    } catch {
      continue;
    }
    if (entryStats.isDirectory()) filesUnder(full, into);
    else if (SOURCE_EXT.test(entry) && entryStats.size <= MAX_BYTES) into.push(full);
  }
}

/** The rejection codes declared on a command, if any. */
function rejectsOf(node: GraphNode): string[] {
  const raw = node.data?.rejects;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === 'string' && c.length > 0);
}

/**
 * Which commands an actor issues, directly or through a policy it sets off.
 *
 * Only the direct edge is followed. A policy runs on the server, so its
 * rejections are not the caller's to recognise.
 */
function commandsIssuedBy(graph: EventGraph, actor: GraphNode): GraphNode[] {
  return graph
    .getOutgoingEdges(qualifiedId(actor.context, actor.id))
    .filter(e => e.type === 'issues')
    .map(e => graph.getNode(e.to))
    .filter((n): n is GraphNode => n !== undefined && n.type === 'command');
}

export function verifyRejectionHandling(graph: EventGraph, sourceRoot: string): ContractReport {
  const issues: ContractIssue[] = [];
  const unsearchable: string[] = [];
  let checked = 0;
  let actors = 0;

  for (const actor of graph.getNodesByType('actor')) {
    const actorId = qualifiedId(actor.context, actor.id);
    const pointers = pointersOf(actor);
    if (pointers.length === 0) continue;

    // Which codes this actor could be answered with, and by what.
    const expected = new Map<string, string>();
    for (const command of commandsIssuedBy(graph, actor)) {
      const commandId = qualifiedId(command.context, command.id);
      for (const code of rejectsOf(command)) {
        if (!expected.has(code)) expected.set(code, commandId);
      }
    }
    if (expected.size === 0) continue;
    actors++;

    const files: string[] = [];
    for (const { pointer } of pointers) {
      const path = pointerPath(pointer);
      if (path.length === 0) continue;
      filesUnder(isAbsolute(path) ? path : join(sourceRoot, path), files);
    }

    if (files.length === 0) {
      unsearchable.push(actorId);
      continue;
    }

    // One pass over the actor's code, rather than one per code.
    const seen = new Set<string>();
    for (const file of files) {
      let content: string;
      try {
        content = readFileSync(file, 'utf-8');
      } catch {
        continue;
      }
      for (const code of expected.keys()) {
        if (!seen.has(code) && content.includes(code)) seen.add(code);
      }
      if (seen.size === expected.size) break;
    }

    for (const [code, command] of expected) {
      checked++;
      if (!seen.has(code)) issues.push({ actor: actorId, command, code });
    }
  }

  return { checked, actors, issues, unsearchable };
}
