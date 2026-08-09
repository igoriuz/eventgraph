import type { ContextModelNode, GraphEdge } from '../schema.js';
import { blockAt, IdSet, kebab, titleise, type ScaffoldSource } from './sources.js';

/**
 * Reads a React app whose routes live in a table rather than in the file tree.
 *
 * `<Route path="/lobby/:code" element={<LobbyView />} />` is the same shape of
 * problem as Flutter's GoRoute: the route names the path, the element names the
 * component, and the component's own file is what `implemented_by` should point
 * at. The router file describes every screen and implements none of them.
 */

/** `<Route path="/lobby/:code" element={<LobbyView />} />`, attributes in any order. */
const ROUTE_ELEMENT = /<Route\b/g;
const PATH_ATTR = /\bpath\s*=\s*["']([^"']*)["']/;
const ELEMENT_ATTR = /\belement\s*=\s*\{\s*<\s*([A-Z]\w*)/;
const COMPONENT_ATTR = /\bcomponent\s*=\s*\{\s*([A-Z]\w*)/;
/** `{ path: '/x', element: <X /> }` — createBrowserRouter takes objects. */
const ROUTE_OBJECT = /\{\s*path\s*:\s*["']([^"']*)["'][^{]*?element\s*:\s*<\s*([A-Z]\w*)/g;

/** `navigate('/lobby')`, and the template form `navigate(`/lobby/${code}`)`. */
const NAVIGATE = /\bnavigate\s*\(\s*(['"`])([^'"`]*)\1/g;
/** `<Link to="/lobby">` and `<Navigate to="/" />`. */
const LINK_TO = /\bto\s*=\s*(?:["']([^"']+)["']|\{\s*[`'"]([^`'"]+)[`'"])/g;

const IMPORT = /\bimport\s+(?:(\w+)|\{([^}]*)\})\s*(?:,\s*\{([^}]*)\}\s*)?from\s+['"]([^'"]+)['"]/g;

/** How far to follow relative imports when attributing a file to a screen. */
export const IMPORT_DEPTH = 4;

export interface ReactRouterResult {
  nodes: ContextModelNode[];
  edges: GraphEdge[];
  notes: string[];
  /** Route path (`/lobby/:code`) to node id, for resolving navigation. */
  routes: Map<string, string>;
  /** Source file to the screen id it implements. */
  owner: Map<string, string>;
}

const EMPTY = (): ReactRouterResult => ({
  nodes: [],
  edges: [],
  notes: [],
  routes: new Map(),
  owner: new Map(),
});

// --- imports ---------------------------------------------------------------

/** `./pages/Home` from `client/src/App.tsx` → `client/src/pages/Home.tsx`. */
export function resolveImport(from: string, spec: string, files: Set<string>): string | null {
  if (!spec.startsWith('.')) return null;

  const base = from.split('/').slice(0, -1);
  for (const segment of spec.split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') base.pop();
    else base.push(segment);
  }
  const path = base.join('/');

  for (const candidate of [
    path,
    `${path}.tsx`,
    `${path}.ts`,
    `${path}.jsx`,
    `${path}.js`,
    `${path}/index.tsx`,
    `${path}/index.ts`,
  ]) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

/** Local name → file, for every value a file imports relatively. */
export function importedNames(source: ScaffoldSource, files: Set<string>): Map<string, string> {
  const named = new Map<string, string>();

  IMPORT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMPORT.exec(source.content)) !== null) {
    const target = resolveImport(source.path, match[4]!, files);
    if (!target) continue;

    if (match[1]) named.set(match[1], target);
    for (const group of [match[2], match[3]]) {
      if (!group) continue;
      for (const entry of group.split(',')) {
        // `Foo as Bar` binds Bar; the local name is what the JSX will use.
        const local = entry.trim().split(/\s+as\s+/).pop()?.trim();
        if (local) named.set(local, target);
      }
    }
  }
  return named;
}

/**
 * Which screens reach each file through relative imports.
 *
 * Almost nothing interesting sits in the routed file itself — a `navigate()`
 * call, a `useTable` subscription and a command call all live in components and
 * hooks. Crediting each to every screen that imports it is what connects those
 * edges to the screens they actually belong to; without it the whole lane looks
 * empty. The cost is that a component shared by four screens gives its edge to
 * all four, which is why the extractors say so in a note.
 */
export function screenReach(
  sources: ScaffoldSource[],
  owner: Map<string, string>,
  depth = IMPORT_DEPTH
): Map<string, Set<string>> {
  const byPath = new Map(sources.map(s => [s.path, s]));
  const files = new Set(sources.map(s => s.path));
  const reach = new Map<string, Set<string>>();

  for (const [file, screenId] of owner) {
    const seen = new Set<string>([file]);
    let frontier = [file];

    for (let level = 0; level < depth && frontier.length > 0; level++) {
      const next: string[] = [];
      for (const current of frontier) {
        const source = byPath.get(current);
        if (!source) continue;
        for (const target of new Set(importedNames(source, files).values())) {
          if (seen.has(target)) continue;
          seen.add(target);
          next.push(target);
        }
      }
      frontier = next;
    }

    for (const reached of seen) {
      if (!reach.has(reached)) reach.set(reached, new Set());
      reach.get(reached)!.add(screenId);
    }
  }
  return reach;
}

// --- routes ----------------------------------------------------------------

interface ParsedRoute {
  path: string;
  component: string;
}

function parseRoutes(content: string): ParsedRoute[] {
  const routes: ParsedRoute[] = [];

  ROUTE_ELEMENT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ROUTE_ELEMENT.exec(content)) !== null) {
    // A JSX element is not bracket-balanced, so read to the first `>` that is
    // not inside an `element={<X />}` expression — the braces are balanced.
    const tag = jsxTag(content, match.index);
    const path = PATH_ATTR.exec(tag)?.[1];
    const component = ELEMENT_ATTR.exec(tag)?.[1] ?? COMPONENT_ATTR.exec(tag)?.[1];
    if (path === undefined || !component) continue;
    routes.push({ path, component });
  }

  ROUTE_OBJECT.lastIndex = 0;
  while ((match = ROUTE_OBJECT.exec(content)) !== null) {
    routes.push({ path: match[1]!, component: match[2]! });
  }

  return routes;
}

/** The text of the JSX opening tag at `start`, brace expressions skipped. */
function jsxTag(content: string, start: number): string {
  for (let i = start; i < content.length; i++) {
    const char = content[i]!;
    if (char === '{') {
      i += blockAt(content, i).length - 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      for (i++; i < content.length; i++) {
        if (content[i] === '\\') i++;
        else if (content[i] === quote) break;
      }
      continue;
    }
    if (char === '>') return content.slice(start, i + 1);
  }
  return content.slice(start, start + 1000);
}

/**
 * The component names the screen, with the path as the fallback.
 *
 * `<Route path="/lobby/:code/edit" element={<LobbyEdit />} />` under a path
 * rule is called `edit`, which says nothing on its own; the component already
 * carries the fuller name the author chose.
 */
function screenIdFor(path: string, component: string, ids: IdSet): string {
  const segments = path.split('/').filter(Boolean).filter(s => !s.startsWith(':') && s !== '*');
  const last = segments[segments.length - 1];
  const parent = segments[segments.length - 2];

  const fallbacks = [kebab(component)];
  if (last) fallbacks.push(parent ? `${parent}-${last}` : last, `${last}-screen`);
  return ids.claim(fallbacks[0]!, ...fallbacks.slice(1), 'entry');
}

// --- navigation ------------------------------------------------------------

/** `/lobby/ABC/edit` matches the route `/lobby/:code/edit`. */
function matchRoute(target: string, routes: Map<string, string>): string | null {
  const clean = target.split(/[?#]/)[0]!.replace(/\/$/, '') || '/';
  if (routes.has(clean)) return routes.get(clean)!;

  const parts = clean.split('/').filter(Boolean);
  for (const [pattern, id] of routes) {
    const patternParts = pattern.split('/').filter(Boolean);
    if (patternParts.length !== parts.length) continue;
    if (patternParts.every((p, i) => p.startsWith(':') || p === parts[i])) return id;
  }
  return null;
}

export function extractReactRouter(
  sources: ScaffoldSource[],
  ids: IdSet,
  claimed: Set<string> = new Set()
): ReactRouterResult {
  const files = new Set(sources.map(s => s.path));

  // The router file is whichever one declares routes; there is usually one.
  const routers = sources.filter(s => /<Route\b|createBrowserRouter/.test(s.content));
  if (routers.length === 0) return EMPTY();

  const nodes: ContextModelNode[] = [];
  const routes = new Map<string, string>();
  const owner = new Map<string, string>();
  const notes: string[] = [];
  let unresolved = 0;
  let nested = 0;

  for (const router of routers) {
    const imports = importedNames(router, files);
    for (const route of parseRoutes(router.content)) {
      // A child route's path is relative to a parent this pass does not track,
      // so its full path is unknown. Better absent than wrong.
      if (route.path !== '' && !route.path.startsWith('/')) {
        nested++;
        continue;
      }
      const path = route.path || '/';
      if (routes.has(path)) continue;

      // The component's own file, not the router's. A route whose component is
      // defined inline or imported from a package has nowhere better to point.
      const file = imports.get(route.component);
      if (file && claimed.has(file)) continue;
      if (!file) unresolved++;

      const id = screenIdFor(path, route.component, ids);
      routes.set(path, id);
      if (file && !owner.has(file)) owner.set(file, id);

      nodes.push({
        id,
        type: 'screen',
        label: titleise(kebab(route.component)),
        data: {
          implemented_by: [file ?? router.path],
          status: 'implemented',
          route: path,
        },
      });
    }
  }

  if (nodes.length === 0) return EMPTY();

  const entry = nodes.find(n => n.id === routes.get('/')) ?? nodes[0]!;
  entry.data = { ...entry.data, entry: true };

  notes.push(`${nodes.length} route(s) from a router table; "${entry.id}" is the entry point`);
  if (nested > 0) {
    notes.push(`${nested} nested route(s) skipped: their path is relative to a parent route`);
  }
  if (unresolved > 0) {
    notes.push(`${unresolved} route(s) named a component that was not imported relatively, so they point at the router file`);
  }

  const { edges, navNotes } = extractRouterNavigation(sources, owner, routes, files);
  notes.push(...navNotes);

  return { nodes, edges, notes, routes, owner };
}

// --- navigation between screens --------------------------------------------

/** Attributes a `navigate()` call to the screen it happens on. */
function extractRouterNavigation(
  sources: ScaffoldSource[],
  owner: Map<string, string>,
  routes: Map<string, string>,
  _files: Set<string>
): { edges: GraphEdge[]; navNotes: string[] } {
  const reachedBy = screenReach(sources, owner);
  const edges: GraphEdge[] = [];
  const seenEdge = new Set<string>();
  let dynamic = 0;
  let viaComponent = 0;

  for (const source of sources) {
    const from = reachedBy.get(source.path);
    if (!from || from.size === 0) continue;
    const isScreenFile = owner.has(source.path);

    const targets = new Set<string>();
    for (const pattern of [NAVIGATE, LINK_TO]) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source.content)) !== null) {
        const raw = pattern === NAVIGATE ? match[2]! : (match[1] ?? match[2]!);
        if (!raw.startsWith('/')) continue;
        // `/lobby/${code}/edit` — a substituted segment matches a parameter.
        const target = matchRoute(raw.replace(/\$\{[^}]*\}/g, 'x'), routes);
        if (target) targets.add(target);
        else dynamic++;
      }
    }

    for (const to of targets) {
      for (const fromId of from) {
        if (fromId === to) continue;
        const key = `${fromId}->${to}`;
        if (seenEdge.has(key)) continue;
        seenEdge.add(key);
        edges.push({ from: fromId, to, type: 'navigates-to' });
        if (!isScreenFile) viaComponent++;
      }
    }
  }

  const navNotes: string[] = [];
  if (edges.length > 0) navNotes.push(`${edges.length} navigation edge(s) from navigate() and <Link to>`);
  if (viaComponent > 0) {
    navNotes.push(`${viaComponent} of them come from a shared component, so they are credited to every screen importing it`);
  }
  if (dynamic > 0) navNotes.push(`${dynamic} navigation call(s) matched no declared route`);

  return { edges, navNotes };
}
