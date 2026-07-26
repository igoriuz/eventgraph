import type { EventGraph } from '../graph.js';
import type { GraphNode } from '../schema.js';
import { defineRule, finding, flag, hasFlag, idOf, isNavigable, kindOf, OBSERVABLE_KINDS, sources, targets } from './kit.js';

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
