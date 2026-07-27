import { defineRule, finding, flag, hasFlag, sources, targets, GRAPH } from './kit.js';

/**
 * Bootstrap and structural completeness rules.
 *
 * Each of these came out of modelling real applications, not from the pattern
 * on paper. The opt-out flags (`terminal`, `transient`, `immortal`, …) exist
 * because a rule that cannot be told "yes, deliberately" becomes noise.
 */

// --- bootstrap: an empty graph must not report "nothing to do" -------------

defineRule(
  {
    id: 'graph-empty',
    severity: 'error',
    lane: 'bootstrap',
    about:
      'An empty graph is not a finished one. This is the entry point of the plan-forward loop: it names the first two things to write down.',
  },
  (g, self) =>
    g.getAllNodes().length > 0
      ? []
      : [
          finding(
            self,
            GRAPH,
            'the graph is empty',
            'Start with who uses this (an actor) and the one thing whose state matters most (an aggregate).'
          ),
        ]
);

defineRule(
  { id: 'no-actor', severity: 'error', lane: 'bootstrap', about: 'Nothing has a beneficiary until somebody is named.' },
  (g, self) =>
    g.getAllNodes().length === 0 || g.getNodesByType('actor').length > 0
      ? []
      : [finding(self, GRAPH, 'no actor is defined', 'Add an actor for whoever uses this. One is enough to start.')]
);

defineRule(
  {
    id: 'no-aggregate',
    severity: 'error',
    lane: 'bootstrap',
    about: 'Without an aggregate there is no state, so commands change nothing and events belong nowhere.',
  },
  (g, self) =>
    g.getAllNodes().length === 0 || g.getNodesByType('aggregate').length > 0
      ? []
      : [finding(self, GRAPH, 'no aggregate is defined', 'Add the thing whose state the app exists to change.')]
);

// --- events ----------------------------------------------------------------

defineRule(
  {
    id: 'event-no-consumer',
    severity: 'error',
    lane: 'structure',
    about:
      'A fact nobody reacts to is dead weight. Either something projects it, a policy acts on it, or it is explicitly terminal.',
  },
  (g, self) =>
    g
      .getNodesByType('event')
      .filter(e => !hasFlag(e, 'terminal'))
      .filter(e => targets(g, e, 'projects-to').length === 0 && targets(g, e, 'triggers').length === 0)
      // When the store itself refuses readers, unreadable-state says so and
      // says why. Reporting both puts the vaguer diagnosis next to the exact
      // one on the same node, and the reader has to work out they are one
      // problem.
      .filter(e => !targets(g, e, 'belongs-to').some(a => flag(a, 'subscribable') === false))
      .map(e =>
        finding(
          self,
          e,
          'no read-model or policy consumes this event',
          'Add a projects-to edge to a read-model, a triggers edge to a policy, or set data.terminal to a reason.'
        )
      )
);

defineRule(
  {
    id: 'event-uncaused',
    severity: 'error',
    lane: 'structure',
    about: 'Facts do not appear on their own — some command must produce them.',
  },
  (g, self) =>
    g
      .getNodesByType('event')
      .filter(e => sources(g, e, 'produces', 'command').length === 0)
      .map(e =>
        finding(self, e, 'no command produces this event', 'Add a produces edge from the command that causes it.')
      )
);

defineRule(
  {
    id: 'event-orphan',
    severity: 'warn',
    lane: 'structure',
    about: 'An event belonging to no aggregate has no owner of its consistency.',
  },
  (g, self) =>
    g
      .getNodesByType('event')
      .filter(e => !hasFlag(e, 'transient') && targets(g, e, 'belongs-to').length === 0)
      .map(e =>
        finding(
          self,
          e,
          'event belongs to no aggregate',
          'Add a belongs-to edge, or set data.transient to a reason if no state survives it.'
        )
      )
);

// --- read models and screens ----------------------------------------------

defineRule(
  {
    id: 'read-model-unused',
    severity: 'error',
    lane: 'structure',
    about: 'A projection no screen shows and no policy uses is work nobody asked for.',
  },
  (g, self) =>
    g
      .getNodesByType('read-model')
      .filter(rm => sources(g, rm, 'reads').length === 0)
      .map(rm => finding(self, rm, 'nothing reads this read-model', 'Add a reads edge from a screen or policy, or delete it.'))
);

defineRule(
  {
    id: 'screen-empty',
    severity: 'error',
    lane: 'structure',
    about: 'A screen that shows nothing and does nothing is a placeholder, not a design.',
  },
  (g, self) =>
    g
      .getNodesByType('screen')
      .filter(s => targets(g, s, 'reads').length === 0 && targets(g, s, 'offers').length === 0)
      .map(s => finding(self, s, 'screen neither reads nor offers anything', 'Add a reads or offers edge.'))
);

// --- commands and policies -------------------------------------------------

defineRule(
  {
    id: 'command-no-actor',
    severity: 'error',
    lane: 'structure',
    about: 'Every command needs an origin: an actor, a policy, a screen — or a named non-human trigger.',
  },
  (g, self) =>
    g
      .getNodesByType('command')
      .filter(
        c =>
          !hasFlag(c, 'triggered_by') &&
          sources(g, c, 'issues', 'actor').length === 0 &&
          sources(g, c, 'invokes', 'policy').length === 0 &&
          sources(g, c, 'offers', 'screen').length === 0
      )
      .map(c =>
        finding(
          self,
          c,
          'nothing issues this command',
          'Add an issues/invokes/offers edge, or set data.triggered_by for schedules and on-appear loads.'
        )
      )
);

defineRule(
  {
    id: 'command-no-effect',
    severity: 'error',
    lane: 'structure',
    about: 'A command producing no event changes nothing observable.',
  },
  (g, self) =>
    g
      .getNodesByType('command')
      .filter(c => !hasFlag(c, 'external') && targets(g, c, 'produces').length === 0)
      .map(c =>
        finding(
          self,
          c,
          'command produces no event',
          'Add a produces edge, or set data.external to a reason if it hands off to a system surface.'
        )
      )
);

defineRule(
  {
    id: 'policy-incomplete',
    severity: 'error',
    lane: 'structure',
    about: 'A policy is by definition event-in, command-out. Missing either half makes it inert.',
  },
  (g, self) =>
    g
      .getNodesByType('policy')
      .filter(p => sources(g, p, 'triggers', 'event').length === 0 || targets(g, p, 'invokes').length === 0)
      .map(p =>
        finding(
          self,
          p,
          sources(g, p, 'triggers', 'event').length === 0 ? 'policy reacts to no event' : 'policy invokes no command',
          'Wire both halves: an event triggers it, and it invokes a command.'
        )
      )
);

// --- aggregates and invariants --------------------------------------------

defineRule(
  {
    id: 'aggregate-no-events',
    severity: 'error',
    lane: 'structure',
    about: 'An aggregate with no events has no state changes, so it is data, not an aggregate.',
  },
  (g, self) =>
    g
      .getNodesByType('aggregate')
      .filter(a => sources(g, a, 'belongs-to', 'event').length === 0)
      .map(a => finding(self, a, 'no event belongs to this aggregate', 'Point events at it, or reconsider the type.'))
);

defineRule(
  {
    id: 'aggregate-no-lifecycle-end',
    severity: 'warn',
    lane: 'structure',
    about:
      'Most aggregates need an end state — archived, cancelled, deleted. Missing one usually means the lifecycle was never thought through.',
  },
  (g, self) =>
    g
      .getNodesByType('aggregate')
      .filter(a => !hasFlag(a, 'immortal'))
      .filter(a => !sources(g, a, 'belongs-to', 'event').some(e => flag(e, 'ends_lifecycle') === true))
      .map(a =>
        finding(
          self,
          a,
          'aggregate has no lifecycle end',
          'Model how it ends and set data.ends_lifecycle on that event, or set data.immortal.'
        )
      )
);

defineRule(
  {
    id: 'invariant-unenforced',
    severity: 'error',
    lane: 'structure',
    about: 'An invariant no command upholds is prose, not design.',
  },
  (g, self) =>
    g
      .getNodesByType('invariant')
      .filter(i => sources(g, i, 'enforces', 'command').length === 0)
      .map(i => finding(self, i, 'no command enforces this invariant', 'Add an enforces edge from the responsible command.'))
);

// --- actors and open questions --------------------------------------------

defineRule(
  {
    id: 'actor-idle',
    severity: 'warn',
    lane: 'structure',
    about: 'An actor who issues nothing and sees nothing does not belong in the model.',
  },
  (g, self) =>
    g
      .getNodesByType('actor')
      .filter(a => targets(g, a, 'issues').length === 0 && targets(g, a, 'sees').length === 0)
      .map(a => finding(self, a, 'actor issues no command and sees no screen', 'Wire it up, or remove it.'))
);

defineRule(
  {
    id: 'open-question-blocking',
    severity: 'warn',
    lane: 'structure',
    about: 'Unanswered questions gating other nodes should surface before more design is piled on top of them.',
  },
  (g, self) =>
    g
      .getNodesByType('question')
      .filter(q => flag(q, 'resolved') !== true && targets(g, q, 'blocks').length > 0)
      .map(q =>
        finding(
          self,
          q,
          `open question blocks ${targets(g, q, 'blocks').length} node(s)`,
          'Answer it and set data.resolved, or record the call as a decision.'
        )
      )
);
