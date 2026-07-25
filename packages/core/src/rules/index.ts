import type { EventGraph } from '../graph.js';
import type { PresetDefinition } from '../schema.js';
import { allRules, getRule, type Finding, type Lane, type Rule } from './kit.js';

// Registering the rule modules is a side effect of importing them.
import './structure.js';
import './ux.js';

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
  const weight = (f: Finding) => (f.severity === 'error' ? 0 : 1);

  return active
    .flatMap(rule => rule.check(graph))
    .sort((a, b) => weight(a) - weight(b) || a.node.localeCompare(b.node));
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
