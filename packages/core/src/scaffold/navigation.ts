import type { GraphEdge } from '../schema.js';
import type { ScaffoldSource } from './sources.js';

/**
 * Reads the navigation topology of a file-routed app.
 *
 * Three things make this more than grepping for `router.push` in route files,
 * and all three were found by running the first version against a second app:
 * a screen navigates through the components it renders, a tab bar declares
 * reachability without any call site at all, and a route computed from data
 * cannot be resolved at all — which has to be reported rather than dropped.
 */

const NAVIGATION = [
  /\brouter\s*\.\s*(?:push|replace|navigate)\s*\(\s*(['"`])([^'"`]*)\1/g,
  /\brouter\s*\.\s*(?:push|replace|navigate)\s*\(\s*\{\s*pathname\s*:\s*(['"`])([^'"`]*)\1/g,
  /\bhref\s*=\s*(?:\{\s*)?(['"`])([^'"`]*)\1/g,
];

/** A navigation whose target is an expression, so no literal path exists. */
const DYNAMIC_NAVIGATION = /\brouter\s*\.\s*(?:push|replace|navigate)\s*\(\s*(?!['"`]|\{\s*pathname)/g;

/** A layout that declares a set of mutually reachable siblings. */
const TAB_LAYOUT = /<Tabs[\s>/]|Tabs\.Screen|createBottomTabNavigator|createMaterialTopTabNavigator/;

const LOCAL_IMPORT = /\bimport\s+(?:[^'";]*?\bfrom\s*)?['"](\.[^'"]*)['"]/g;

/** How far a screen's own code is followed through the components it renders. */
const IMPORT_DEPTH = 3;

const EXTENSIONS = ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

export interface NavigationResult {
  edges: GraphEdge[];
  notes: string[];
}

function dirname(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

/** Resolves `../../src/components/X` against the importing file. */
function resolveImport(from: string, spec: string, files: Set<string>): string | null {
  const segments = [...dirname(from).split('/').filter(Boolean), ...spec.split('/')];
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') stack.pop();
    else stack.push(segment);
  }
  const base = stack.join('/');

  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (files.has(candidate)) return candidate;
  }
  return null;
}

/**
 * The files a screen's navigation can come from: its own, plus the local
 * modules it renders. A component that calls `router.replace` navigates on
 * behalf of whichever screen rendered it, so attributing it to the importer is
 * what the edge actually means.
 */
function importClosure(
  entry: string,
  byPath: Map<string, ScaffoldSource>,
  routeFiles: Set<string>,
): string[] {
  const files = new Set(byPath.keys());
  const seen = new Set([entry]);
  const collected: string[] = [entry];
  let frontier = [entry];

  for (let depth = 0; depth < IMPORT_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const path of frontier) {
      const source = byPath.get(path);
      if (!source) continue;

      LOCAL_IMPORT.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = LOCAL_IMPORT.exec(source.content)) !== null) {
        const resolved = resolveImport(path, match[1]!, files);
        // Another route file owns its own navigation; following into it would
        // give this screen every edge of its neighbour.
        if (!resolved || seen.has(resolved) || routeFiles.has(resolved)) continue;
        seen.add(resolved);
        collected.push(resolved);
        next.push(resolved);
      }
    }
    frontier = next;
  }
  return collected;
}

/** Strips groups, query strings and interpolation to a comparable route path. */
export function normaliseTarget(raw: string): string | null {
  if (!raw.startsWith('/')) return null;
  const path = raw.split('?')[0]!.split('#')[0]!;
  const cleaned = path
    .split('/')
    .map(s => s.replace(/^\((.*)\)$/, '$1'))
    .filter(Boolean)
    .filter(s => !s.includes('$'));
  const joined = '/' + cleaned.join('/');
  return joined.replace(/\/index$/, '') || '/';
}

export function extractNavigation(
  sources: ScaffoldSource[],
  owner: Map<string, string>,
  routes: Map<string, string>,
): NavigationResult {
  const byPath = new Map(sources.map(s => [s.path, s]));
  const routeFiles = new Set(owner.keys());
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  let dynamic = 0;
  let unresolved = 0;
  let viaComponent = 0;

  const add = (from: string, to: string): boolean => {
    if (to === from) return false;
    const key = `${from}|${to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    edges.push({ from, to, type: 'navigates-to' });
    return true;
  };

  // A layout renders on behalf of every route beneath it, so navigation in one
  // — or in a component it pulls in — belongs to each of those screens. Without
  // this an app whose chrome does the navigating looks like it has none.
  const attributions: Array<[string, string]> = [...owner];
  for (const source of sources) {
    const file = source.path.split('/').pop() ?? '';
    if (!file.startsWith('_layout.')) continue;
    const dir = dirname(source.path);
    for (const [routeFile, id] of owner) {
      if (routeFile.startsWith(dir === '' ? '' : `${dir}/`)) attributions.push([source.path, id]);
    }
  }

  for (const [routeFile, from] of attributions) {
    for (const path of importClosure(routeFile, byPath, routeFiles)) {
      const source = byPath.get(path);
      if (!source) continue;

      for (const pattern of NAVIGATION) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(source.content)) !== null) {
          const target = normaliseTarget(match[2]!);
          if (target === null) continue;

          const to = routes.get(target);
          if (to === undefined) {
            if (path === routeFile) unresolved++;
            continue;
          }
          if (add(from, to) && path !== routeFile) viaComponent++;
        }
      }

      if (path !== routeFile) continue;
      DYNAMIC_NAVIGATION.lastIndex = 0;
      while (DYNAMIC_NAVIGATION.exec(source.content) !== null) dynamic++;
    }
  }

  const tabs = tabEdges(sources, owner, add);

  const notes: string[] = [];
  if (edges.length > 0) notes.push(`${edges.length} navigation edge(s)`);
  if (viaComponent > 0) notes.push(`${viaComponent} of them reached through a rendered component`);
  if (tabs > 0) notes.push(`${tabs} from tab layouts, which declare reachability without a call site`);
  if (dynamic > 0) {
    notes.push(`${dynamic} navigation(s) target a computed route and cannot be resolved from source`);
  }
  if (unresolved > 0) notes.push(`${unresolved} navigation(s) point at a path with no route file`);

  return { edges, notes };
}

/**
 * A tab bar makes its screens mutually reachable, and nothing in the source
 * says so at a call site — without this the whole set reads as unreachable.
 */
function tabEdges(
  sources: ScaffoldSource[],
  owner: Map<string, string>,
  add: (from: string, to: string) => boolean,
): number {
  let added = 0;

  for (const source of sources) {
    const file = source.path.split('/').pop() ?? '';
    if (!file.startsWith('_layout.') || !TAB_LAYOUT.test(source.content)) continue;

    const dir = dirname(source.path);
    const siblings = [...owner.entries()]
      .filter(([path]) => dirname(path) === dir)
      .map(([, id]) => id);

    for (const from of siblings) {
      for (const to of siblings) {
        if (add(from, to)) added++;
      }
    }
  }
  return added;
}
