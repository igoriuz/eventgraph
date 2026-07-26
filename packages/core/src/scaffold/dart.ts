import type { ContextModelNode, GraphEdge } from '../schema.js';
import { IdSet, kebab, titleise, type ScaffoldSource } from './sources.js';

/**
 * Reads a Flutter app's surfaces and navigation.
 *
 * Nothing is file-routed here: routes are declared in one table, screens are
 * widget classes in their own files, and a shell wraps the tabs. So the route
 * gives the path, the builder names the widget, and the widget's own file is
 * what `implemented_by` should point at — the router file describes every
 * screen and implements none of them.
 */

const GO_ROUTE = /\bGoRoute\s*\(/g;
const SHELL_ROUTE = /\b(?:Shell|StatefulShell)Route\s*\(/g;
const INITIAL_LOCATION = /\binitialLocation\s*:\s*(['"])([^'"]+)\1/;

const PATH_FIELD = /\bpath\s*:\s*(['"])([^'"]+)\1/;
const NAME_FIELD = /\bname\s*:\s*(['"])([^'"]+)\1/;

/** `class HomeScreen extends StatelessWidget` and every widget base like it. */
const WIDGET_CLASS =
  /\bclass\s+(\w+)\s+extends\s+(?:Stateless|Stateful|Consumer|ConsumerStateful|Hook|HookConsumer)Widget\b/g;

/** A widget referenced inside a builder, so `const HomeScreen()` counts. */
const WIDGET_USE = /\b([A-Z]\w*)\s*\(/g;

const NAV_BY_PATH = /\bcontext\s*\.\s*(?:go|push|replace|pushReplacement)\s*\(\s*(['"])([^'"]+)\1/g;
const NAV_BY_NAME = /\bcontext\s*\.\s*(?:goNamed|pushNamed|replaceNamed)\s*\(\s*(['"])([^'"]+)\1/g;
const NAV_DYNAMIC = /\bcontext\s*\.\s*(?:go|push|goNamed|pushNamed)\s*\(\s*(?!['"])/g;

const DART_IMPORT = /\bimport\s+['"]([^'"]+)['"]/g;
const IMPORT_DEPTH = 3;

export interface DartResult {
  nodes: ContextModelNode[];
  edges: GraphEdge[];
  notes: string[];
}

/** The source text of the call starting at `open`, parentheses balanced. */
function blockAt(content: string, open: number): string {
  let depth = 0;
  for (let i = open; i < content.length; i++) {
    const char = content[i]!;
    if (char === '"' || char === "'") {
      const quote = char;
      for (i++; i < content.length; i++) {
        if (content[i] === '\\') i++;
        else if (content[i] === quote) break;
      }
      continue;
    }
    if (char === '(') depth++;
    else if (char === ')') {
      depth--;
      if (depth === 0) return content.slice(open, i + 1);
    }
  }
  return content.slice(open);
}

/** `package:app/core/x.dart` and `../x.dart` both resolve to a repo path. */
function resolveDartImport(from: string, spec: string, files: Set<string>): string | null {
  if (spec.startsWith('dart:')) return null;

  let candidate: string;
  if (spec.startsWith('package:')) {
    const withoutScheme = spec.slice('package:'.length);
    const slash = withoutScheme.indexOf('/');
    if (slash === -1) return null;
    candidate = `lib/${withoutScheme.slice(slash + 1)}`;
  } else if (spec.startsWith('.')) {
    const dir = from.slice(0, from.lastIndexOf('/'));
    const stack: string[] = dir.split('/').filter(Boolean);
    for (const segment of spec.split('/')) {
      if (segment === '.' || segment === '') continue;
      if (segment === '..') stack.pop();
      else stack.push(segment);
    }
    candidate = stack.join('/');
  } else {
    return null;
  }

  if (files.has(candidate)) return candidate;
  for (const file of files) {
    if (file.endsWith(`/${candidate}`)) return file;
  }
  return null;
}

function importClosure(entry: string, byPath: Map<string, ScaffoldSource>, screens: Set<string>): string[] {
  const files = new Set(byPath.keys());
  const seen = new Set([entry]);
  const collected = [entry];
  let frontier = [entry];

  for (let depth = 0; depth < IMPORT_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const path of frontier) {
      const source = byPath.get(path);
      if (!source) continue;
      DART_IMPORT.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = DART_IMPORT.exec(source.content)) !== null) {
        const resolved = resolveDartImport(path, match[1]!, files);
        // Another screen owns its own navigation.
        if (!resolved || seen.has(resolved) || screens.has(resolved)) continue;
        seen.add(resolved);
        collected.push(resolved);
        next.push(resolved);
      }
    }
    frontier = next;
  }
  return collected;
}

interface Route {
  path: string;
  name?: string;
  widget?: string;
  inShell: boolean;
}

function parseRoutes(source: ScaffoldSource, widgets: Map<string, string>): Route[] {
  const shellRanges: Array<[number, number]> = [];
  SHELL_ROUTE.lastIndex = 0;
  let shell: RegExpExecArray | null;
  while ((shell = SHELL_ROUTE.exec(source.content)) !== null) {
    const open = source.content.indexOf('(', shell.index);
    shellRanges.push([open, open + blockAt(source.content, open).length]);
  }

  const routes: Route[] = [];
  GO_ROUTE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = GO_ROUTE.exec(source.content)) !== null) {
    const open = source.content.indexOf('(', match.index);
    const block = blockAt(source.content, open);

    const path = PATH_FIELD.exec(block)?.[2];
    if (!path) continue;

    // Which widget in the builder is the screen. A wrapper like
    // OutsideShellFrame is a widget class too and sits *outside* the screen it
    // frames, so taking the first match hands every framed route the chrome's
    // file. Prefer one named like a screen, and fall back to the innermost.
    const used: string[] = [];
    WIDGET_USE.lastIndex = 0;
    let use: RegExpExecArray | null;
    while ((use = WIDGET_USE.exec(block)) !== null) {
      if (widgets.has(use[1]!) && !used.includes(use[1]!)) used.push(use[1]!);
    }
    const widget = used.find(w => /(?:Screen|Page|View)$/.test(w)) ?? used[used.length - 1];

    routes.push({
      path,
      name: NAME_FIELD.exec(block)?.[2],
      widget,
      inShell: shellRanges.some(([from, to]) => open > from && open < to),
    });
  }
  return routes;
}

/** `/movie/:vodId/:channelId` → `movie`; parameters carry no name. */
function routeId(path: string): string {
  const segments = path.split('/').filter(Boolean).filter(s => !s.startsWith(':'));
  return kebab(segments.join('-')) || 'root';
}

export function extractDart(sources: ScaffoldSource[], ids: IdSet): DartResult {
  const dart = sources.filter(s => s.path.endsWith('.dart'));
  if (dart.length === 0) return { nodes: [], edges: [], notes: [] };

  const widgets = new Map<string, string>();
  for (const source of dart) {
    WIDGET_CLASS.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WIDGET_CLASS.exec(source.content)) !== null) {
      if (!widgets.has(match[1]!)) widgets.set(match[1]!, source.path);
    }
  }

  const routes: Route[] = [];
  let initial: string | undefined;
  for (const source of dart) {
    if (!source.content.includes('GoRoute(')) continue;
    routes.push(...parseRoutes(source, widgets));
    initial ??= INITIAL_LOCATION.exec(source.content)?.[2];
  }
  if (routes.length === 0) return { nodes: [], edges: [], notes: [] };

  const nodes: ContextModelNode[] = [];
  const byPath = new Map<string, string>();
  const byName = new Map<string, string>();
  const fileOf = new Map<string, string>();

  for (const route of routes) {
    if (byPath.has(route.path)) continue;
    const src = route.widget ? widgets.get(route.widget) : undefined;
    const id = ids.claim(
      route.name ?? routeId(route.path),
      route.widget ? kebab(route.widget) : `${routeId(route.path)}-screen`
    );

    byPath.set(route.path, id);
    if (route.name) byName.set(route.name, id);
    if (src && !fileOf.has(src)) fileOf.set(src, id);

    const data: Record<string, unknown> = {};
    if (src) {
      data.implemented_by = [src];
      data.status = 'implemented';
    }
    if (route.path === initial) data.entry = true;

    nodes.push({
      id,
      type: 'screen',
      label: route.widget ? titleise(kebab(route.widget)) : titleise(id),
      ...(Object.keys(data).length > 0 ? { data } : {}),
    });
  }

  const { edges, notes } = dartNavigation(dart, fileOf, byPath, byName, routes);

  notes.unshift(
    `${nodes.length} route(s) from a route table; ${fileOf.size} resolved to the widget that implements them`
  );
  if (!initial) notes.push('no initialLocation found, so no entry screen is marked');

  return { nodes, edges, notes };
}

function dartNavigation(
  dart: ScaffoldSource[],
  fileOf: Map<string, string>,
  byPath: Map<string, string>,
  byName: Map<string, string>,
  routes: Route[],
): { edges: GraphEdge[]; notes: string[] } {
  const byPathSource = new Map(dart.map(s => [s.path, s]));
  const screenFiles = new Set(fileOf.keys());
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  let dynamic = 0;
  let viaWidget = 0;

  const add = (from: string, to: string): boolean => {
    if (!to || to === from) return false;
    const key = `${from}|${to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    edges.push({ from, to, type: 'navigates-to' });
    return true;
  };

  /** `/movie/12/34` has to match the declared `/movie/:vodId/:channelId`. */
  const matchPath = (target: string): string | undefined => {
    const clean = target.split('?')[0]!;
    if (byPath.has(clean)) return byPath.get(clean);
    const parts = clean.split('/').filter(Boolean);
    for (const [declared, id] of byPath) {
      const shape = declared.split('/').filter(Boolean);
      if (shape.length !== parts.length) continue;
      if (shape.every((s, i) => s.startsWith(':') || s === parts[i])) return id;
    }
    return undefined;
  };

  for (const [file, from] of fileOf) {
    for (const path of importClosure(file, byPathSource, screenFiles)) {
      const source = byPathSource.get(path);
      if (!source) continue;

      for (const [pattern, lookup] of [
        [NAV_BY_PATH, matchPath],
        [NAV_BY_NAME, (t: string) => byName.get(t)],
      ] as const) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(source.content)) !== null) {
          const to = lookup(match[2]!);
          if (to && add(from, to) && path !== file) viaWidget++;
        }
      }

      if (path !== file) continue;
      NAV_DYNAMIC.lastIndex = 0;
      while (NAV_DYNAMIC.exec(source.content) !== null) dynamic++;
    }
  }

  // A shell wraps its routes in one chrome, so its tabs reach each other with
  // no call site — the same shape as a tab bar in a file-routed app.
  const shellIds = routes.filter(r => r.inShell).map(r => byPath.get(r.path)!).filter(Boolean);
  let shellEdges = 0;
  for (const from of shellIds) {
    for (const to of shellIds) if (add(from, to)) shellEdges++;
  }

  const notes: string[] = [];
  if (edges.length > 0) notes.push(`${edges.length} navigation edge(s)`);
  if (viaWidget > 0) notes.push(`${viaWidget} of them reached through a rendered widget`);
  if (shellEdges > 0) notes.push(`${shellEdges} from a shell route, whose tabs reach each other directly`);
  if (dynamic > 0) {
    notes.push(`${dynamic} navigation(s) target a computed route and cannot be resolved from source`);
  }

  return { edges, notes };
}
