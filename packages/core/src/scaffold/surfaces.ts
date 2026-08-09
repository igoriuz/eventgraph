import type { ContextModelNode, GraphEdge } from '../schema.js';
import { extractNavigation } from './navigation.js';
import { IdSet, kebab, titleise, type ScaffoldSource } from './sources.js';

/**
 * Finds the outside edge of the system: HTTP endpoints on the server and
 * navigable screens in a file-routed app, plus the navigation between them.
 *
 * These are the parts a model needs and a regex can actually know. What a
 * command is called, which invariant it upholds and what event it produces are
 * modelling decisions — a scaffold that guessed at them would produce a graph
 * that looks finished and is wrong, which is worse than an obviously partial one.
 */

/** `app.post<{ Body: X }>('/trips', …)` and every framework shaped like it. */
const HTTP_ROUTE =
  /\b([a-zA-Z_$][\w$]*)\s*\.\s*(get|post|put|patch|delete)\s*(?:<[^>(]*>)?\s*\(\s*(['"`])(\/[^'"`\s]*)\3/g;

/** Route files in an `app/` tree: expo-router, Next's app router, and friends. */
const APP_ROUTE_FILE = /(?:^|\/)app\/(.+)\.(tsx|jsx|ts|js)$/;

export interface SurfaceResult {
  nodes: ContextModelNode[];
  edges: GraphEdge[];
  notes: string[];
  /** Route path (`/main/dashboard`) to node id, for resolving navigation. */
  routes: Map<string, string>;
}

function screen(id: string, label: string, src: string, kind?: string): ContextModelNode {
  const data: Record<string, unknown> = { implemented_by: [src], status: 'implemented' };
  if (kind) data.kind = kind;
  return { id, type: 'screen', label, data };
}

// --- HTTP endpoints --------------------------------------------------------

/** `/trips/:id/complete` → `trips-complete`; parameters carry no name. */
function endpointId(path: string): string {
  const segments = path
    .split('/')
    .filter(Boolean)
    .filter(s => !s.startsWith(':') && !s.startsWith('*') && !s.startsWith('['));
  return kebab(segments.join('-')) || 'root';
}

/**
 * A route registration binds a handler; a client call does not.
 *
 * `api.post('/auth/signup', { email, password })` and
 * `app.post('/auth/signup', { schema }, createUser)` are the same shape to a
 * pattern match, and counting the first as a surface doubles every endpoint in
 * a repository holding both tiers.
 *
 * Looking for an inline function separated them, but only for handlers written
 * inline: `router.get('/health', healthHandler)` is the ordinary way to declare
 * a route once the handlers live in their own module, and it was being dropped
 * silently. Two weaker signals together hold up better than one strong one that
 * is wrong about the common case:
 *
 *   - a registration passes a *callable* after the path — a function, or an
 *     identifier naming one. `{ email, password }` is a payload, not a handler,
 *     which is what separates a fire-and-forget client POST from a route;
 *   - a registration is a statement, a client call is part of an expression —
 *     it gets returned, awaited, or assigned.
 *
 * `api.post('/x', payload)` written as a bare statement still reads as a route.
 * Nothing in the syntax distinguishes it from `app.post('/x', handler)`, so the
 * ambiguity is left rather than resolved by guessing at variable names.
 */
function bindsHandler(content: string, callStart: number, from: number): boolean {
  if (!isStatement(content, callStart)) return false;

  const limit = Math.min(content.length, from + 4000);
  let depth = 1;

  for (let i = from; i < limit; i++) {
    const char = content[i]!;

    if (char === '/' && content[i + 1] === '/') {
      const end = content.indexOf('\n', i);
      if (end === -1) return false;
      i = end;
      continue;
    }
    if (char === '/' && content[i + 1] === '*') {
      const end = content.indexOf('*/', i + 2);
      if (end === -1) return false;
      i = end + 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      for (i++; i < limit; i++) {
        if (content[i] === '\\') i++;
        else if (content[i] === quote) break;
      }
      continue;
    }

    if (char === '(' || char === '[' || char === '{') depth++;
    else if (char === ')' || char === ']' || char === '}') {
      depth--;
      if (depth === 0) return false;
    } else if (char === ',' && depth === 1) {
      if (startsCallable(content, i + 1, limit)) return true;
    }
  }
  return false;
}

/** Whether the argument beginning at `from` could be a function. */
function startsCallable(content: string, from: number, limit: number): boolean {
  for (let i = from; i < limit; i++) {
    const char = content[i]!;
    if (/\s/.test(char)) continue;

    if (char === '/' && content[i + 1] === '/') {
      const end = content.indexOf('\n', i);
      if (end === -1) return false;
      i = end;
      continue;
    }
    if (char === '/' && content[i + 1] === '*') {
      const end = content.indexOf('*/', i + 2);
      if (end === -1) return false;
      i = end + 1;
      continue;
    }

    // An object, array, string or number is data. A parenthesis opens an arrow
    // function's parameters; anything else word-shaped names something.
    return char === '(' || /[A-Za-z_$]/.test(char);
  }
  return false;
}

/** Operators and keywords that make whatever follows them part of an expression. */
const FEEDS_A_VALUE = /[,=(&|+[:?!]$|\b(?:return|await|yield|typeof|in|of)$/;

/**
 * Whether the call beginning at `start` stands alone rather than feeding a
 * value somewhere.
 *
 * Read backwards to the previous real token. A semicolon or a brace ends a
 * statement outright; so does a newline, as long as the token before it was not
 * an operator — plenty of code omits semicolons, and treating those calls as
 * expressions would drop every route in the file.
 */
function isStatement(content: string, start: number): boolean {
  let sawNewline = false;

  for (let i = start - 1; i >= 0; i--) {
    const char = content[i]!;

    if (char === '\n') {
      sawNewline = true;
      continue;
    }
    if (/\s/.test(char)) continue;

    // `*/` here means a block comment sits between the call and its context.
    if (char === '/' && content[i - 1] === '*') {
      const open = content.lastIndexOf('/*', i - 1);
      if (open === -1) return true;
      i = open;
      continue;
    }

    // A non-space token on a line that comments out before it is not a token.
    const lineStart = content.lastIndexOf('\n', i) + 1;
    const comment = content.slice(lineStart, i).indexOf('//');
    if (comment !== -1) {
      sawNewline = true;
      i = lineStart;
      continue;
    }

    if (char === ';' || char === '{' || char === '}') return true;
    return sawNewline && !FEEDS_A_VALUE.test(content.slice(Math.max(0, i - 7), i + 1));
  }
  return true;
}

export function extractEndpoints(sources: ScaffoldSource[], ids: IdSet): SurfaceResult {
  const byId = new Map<string, { node: ContextModelNode; calls: string[] }>();
  const notes: string[] = [];
  let found = 0;
  let clientCalls = 0;

  for (const source of sources) {
    HTTP_ROUTE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = HTTP_ROUTE.exec(source.content)) !== null) {
      const method = match[2]!.toUpperCase();
      const path = match[4]!;

      if (!bindsHandler(source.content, match.index, HTTP_ROUTE.lastIndex)) {
        clientCalls++;
        continue;
      }
      found++;

      // One node per resource, listing every call it answers: the collection
      // and the item under it are one surface, not one per verb. The label
      // names the calls in full, since "POST, PATCH /trips" would claim a
      // PATCH on the collection that does not exist.
      const base = endpointId(path);
      const key = `${source.path}|${base}`;
      const call = `${method} ${path}`;

      const existing = byId.get(key);
      if (existing) {
        if (!existing.calls.includes(call)) existing.calls.push(call);
        continue;
      }

      const id = ids.claim(`${base}-endpoint`, `${kebab(method)}-${base}-endpoint`);
      byId.set(key, { node: screen(id, call, source.path, 'endpoint'), calls: [call] });
    }
  }

  for (const entry of byId.values()) {
    entry.node.label = entry.calls.join(', ');
  }

  if (found > 0) {
    notes.push(`${found} route registration(s) across ${byId.size} endpoint(s)`);
    notes.push('route paths are as written; a prefix applied at registration is not resolved');
  }
  if (clientCalls > 0) {
    notes.push(`${clientCalls} call(s) to the same paths bound no handler, so they were read as clients`);
  }

  return { nodes: [...byId.values()].map(e => e.node), edges: [], notes, routes: new Map() };
}

// --- file-routed screens ---------------------------------------------------

/** `app/(main)/lesson/roleplay.tsx` → `/main/lesson/roleplay`, groups dropped. */
function routePath(relative: string): string | null {
  const segments = relative.split('/');
  const last = segments[segments.length - 1]!;
  if (last.startsWith('_') || last.startsWith('+') || last === 'layout') return null;
  if (segments.some(s => s === 'api')) return null;

  const cleaned = segments
    .map(s => s.replace(/^\((.*)\)$/, '$1'))
    .filter(Boolean);
  if (cleaned[cleaned.length - 1] === 'index') cleaned.pop();

  return '/' + cleaned.join('/');
}

/** The last segment names the screen; a collision pulls in the one before it. */
function screenIdFor(path: string, ids: IdSet): string {
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return ids.claim('entry');
  const last = segments[segments.length - 1]!;
  const parent = segments[segments.length - 2];
  return ids.claim(last, parent ? `${parent}-${last}` : `${last}-screen`);
}

export function extractScreens(sources: ScaffoldSource[], ids: IdSet): SurfaceResult {
  const routes = new Map<string, string>();
  const nodes: ContextModelNode[] = [];
  const owner = new Map<string, string>();
  const notes: string[] = [];

  for (const source of sources) {
    const match = APP_ROUTE_FILE.exec(source.path);
    if (!match) continue;
    const path = routePath(match[1]!);
    if (path === null || routes.has(path)) continue;

    const id = screenIdFor(path, ids);
    routes.set(path, id);
    owner.set(source.path, id);
    nodes.push(screen(id, titleise(id), source.path));
  }

  if (nodes.length === 0) return { nodes, edges: [], notes, routes };

  // The shallowest route is where the app opens. Reachability is measured from
  // an entry screen, so guessing none leaves the whole UX lane silent. Depth is
  // counted in real segments, or the root route ties with every top-level one.
  const depth = (path: string) => path.split('/').filter(Boolean).length;
  const shallowest = [...routes.keys()].sort((a, b) => depth(a) - depth(b))[0]!;
  const entry = nodes.find(n => n.id === routes.get(shallowest))!;
  entry.data = { ...entry.data, entry: true };

  notes.push(`${nodes.length} file-routed screen(s); "${entry.id}" guessed as the entry point`);

  const navigation = extractNavigation(sources, owner, routes);
  notes.push(...navigation.notes);

  return { nodes, edges: navigation.edges, notes, routes };
}
