import { defineRule, finding, flag, sources, targets } from './kit.js';

/**
 * Services are the systems a core calls out to: an HTTP API, a payment
 * provider, the OS calendar. They sit in their own file because they are one
 * idea — calling out is where a flow most often fails without anyone modelling
 * it — though both rules run in the structure lane.
 */

defineRule(
  {
    id: 'service-call-unhandled',
    severity: 'warn',
    lane: 'structure',
    about:
      'A call to another system can fail for reasons the core does not control — a timeout, a refusal, a changed contract. A command that calls a service and models only the happy path leaves that failure to whatever the code happens to do, which is usually to drop it or show a generic error. Producing a failure event, or naming the codes it answers with in rejects, puts the failure where the rest of the model can route it to someone who sees it.',
  },
  (g, self) =>
    g
      .getNodesByType('command')
      .filter(c => targets(g, c, 'calls').some(s => s.type === 'service'))
      .filter(c => !targets(g, c, 'produces').some(e => flag(e, 'failure') === true))
      .filter(c => {
        const rejects = flag<unknown[]>(c, 'rejects');
        return !(Array.isArray(rejects) && rejects.length > 0);
      })
      // A decision may accept the loss explicitly, as with headless senders.
      .filter(c => sources(g, c, 'affects', 'decision').length === 0)
      .map(c =>
        finding(
          self,
          c,
          'calls a service but models no way for the call to fail',
          'Produce an event with data.failure for a failed call, list the codes in data.rejects, or point a decision at it with affects to accept the loss.'
        )
      )
);

defineRule(
  {
    id: 'service-unused',
    severity: 'warn',
    lane: 'structure',
    about:
      'A service nothing calls is either left over from a flow that changed or a dependency nobody has wired in yet. Either way the model claims a reliance it does not show, and impact on that service reports nothing.',
  },
  (g, self) =>
    g
      .getNodesByType('service')
      .filter(s => sources(g, s, 'calls').length === 0)
      .map(s => finding(self, s, 'no command calls this service', 'Add a calls edge from the command that uses it, or delete it.'))
);
