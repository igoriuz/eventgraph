import type { EventGraph } from './graph.js';
import type { GraphNode } from './schema.js';
import { qualifiedId } from './schema.js';
import { pointersOf } from './verify.js';
import { relative } from 'node:path';
import { foundIn, ignoringCase, referencedBy, sourceFilesOf, sourceFilesUnder } from './source-search.js';
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
 * Matching is a substring search, deliberately, across spellings: a service
 * answers TOO_FAST, a Swift caller handles `.tooFast`, a Kotlin one `TooFast`.
 * A parser per language is not worth owning; the failure being caught is a code
 * that appears nowhere at all, which no amount of parsing precision changes. A
 * code found only in a comment counts as handled, and that is the honest limit.
 */

export interface ContractIssue {
  /** Qualified id of the actor or surface expected to recognise the code. */
  caller: string;
  /** Qualified id of the command that can answer with it. */
  command: string;
  code: string;
  /**
   * Files outside the caller's source that name the code, relative to the
   * source root, closest to the caller first. Absent when there are none.
   */
  foundElsewhere?: string[];
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

    const seen = foundIn(files, expected.keys(), ignoringCase);

    for (const [code, command] of expected) {
      checked++;
      if (!seen.has(code)) issues.push({ caller: callerId, command, code });
    }
  }

  addWhereElseFound(graph, issues, sourceRoot);
  return { checked, callers, issues, unsearchable };
}

/** How many files a hint names; past that it stops pointing anywhere. */
const HINT_LIMIT = 3;

/** Configuration and data name codes without handling them. */
const NOT_HANDLING_EXT = /\.(ya?ml|json|toml)$/i;

/** Tests name every code they provoke; they handle none of them. */
const TEST_PATH = /(^|[\\/])(tests?|__tests__|spec|specs|test_driver|integration_test)[\\/]|[._-](test|spec)\.\w+$|Tests?\.\w+$/;

/**
 * Where a code the caller misses is named instead.
 *
 * The usual cause of an unhandled code is not a missing branch but a model
 * that points at too few files: the refusal is met in a helper the screen
 * calls, or in one shared handler every screen sends through. Naming that file
 * turns the finding into a one-line fix of `implemented_by`.
 *
 * Only files the caller's own source refers to are candidates — one hop. A
 * whole-tree search drowns a common code such as REFUSED in unrelated hits. The
 * side that throws the code is left out (the source of every node that is not
 * a caller), as are tests and configuration. What remains is a hint, not a
 * verdict: a code named there may still be ignored.
 */
function addWhereElseFound(graph: EventGraph, issues: ContractIssue[], sourceRoot: string): void {
  if (issues.length === 0) return;

  const callers = new Map<string, GraphNode>();
  const excluded = new Set<string>();
  for (const node of graph.getAllNodes()) {
    if (isCaller(node)) callers.set(qualifiedId(node.context, node.id), node);
    else for (const f of sourceFilesOf(node, sourceRoot)) excluded.add(f);
  }

  const candidates = sourceFilesUnder(sourceRoot).filter(
    f => !excluded.has(f) && !NOT_HANDLING_EXT.test(f) && !TEST_PATH.test(relative(sourceRoot, f))
  );

  const byCaller = new Map<string, ContractIssue[]>();
  for (const issue of issues) byCaller.set(issue.caller, [...(byCaller.get(issue.caller) ?? []), issue]);

  for (const [callerId, missing] of byCaller) {
    const near = referencedBy(sourceFilesOf(callers.get(callerId)!, sourceRoot), candidates);
    const filesByCode = new Map(missing.map(i => [i.code, [] as string[]]));
    for (const f of near) {
      for (const code of foundIn([f], filesByCode.keys(), ignoringCase)) filesByCode.get(code)!.push(f);
    }
    for (const issue of missing) {
      const found = filesByCode.get(issue.code)!;
      if (found.length > 0) issue.foundElsewhere = found.sort().slice(0, HINT_LIMIT).map(f => relative(sourceRoot, f));
    }
  }
}

function isCaller(node: GraphNode): boolean {
  return node.type === 'actor' || (node.type === 'screen' && HUMAN_KINDS.includes(kindOf(node)));
}
