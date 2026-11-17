import type { EventGraph } from './graph.js';
import { verifyCliOffers, type CliOfferReport } from './cli-offers.js';
import { verifyRejectionHandling, type ContractReport } from './contract.js';
import { verifyImplementations, type VerifyReport } from './verify.js';
import { verifyReadModelReads, type ReadModelReadReport } from './read-model-reads.js';

/**
 * Every check that holds the model against the code, and the one verdict on
 * them. The CLI and the MCP server both report this, so what makes `verify`
 * fail is decided here and nowhere else.
 */
export interface FullVerifyReport extends VerifyReport {
  /** False when any check found an issue. Undeclared sources and unsearchable callers only warn. */
  ok: boolean;
  contract: ContractReport;
  cli: CliOfferReport;
  reads: ReadModelReadReport;
}

export function verifyAll(graph: EventGraph, sourceRoot: string): FullVerifyReport {
  const pointers = verifyImplementations(graph, sourceRoot);
  const contract = verifyRejectionHandling(graph, sourceRoot);
  const cli = verifyCliOffers(graph, sourceRoot);
  const reads = verifyReadModelReads(graph, sourceRoot);
  const ok = pointers.issues.length + contract.issues.length + cli.issues.length + reads.issues.length === 0;
  return { ok, ...pointers, contract, cli, reads };
}
