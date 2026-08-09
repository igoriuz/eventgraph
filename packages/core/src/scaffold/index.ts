import type { ContextModel } from '../schema.js';
import { extractAggregates } from './aggregates.js';
import { extractDart } from './dart.js';
import { extractReactRouter } from './react-router.js';
import { extractSpacetime } from './spacetime.js';
import { extractEndpoints, extractScreens } from './surfaces.js';
import { IdSet, type ScaffoldSource } from './sources.js';

export { collectSources, type ScaffoldSource } from './sources.js';

export type Extractor = 'endpoints' | 'screens' | 'aggregates' | 'domain';
export const EXTRACTORS: Extractor[] = ['endpoints', 'screens', 'aggregates', 'domain'];

export interface ScaffoldOptions {
  context?: string;
  only?: Extractor[];
}

export interface ScaffoldReport {
  model: ContextModel;
  /** What each extractor found, and what it could not know. */
  notes: string[];
  counts: Record<Extractor, number>;
}

/**
 * Builds a partial model from source.
 *
 * Everything here is mechanically knowable — a route registration, a route
 * file, a table declaration. Commands, events, policies and invariants are
 * deliberately absent: they are the modelling, and a graph that guessed at them
 * would look complete while being wrong. What this removes is the transcription,
 * which was the expensive half.
 */
export function scaffold(sources: ScaffoldSource[], options: ScaffoldOptions = {}): ScaffoldReport {
  const context = options.context ?? 'core';
  const only = options.only ?? EXTRACTORS;
  const ids = new IdSet();

  const notes: string[] = [];
  const counts: Record<Extractor, number> = { endpoints: 0, screens: 0, aggregates: 0, domain: 0 };
  const model: ContextModel = { context, nodes: [], edges: [] };

  /** Routed source file to the screen id it implements, for later extractors. */
  let owner = new Map<string, string>();

  // Screens first: their ids read better unqualified, and endpoints fall back
  // to a method-prefixed id when one is already taken.
  if (only.includes('screens')) {
    const screens = extractScreens(sources, ids);
    model.nodes.push(...screens.nodes);
    model.edges.push(...screens.edges);
    notes.push(...screens.notes);
    counts.screens = screens.nodes.length;

    // A Flutter app declares its routes in a table rather than in the file
    // tree, so nothing above finds them.
    const flutter = extractDart(sources, ids);
    model.nodes.push(...flutter.nodes);
    model.edges.push(...flutter.edges);
    notes.push(...flutter.notes);
    counts.screens += flutter.nodes.length;

    // So does a React app using react-router, which file-routing misses
    // entirely. It runs even when the file tree already yielded screens: an app
    // can be part file-routed and part table-routed, and skipping this pass
    // whenever anything was found dropped that whole half of it. Routes whose
    // component is already a screen are left to the pass that claimed them.
    const claimed = new Set(
      model.nodes.flatMap(n => (n.data?.implemented_by as string[] | undefined) ?? [])
    );
    const router = extractReactRouter(sources, ids, claimed);
    model.nodes.push(...router.nodes);
    model.edges.push(...router.edges);
    notes.push(...router.notes);
    counts.screens += router.nodes.length;
    owner = router.owner;
  }

  if (only.includes('endpoints')) {
    const endpoints = extractEndpoints(sources, ids);
    model.nodes.push(...endpoints.nodes);
    notes.push(...endpoints.notes);
    counts.endpoints = endpoints.nodes.length;
  }

  if (only.includes('aggregates')) {
    const aggregates = extractAggregates(sources, ids);
    model.nodes.push(...aggregates.nodes);
    notes.push(...aggregates.notes);
    counts.aggregates = aggregates.nodes.length;
  }

  // Last: a module that declares its commands and events outright. It reads
  // tables itself, so it runs after the generic table pass rather than through
  // it, and it needs the screens to attach subscriptions to.
  if (only.includes('domain')) {
    const domain = extractSpacetime(sources, ids, { owner });
    model.nodes.push(...domain.nodes);
    model.edges.push(...domain.edges);
    notes.push(...domain.notes);
    counts.domain = domain.nodes.length;
  }

  return { model, notes, counts };
}
