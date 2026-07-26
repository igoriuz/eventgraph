import type { ContextModel } from '../schema.js';
import { extractAggregates } from './aggregates.js';
import { extractEndpoints, extractScreens } from './surfaces.js';
import { IdSet, type ScaffoldSource } from './sources.js';

export { collectSources, type ScaffoldSource } from './sources.js';

export type Extractor = 'endpoints' | 'screens' | 'aggregates';
export const EXTRACTORS: Extractor[] = ['endpoints', 'screens', 'aggregates'];

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
  const counts: Record<Extractor, number> = { endpoints: 0, screens: 0, aggregates: 0 };
  const model: ContextModel = { context, nodes: [], edges: [] };

  // Screens first: their ids read better unqualified, and endpoints fall back
  // to a method-prefixed id when one is already taken.
  if (only.includes('screens')) {
    const screens = extractScreens(sources, ids);
    model.nodes.push(...screens.nodes);
    model.edges.push(...screens.edges);
    notes.push(...screens.notes);
    counts.screens = screens.nodes.length;
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

  return { model, notes, counts };
}
