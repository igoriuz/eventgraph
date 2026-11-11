import type { EventGraph } from '../graph.js';
import type { GraphNode } from '../schema.js';
import { defineRule, finding, hasFlag, HEADLESS_KINDS, HUMAN_KINDS, kindOf, sources } from './kit.js';

/**
 * Parity between the human interface and the headless one.
 *
 * An app whose domain sits behind a command and query interface can be driven
 * by an agent or a test as well as by a person — but only for what that
 * interface actually exposes. A command that exists only as a button is
 * invisible to every agent and every test that does not click; a read-model
 * that exists only on a screen lets an agent act and never see what came of
 * it. Neither shows up anywhere else: the UI works, and the headless surface
 * works for everything it has.
 *
 * Endpoints count as headless access, since anything that speaks HTTP can call
 * them, but they do not switch the lane on. Only a declared `cli` or `tool`
 * surface says the model means to be driven without its UI, so a plain
 * client-server app never starts reporting here.
 */

function declaresHeadlessSurface(g: EventGraph): boolean {
  return g.getNodesByType('screen').some(s => kindOf(s) === 'cli' || kindOf(s) === 'tool');
}

/**
 * How many human-facing surfaces reach something no headless surface does —
 * zero when a headless one reaches it too, or when no person does either. A
 * node nothing reaches at all is the structure lane's business, not this one.
 */
function humanOnlyReach(surfaces: GraphNode[]): number {
  if (surfaces.some(s => HEADLESS_KINDS.includes(kindOf(s)))) return 0;
  return surfaces.filter(s => HUMAN_KINDS.includes(kindOf(s))).length;
}

defineRule(
  {
    id: 'command-ui-only',
    severity: 'warn',
    lane: 'headless',
    about:
      'A command a person can issue from a screen but no CLI, tool or endpoint offers. An agent or a test driving the app headlessly cannot reach it, so whatever depends on it is untestable without clicking through the UI. Some commands genuinely belong to the UI — say so with ui_only and a reason.',
  },
  (g, self) => {
    if (!declaresHeadlessSurface(g)) return [];
    return g
      .getNodesByType('command')
      .filter(c => !hasFlag(c, 'ui_only'))
      .map(command => ({ command, human: humanOnlyReach(sources(g, command, 'offers', 'screen')) }))
      .filter(x => x.human > 0)
      .map(x =>
        finding(
          self,
          x.command,
          `offered on ${x.human} human-facing surface(s) but by no cli, tool or endpoint`,
          'Offer it from a cli, tool or endpoint surface so an agent or a test can issue it, or set data.ui_only to a reason.'
        )
      );
  }
);

defineRule(
  {
    id: 'read-model-ui-only',
    severity: 'warn',
    lane: 'headless',
    about:
      'A read-model a person can see but no CLI, tool or endpoint reads. An agent can issue commands and then cannot find out what became of them, which turns every headless run into a guess. Set ui_only with a reason where only a person needs it.',
  },
  (g, self) => {
    if (!declaresHeadlessSurface(g)) return [];
    return g
      .getNodesByType('read-model')
      .filter(rm => !hasFlag(rm, 'ui_only'))
      .map(readModel => ({ readModel, human: humanOnlyReach(sources(g, readModel, 'reads', 'screen')) }))
      .filter(x => x.human > 0)
      .map(x =>
        finding(
          self,
          x.readModel,
          `read by ${x.human} human-facing surface(s) but by no cli, tool or endpoint`,
          'Add a reads edge from a cli, tool or endpoint surface so an agent can see what its commands did, or set data.ui_only to a reason.'
        )
      );
  }
);
