import type { EventGraph } from '../graph.js';
import { BACKEND_KINDS, defineRule, finding, flag, hasFlag, idOf, kindOf, sources, targets } from './kit.js';

/**
 * Completeness rules for a model that describes a backend.
 *
 * The core vocabulary is already backend vocabulary — command, event,
 * aggregate, invariant and policy all come from there. What a backend adds are
 * the questions an app never has to ask: who may call this, what happens on
 * redelivery, what is actually atomic, how stale is this read, and what does
 * rejection look like.
 *
 * The surface kinds these rules key off live in kit.ts, because the UX lane
 * needs the same vocabulary.
 */

/**
 * Every rule here stays silent unless the model actually describes a backend,
 * so enabling the lane cannot start reporting on existing app models.
 */
function isBackend(g: EventGraph): boolean {
  if (g.backend) return true;
  return g.getNodesByType('screen').some(s => BACKEND_KINDS.includes(kindOf(s)));
}

defineRule(
  {
    id: 'endpoint-anonymous',
    severity: 'error',
    lane: 'backend',
    about:
      'An endpoint that names no caller has no stated authorisation. Some endpoints genuinely are public, but that has to be a decision rather than an omission — the two look identical in code and differ only in intent.',
  },
  (g, self) =>
    g
      .getNodesByType('screen')
      .filter(s => kindOf(s) === 'endpoint')
      .filter(s => !hasFlag(s, 'public') && sources(g, s, 'sees', 'actor').length === 0)
      .map(s =>
        finding(
          self,
          s,
          'endpoint names no caller, so who may call it is unstated',
          'Add a sees edge from the actors allowed here, or set data.public to a reason if it is deliberately unauthenticated.'
        )
      )
);

defineRule(
  {
    id: 'policy-not-idempotent',
    severity: 'error',
    lane: 'backend',
    about:
      'Across a real message boundary delivery is at-least-once, so every policy will eventually run twice on the same event. A policy that is not safe to repeat is a double-charge or a duplicate row waiting for a retry to happen.',
  },
  (g, self) => {
    if (!isBackend(g)) return [];
    return g
      .getNodesByType('policy')
      .filter(p => sources(g, p, 'triggers', 'event').length > 0 && targets(g, p, 'invokes').length > 0)
      .filter(p => flag(p, 'idempotent') !== true)
      .map(p =>
        finding(
          self,
          p,
          'reaction is not declared idempotent, but redelivery is guaranteed',
          'Make the invoked command safe to repeat (dedupe key, conditional write) and set data.idempotent.'
        )
      );
  }
);

defineRule(
  {
    id: 'policy-spans-aggregates',
    severity: 'warn',
    lane: 'backend',
    about:
      'One reaction writing to several aggregates cannot be atomic — each write is its own transaction. Partial completion is therefore a state the system will reach, and it needs a compensating path rather than an assumption that it will not happen.',
  },
  (g, self) => {
    if (!isBackend(g)) return [];
    return g
      .getNodesByType('policy')
      .map(policy => ({
        policy,
        aggregates: new Set(
          targets(g, policy, 'invokes').flatMap(c => targets(g, c, 'acts-on').map(idOf))
        ),
      }))
      .filter(x => x.aggregates.size > 1)
      .map(x =>
        finding(
          self,
          x.policy,
          `writes to ${x.aggregates.size} aggregates in one reaction`,
          'Split into one policy per aggregate and model the compensating command for a partial failure, or move the writes behind a single aggregate.'
        )
      );
  }
);

defineRule(
  {
    id: 'read-model-consistency-unstated',
    severity: 'warn',
    lane: 'backend',
    about:
      'A projection fed by events is either read-your-own-write or lagging, and callers are built against whichever the author assumed. Leaving it unsaid is how "I saved it but the list is empty" reaches production.',
  },
  (g, self) => {
    if (!isBackend(g)) return [];
    return g
      .getNodesByType('read-model')
      .filter(rm => sources(g, rm, 'projects-to', 'event').length > 0)
      .filter(rm => !hasFlag(rm, 'consistency'))
      .map(rm =>
        finding(
          self,
          rm,
          'projection does not state whether reads are immediate or eventual',
          'Set data.consistency to immediate if it is written in the same transaction, otherwise eventual.'
        )
      );
  }
);

defineRule(
  {
    id: 'command-no-rejection',
    severity: 'warn',
    lane: 'backend',
    about:
      'A command that upholds an invariant can refuse. If refusal produces no event, the caller is told nothing and the refusal cannot be observed, alerted on, or counted.',
  },
  (g, self) => {
    if (!isBackend(g)) return [];
    return g
      .getNodesByType('command')
      .filter(c => targets(g, c, 'enforces').length > 0)
      .filter(c => !targets(g, c, 'produces').some(e => flag(e, 'failure') === true))
      .map(c =>
        finding(
          self,
          c,
          `enforces ${targets(g, c, 'enforces').length} invariant(s) but models no rejection`,
          'Add the event produced when the invariant refuses the command and set data.failure on it.'
        )
      );
  }
);

defineRule(
  {
    id: 'failure-silenced',
    severity: 'error',
    lane: 'backend',
    about:
      'A rejection marked terminal is a swallowed error. `terminal` says "nothing reacts, deliberately", which is a defensible call for a success and almost never one for a failure — an unobserved refusal cannot be alerted on or counted. An unconsumed failure that is *not* marked terminal is already reported by event-no-consumer, so this rule deliberately covers only what that one lets through.',
  },
  (g, self) => {
    if (!isBackend(g)) return [];
    return g
      .getNodesByType('event')
      .filter(e => flag(e, 'failure') === true && hasFlag(e, 'terminal'))
      .map(e =>
        finding(
          self,
          e,
          'rejection is silenced by terminal, so nothing can observe it',
          'Drop the terminal flag and project it into a read-model the caller sees, or add a policy that retries, compensates or escalates.'
        )
      );
  }
);
