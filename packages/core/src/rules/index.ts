import type { EventGraph } from '../graph.js';
import type { PresetDefinition } from '../schema.js';
import { allRules, getRule, type Finding, type Lane, type Rule } from './kit.js';

// Registering the rule modules is a side effect of importing them.
import './structure.js';
import './ux.js';
import './platform.js';

export { allRules, getRule } from './kit.js';
export type { Finding, Lane, Rule, Severity } from './kit.js';

export interface CheckOptions {
  /** Restrict to one lane. */
  lane?: Lane;
}

/**
 * Runs the completeness rules a preset enables.
 *
 * A preset with no `rules` key gets nothing: rules like "this event has no
 * consumer" only mean something once the preset fixes what an event is, so a
 * generic graph can only be checked for shape, never for completeness.
 */
export function checkGraph(graph: EventGraph, preset: PresetDefinition, options: CheckOptions = {}): Finding[] {
  const enabled = resolveRules(preset);
  const active = options.lane ? enabled.filter(r => r.lane === options.lane) : enabled;

  return active.flatMap(rule => rule.check(graph)).sort(byUrgency(graph));
}

/** Lower sorts first. Bootstrap gaps block everything else by definition. */
const LANE_RANK: Record<Lane, number> = { bootstrap: 0, structure: 1, ux: 2, platform: 3 };

/**
 * Orders findings by what is worth fixing first, which is what makes `next`
 * more than "the alphabetically first problem".
 *
 * Lane first: with no actor or aggregate, every other rule is guessing. Then
 * severity. Then how connected the node is — a gap in something twenty nodes
 * depend on is worth more than one in a leaf. Node id last, purely so repeated
 * runs return the same order.
 */
function byUrgency(graph: EventGraph): (a: Finding, b: Finding) => number {
  const degree = (id: string) =>
    graph.getIncomingEdges(id).length + graph.getOutgoingEdges(id).length;

  return (a, b) =>
    LANE_RANK[a.lane] - LANE_RANK[b.lane] ||
    (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1) ||
    degree(b.node) - degree(a.node) ||
    a.node.localeCompare(b.node);
}

/** The rules a preset enables, ignoring ids that do not exist. */
export function resolveRules(preset: PresetDefinition): Rule[] {
  if (!preset.rules?.length) return [];
  return preset.rules.map(id => getRule(id)).filter((r): r is Rule => r !== undefined);
}

/** Rule ids a preset names that no rule implements — a preset typo check. */
export function unknownRuleIds(preset: PresetDefinition): string[] {
  return (preset.rules ?? []).filter(id => !getRule(id));
}

/** Every registered rule, for `eventgraph rules`. */
export function ruleCatalog(): Rule[] {
  return allRules().sort((a, b) => a.lane.localeCompare(b.lane) || a.id.localeCompare(b.id));
}
