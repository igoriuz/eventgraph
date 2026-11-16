import type { EventGraph } from './graph.js';
import type { GraphNode } from './schema.js';
import { qualifiedId } from './schema.js';
import { pointersOf } from './verify.js';
import { foundIn, sourceFilesOf } from './source-search.js';

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

    const files = sourceFilesOf(actor, sourceRoot);
    if (files.length === 0) {
      unsearchable.push(actorId);
      continue;
    }

    const seen = foundIn(files, expected.keys());

    for (const [code, command] of expected) {
      checked++;
      if (!seen.has(code)) issues.push({ actor: actorId, command, code });
    }
  }

  return { checked, actors, issues, unsearchable };
}
