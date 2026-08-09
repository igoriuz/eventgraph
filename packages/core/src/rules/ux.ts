import type { EventGraph } from '../graph.js';
import type { GraphNode } from '../schema.js';
import {
  defineRule,
  finding,
  flag,
  hasFlag,
  idOf,
  isNavigable,
  issuedOnlyHeadlessly,
  kindOf,
  OBSERVABLE_KINDS,
  sources,
  targets,
} from './kit.js';

/**
 * Structural UX rules. Nothing here is about visual design, copy or layout —
 * those are not graph problems. These find flows that are broken in a way no
 * single screen reveals, because each screen looks fine on its own.
 */

const BURIED_DEPTH = 3;

/** Navigable screens reachable from an entry screen, mapped to hop count. */
function reachable(graph: EventGraph): Map<string, number> {
  const depths = new Map<string, number>();
  const queue: GraphNode[] = [];
  for (const s of graph.getNodesByType('screen')) {
    if (flag(s, 'entry') === true && isNavigable(s)) {
      depths.set(idOf(s), 0);
      queue.push(s);
    }
  }
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of targets(graph, current, 'navigates-to')) {
      if (depths.has(idOf(next))) continue;
      depths.set(idOf(next), depths.get(idOf(current))! + 1);
      queue.push(next);
    }
  }
  return depths;
}

/**
 * Read-models a command's outcome can reach, following policy chains.
 *
 * Feedback often only becomes visible after a policy turns the command's event
 * into another command. Following just the direct events reports gaps that are
 * not real — which is exactly what PhotoLibCleaner's delete flow showed.
 */
function reachableReadModels(graph: EventGraph, start: GraphNode): Set<string> {
  const readModels = new Set<string>();
  const seen = new Set([idOf(start)]);
  const queue: GraphNode[] = [start];

  while (queue.length) {
    const command = queue.shift()!;
    for (const event of targets(graph, command, 'produces')) {
      for (const rm of targets(graph, event, 'projects-to')) readModels.add(idOf(rm));

      for (const policy of targets(graph, event, 'triggers')) {
        for (const next of targets(graph, policy, 'invokes')) {
          if (seen.has(idOf(next))) continue;
          seen.add(idOf(next));
          queue.push(next);
        }
      }
    }
  }
  return readModels;
}

defineRule(
  {
    id: 'command-no-feedback',
    severity: 'error',
    lane: 'ux',
    about:
      'The user does something and never learns whether it worked. Every screen looks fine on its own, which is why reviews miss it. Followed transitively through policy chains, and satisfied by notifications as well as screens.',
  },
  (g, self) => {
    const depths = reachable(g);
    const anyEntry = depths.size > 0;

    return g
      .getNodesByType('command')
      .filter(c => sources(g, c, 'issues', 'actor').length > 0)
      .filter(c => targets(g, c, 'produces').length > 0)
      // A command whose every outcome is deliberately unobserved is not a bug.
      .filter(c => !targets(g, c, 'produces').every(e => hasFlag(e, 'terminal')))
      // Nor is one only ever issued by something with nothing to look at.
      // headless-rejection-lost asks the question that does apply there.
      .filter(c => !issuedOnlyHeadlessly(g, c))
      .filter(command => {
        const audience = new Set(sources(g, command, 'issues', 'actor').map(idOf));
        for (const rmId of reachableReadModels(g, command)) {
          const rm = g.getNode(rmId);
          if (!rm) continue;
          for (const surface of sources(g, rm, 'reads', 'screen')) {
            // A consumer or a job runs unattended, so routing an outcome there
            // is not feedback — nobody is on the other end of it.
            if (!OBSERVABLE_KINDS.includes(kindOf(surface))) continue;
            // Notifications, widgets and endpoint responses arrive unprompted,
            // so navigability says nothing about whether they will be seen.
            if (isNavigable(surface) && anyEntry && !depths.has(idOf(surface))) continue;
            const seenBy = sources(g, surface, 'sees', 'actor').map(idOf);
            if (seenBy.length === 0 || seenBy.some(a => audience.has(a))) return false;
          }
        }
        return true;
      })
      .map(c =>
        finding(
          self,
          c,
          'the issuing actor cannot observe this command’s outcome',
          'Project one of its events into a read-model shown on a surface this actor reaches, or mark the events terminal.'
        )
      );
  }
);

defineRule(
  {
    id: 'headless-rejection-lost',
    severity: 'error',
    lane: 'ux',
    about:
      'A sensor or scheduler cannot notice a refusal — it has no screen to show one on. So a command it issues that an invariant may reject needs somewhere for that rejection to go: a retry on the sender, or a decision saying the loss is accepted. Without either, the refused call is data that silently never arrives, and the first sign of it is a reader noticing the state is wrong.',
  },
  (g, self) =>
    g
      .getNodesByType('command')
      .filter(c => issuedOnlyHeadlessly(g, c))
      // Only a command that can actually be refused can lose a refusal.
      .filter(c => targets(g, c, 'enforces').length > 0)
      .filter(c => {
        // Either the command or its sender may carry the answer.
        if (hasFlag(c, 'retried')) return false;
        if (sources(g, c, 'issues', 'actor').some(a => hasFlag(a, 'retried'))) return false;
        // Or a decision may own the trade-off explicitly.
        return sources(g, c, 'affects', 'decision').length === 0;
      })
      .map(c =>
        finding(
          self,
          c,
          'a rejection here is invisible to the sender and lost',
          'Set data.retried on the command or its actor if the sender retries, or point a decision at it with affects to accept the loss.'
        )
      )
);

defineRule(
  {
    id: 'unreadable-state',
    severity: 'error',
    lane: 'ux',
    about:
      'State whose store no reader may open. Not "nothing reads it yet" — nothing *can*, because visibility is refused at the store: a table without a public flag, a collection with no read rule, a private field. Both halves get built and tested and neither is wrong on its own; the writer works, the display works, and the display is empty forever. Set data.subscribable to false wherever that is known, and this finds the events written into it that were meant to be seen.',
  },
  (g, self) =>
    g
      .getNodesByType('aggregate')
      .filter(a => flag(a, 'subscribable') === false)
      .flatMap(aggregate =>
        sources(g, aggregate, 'belongs-to', 'event')
          // An event nobody was meant to see is not the problem here.
          .filter(e => !hasFlag(e, 'terminal'))
          .map(event =>
            finding(
              self,
              event,
              `written into "${aggregate.label}", which no reader may subscribe to`,
              'Make the store readable, mark the event terminal with a reason, or drop the write.'
            )
          )
      )
);

defineRule(
  {
    id: 'screen-unreachable',
    severity: 'error',
    lane: 'ux',
    about: 'No path of navigations leads here from any entry screen, so the user can never arrive.',
  },
  (g, self) => {
    const screens = g.getNodesByType('screen').filter(isNavigable);
    if (!screens.some(s => flag(s, 'entry') === true)) return [];
    const depths = reachable(g);
    return screens
      .filter(s => !depths.has(idOf(s)))
      .map(s =>
        finding(self, s, 'no navigation path leads here from an entry screen', 'Add a navigates-to edge, or set data.entry.')
      );
  }
);

defineRule(
  {
    id: 'no-entry-screen',
    severity: 'error',
    lane: 'ux',
    about: 'Without an entry point there is nothing to measure reachability from.',
  },
  (g, self) => {
    const screens = g.getNodesByType('screen').filter(isNavigable);
    if (screens.length === 0 || screens.some(s => flag(s, 'entry') === true)) return [];
    return [
      finding(self, screens[0]!, 'no screen is marked as an entry point', 'Set data.entry on whichever screen the app opens on.'),
    ];
  }
);

defineRule(
  {
    id: 'screen-dead-end',
    severity: 'warn',
    lane: 'ux',
    about: 'A screen the user can only leave by going back. Fine for a detail view, suspicious otherwise.',
  },
  (g, self) =>
    g
      .getNodesByType('screen')
      .filter(isNavigable)
      .filter(s => !hasFlag(s, 'detail'))
      .filter(
        s =>
          targets(g, s, 'navigates-to').length === 0 &&
          targets(g, s, 'offers').length === 0 &&
          targets(g, s, 'reads').length > 0
      )
      .map(s =>
        finding(self, s, 'screen offers no action and no way forward', 'Add offers or navigates-to, or set data.detail.')
      )
);

defineRule(
  {
    id: 'command-buried',
    severity: 'warn',
    lane: 'ux',
    about: `A command only reachable after more than ${BURIED_DEPTH} navigations is effectively hidden.`,
  },
  (g, self) => {
    const depths = reachable(g);
    if (depths.size === 0) return [];
    return g
      .getNodesByType('command')
      .map(command => {
        const hops = sources(g, command, 'offers', 'screen')
          .map(s => depths.get(idOf(s)))
          .filter((d): d is number => d !== undefined);
        return { command, depth: hops.length ? Math.min(...hops) : undefined };
      })
      .filter(x => x.depth !== undefined && x.depth > BURIED_DEPTH)
      .map(x => finding(self, x.command, `only reachable ${x.depth} navigations deep`, 'Surface it earlier, or accept the depth.'));
  }
);

defineRule(
  {
    id: 'actor-cannot-issue',
    severity: 'error',
    lane: 'ux',
    about: 'A screen offers an actor a command they may not issue — the button is there, the permission is not.',
  },
  (g, self) =>
    g.getNodesByType('screen').flatMap(screen => {
      const audience = sources(g, screen, 'sees', 'actor').map(idOf);
      if (audience.length === 0) return [];
      return targets(g, screen, 'offers')
        .map(command => ({ command, allowed: sources(g, command, 'issues', 'actor').map(idOf) }))
        .filter(x => x.allowed.length > 0 && !x.allowed.some(a => audience.includes(a)))
        .map(x =>
          finding(
            self,
            screen,
            `offers "${x.command.label}" to an actor who may not issue it`,
            'Align the actors, or move the command to a surface for the right audience.'
          )
        );
    })
);
