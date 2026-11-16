import type { EventGraph } from './graph.js';
import type { GraphNode } from './schema.js';
import { qualifiedId } from './schema.js';
import { pointersOf } from './verify.js';
import { foundIn, sourceFilesOf } from './source-search.js';
import { HUMAN_KINDS, kindOf } from './rules/kit.js';

/**
 * Checks that whoever issues a command knows the ways it can refuse.
 *
 * A rejection code is a contract with two ends in two codebases: the service
 * throws it, the caller has to recognise it. Nothing inside either repository
 * can see both, so the service adds a code, every test still passes, and the
 * caller silently treats it as unknown. The model is the only place that holds
 * both ends — the command's `rejects` on one side, the caller's `implemented_by`
 * on the other — so this is the check that becomes possible once the graph
 * exists, and stays impossible without it.
 *
 * A caller is an actor that issues the command, or a surface made for a person
 * that offers it. In an app built around a core, the code meeting a refusal is
 * the screen offering the command; a person issuing it has no source. A CLI
 * subcommand, an agent tool or an endpoint passes the code on to whoever called
 * it, so the far end is that caller, not the surface.
 *
 * Matching is a substring search, deliberately. Codes are shouty constants and
 * a parser per language is not worth owning; the failure being caught is a code
 * that appears nowhere at all, which no amount of parsing precision changes. A
 * code found only in a comment counts as handled, and that is the honest limit.
 */

export interface ContractIssue {
  /** Qualified id of the actor or surface expected to recognise the code. */
  caller: string;
  /** Qualified id of the command that can answer with it. */
  command: string;
  code: string;
}

export interface ContractReport {
  /** Caller/code pairs examined. */
  checked: number;
  /** Callers carrying both an implemented_by and a command that rejects. */
  callers: number;
  issues: ContractIssue[];
  /** Callers whose pointers matched no readable file, so nothing was searched. */
  unsearchable: string[];
}

/** The rejection codes declared on a command, if any. */
function rejectsOf(node: GraphNode): string[] {
  const raw = node.data?.rejects;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === 'string' && c.length > 0);
}

/**
 * The commands a caller can meet a refusal from: those an actor issues, or
 * those a surface offers.
 *
 * Only the direct edge is followed. A policy runs inside the core, so its
 * rejections are not the caller's to recognise.
 */
function commandsCalledBy(graph: EventGraph, caller: GraphNode): GraphNode[] {
  const edgeType = caller.type === 'actor' ? 'issues' : 'offers';
  return graph
    .getOutgoingEdges(qualifiedId(caller.context, caller.id))
    .filter(e => e.type === edgeType)
    .map(e => graph.getNode(e.to))
    .filter((n): n is GraphNode => n !== undefined && n.type === 'command');
}

export function verifyRejectionHandling(graph: EventGraph, sourceRoot: string): ContractReport {
  const issues: ContractIssue[] = [];
  const unsearchable: string[] = [];
  let checked = 0;
  let callers = 0;

  const humanSurfaces = graph.getNodesByType('screen').filter(s => HUMAN_KINDS.includes(kindOf(s)));
  for (const caller of [...graph.getNodesByType('actor'), ...humanSurfaces]) {
    const callerId = qualifiedId(caller.context, caller.id);
    if (pointersOf(caller).length === 0) continue;

    // Which codes this caller could be answered with, and by what.
    const expected = new Map<string, string>();
    for (const command of commandsCalledBy(graph, caller)) {
      const commandId = qualifiedId(command.context, command.id);
      for (const code of rejectsOf(command)) {
        if (!expected.has(code)) expected.set(code, commandId);
      }
    }
    if (expected.size === 0) continue;
    callers++;

    const files = sourceFilesOf(caller, sourceRoot);
    if (files.length === 0) {
      unsearchable.push(callerId);
      continue;
    }

    const seen = foundIn(files, expected.keys());

    for (const [code, command] of expected) {
      checked++;
      if (!seen.has(code)) issues.push({ caller: callerId, command, code });
    }
  }

  return { checked, callers, issues, unsearchable };
}
