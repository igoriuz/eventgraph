import type { EventGraph } from './graph.js';
import type { GraphNode } from './schema.js';
import { qualifiedId } from './schema.js';
import { kindOf, targets } from './rules/kit.js';
import { foundIn, sourceFilesOf } from './source-search.js';
import { pointersOf } from './verify.js';

/**
 * Checks that a CLI subcommand the model says offers a command actually names it.
 *
 * The parity lane trusts the model: once a `cli` surface `offers` a command,
 * the command counts as reachable without a UI. Nothing stops the model from
 * claiming a subcommand that was never written, and an agent told "use the CLI"
 * then finds no such thing. The convention that makes this checkable in every
 * language: a subcommand states its name as a literal equal to the command id,
 * so the id must occur in the surface's own source.
 */

export interface CliOfferIssue {
  /** Qualified id of the `cli` surface. */
  surface: string;
  /** Qualified id of the command it claims to offer. */
  command: string;
  /** The name searched for: the command's id without its context. */
  name: string;
}

export interface CliOfferReport {
  /** Surface/command pairs examined. */
  checked: number;
  issues: CliOfferIssue[];
  /** CLI surfaces whose pointers matched no readable file. */
  unsearchable: string[];
}

export function verifyCliOffers(graph: EventGraph, sourceRoot: string): CliOfferReport {
  const issues: CliOfferIssue[] = [];
  const unsearchable: string[] = [];
  let checked = 0;

  for (const surface of graph.getNodesByType('screen')) {
    if (kindOf(surface) !== 'cli' || pointersOf(surface).length === 0) continue;
    const offered = targets(graph, surface, 'offers').filter((c: GraphNode) => c.type === 'command');
    if (offered.length === 0) continue;

    const surfaceId = qualifiedId(surface.context, surface.id);
    const files = sourceFilesOf(surface, sourceRoot);
    if (files.length === 0) {
      unsearchable.push(surfaceId);
      continue;
    }

    const seen = foundIn(files, offered.map(c => c.id));
    for (const command of offered) {
      checked++;
      if (!seen.has(command.id)) {
        issues.push({ surface: surfaceId, command: qualifiedId(command.context, command.id), name: command.id });
      }
    }
  }

  return { checked, issues, unsearchable };
}
