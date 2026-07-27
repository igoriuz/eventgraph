import type { ContextModelNode, GraphEdge } from '../schema.js';
import { screenReach } from './react-router.js';
import {
  blockAt,
  IdSet,
  kebab,
  pluralise,
  singularise,
  titleise,
  type ScaffoldSource,
} from './sources.js';

/**
 * Reads a SpacetimeDB module, where the domain is already written down.
 *
 * A reducer is a command: it is named, it takes typed arguments, and its body
 * says which tables it writes. Where the module keeps an event log, the row it
 * inserts names the event outright. So unlike an HTTP handler — where the
 * command, the event and the aggregate all have to be inferred — most of the
 * write model here is stated in the source, and reading it beats guessing.
 *
 * On the client the seam is the subscription: `useTable(tables.encounter)` is a
 * screen reading a projection, and `conn.reducers.logEncounter(…)` is a screen
 * offering a command.
 */

/** `export const log_encounter = spacetimedb.reducer({ args }, (ctx, args) => …)` */
const REDUCER = /\bexport\s+const\s+(\w+)\s*=\s*(?:\w+\s*\.\s*)?reducer\s*\(/g;

/** `const lobby = table({ name: 'lobby', public: true }, { columns })` */
const TABLE = /\btable\s*\(\s*\{/g;
const TABLE_NAME = /\bname\s*:\s*['"`]([\w-]+)['"`]/;
const TABLE_PUBLIC = /\bpublic\s*:\s*true\b/;

/** Writes inside a reducer body: `ctx.db.encounter.insert({ … })`. */
const TABLE_WRITE = /\bctx\s*\.\s*db\s*\.\s*(\w+)(?:\s*\.\s*\w+)?\s*\.\s*(insert|update|delete)\s*\(/g;
/**
 * The value assigned to the event-type column, whatever shape it takes.
 *
 * `eventType: EventType.CAUGHT` is the tidy case. The interesting ones are the
 * strays: a bare `'revived'` that never made it into the enum, or a ternary
 * writing one of two literals. Matching only the enum reference finds every
 * event the codebase is disciplined about and misses exactly the ones that
 * escaped — which are the events worth knowing about, since nothing typed is
 * holding them to a name.
 */
const EVENT_TYPE_VALUE = /\bevent(?:_t|T)ype\s*:\s*([^,\n}]+)/g;
/** Within that value: an enum member, and separately any string literal. */
const ENUM_MEMBER = /(?:^|[^\w.])(?:\w+\s*\.\s*)?([A-Z][A-Z0-9_]{2,})\b/g;
const STRING_LITERAL = /['"`]([a-z][\w-]*)['"`]/g;
/** A rejection path the command can take: `throw new SenderError('LOBBY_NOT_FOUND')`. */
const REJECTION = /\bnew\s+\w*Error\s*\(\s*['"`]([A-Z][A-Z0-9_]*)['"`]/g;

/** The column that marks a table as the event log rather than an aggregate. */
const EVENT_LOG_COLUMN = /\bevent(?:_t|T)ype\s*:/;

/** Client seams: `useTable(tables.encounter)` and `conn.reducers.logEncounter(`. */
const USE_TABLE = /\buseTable\s*\(\s*(?:\w+\s*\.\s*)?(\w+)\s*[,)]/g;
const CALL_REDUCER = /\breducers\s*\.\s*(\w+)/g;

const GENERATED = /module_bindings|\/generated\//;

export interface SpacetimeResult {
  nodes: ContextModelNode[];
  edges: GraphEdge[];
  notes: string[];
}

const EMPTY = (): SpacetimeResult => ({ nodes: [], edges: [], notes: [] });

interface Table {
  /** Declared name, e.g. `lobby_settings`. */
  name: string;
  /** Aggregate node id, e.g. `lobby-setting`. */
  id: string;
  public: boolean;
  file: string;
  /** Read-model node id, created only once a client actually reads it. */
  view?: string;
}

interface Reducer {
  name: string;
  id: string;
  file: string;
  writes: Set<string>;
  events: Set<string>;
  rejections: Set<string>;
}

/** `logEncounter`, `log_encounter` and `LogEncounter` are all one command. */
function normalise(name: string): string {
  return kebab(name);
}

// --- server ----------------------------------------------------------------

type ParsedTable = Omit<Table, 'id' | 'view'> & { isEventLog: boolean };

function parseTables(sources: ScaffoldSource[]): Map<string, ParsedTable> {
  const tables = new Map<string, ParsedTable>();

  for (const source of sources) {
    if (GENERATED.test(source.path)) continue;

    TABLE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TABLE.exec(source.content)) !== null) {
      const optionsAt = source.content.indexOf('{', match.index);
      const options = blockAt(source.content, optionsAt);
      const name = TABLE_NAME.exec(options)?.[1];
      if (!name || tables.has(name)) continue;

      // The columns are the second argument, so start looking after the
      // options object rather than from the call again.
      const columnsAt = source.content.indexOf('{', optionsAt + options.length);
      const columns = columnsAt === -1 ? '' : blockAt(source.content, columnsAt);

      tables.set(name, {
        name,
        public: TABLE_PUBLIC.test(options),
        file: source.path,
        isEventLog: EVENT_LOG_COLUMN.test(columns),
      });
    }
  }
  return tables;
}

/** A module-local `function name(…) {…}` or `const name = (…) => {…}`. */
const LOCAL_FUNCTION = /\b(?:function\s+(\w+)\s*\(|const\s+(\w+)\s*=\s*(?:async\s*)?\()/g;
/** A call to one of them. */
const CALL = /\b(\w+)\s*\(/g;
/** How far to follow helpers before giving up. */
const CALL_DEPTH = 3;

interface Effects {
  writes: Set<string>;
  events: Set<string>;
  rejections: Set<string>;
}

/**
 * Every event name assigned to the event-type column within `call`.
 *
 * One assignment can yield two names — `completed ? 'badge_on' : 'badge_off'`
 * is one write and two events — so the value is scanned rather than captured.
 */
function eventTypesIn(call: string): string[] {
  const names: string[] = [];

  EVENT_TYPE_VALUE.lastIndex = 0;
  let assignment: RegExpExecArray | null;
  while ((assignment = EVENT_TYPE_VALUE.exec(call)) !== null) {
    const value = assignment[1]!;

    ENUM_MEMBER.lastIndex = 0;
    let member: RegExpExecArray | null;
    while ((member = ENUM_MEMBER.exec(value)) !== null) names.push(member[1]!);

    STRING_LITERAL.lastIndex = 0;
    let literal: RegExpExecArray | null;
    while ((literal = STRING_LITERAL.exec(value)) !== null) names.push(literal[1]!);
  }
  return names;
}

/** What a stretch of code does, ignoring anything it calls. */
function directEffects(body: string): Effects {
  const writes = new Set<string>();
  const events = new Set<string>();
  const rejections = new Set<string>();

  TABLE_WRITE.lastIndex = 0;
  let write: RegExpExecArray | null;
  while ((write = TABLE_WRITE.exec(body)) !== null) {
    writes.add(write[1]!);
    // The row inserted into the event log names the event; read it from that
    // call alone, so an unrelated insert nearby cannot contribute one.
    const call = blockAt(body, body.indexOf('(', TABLE_WRITE.lastIndex - 1));
    for (const name of eventTypesIn(call)) events.add(name);
  }

  REJECTION.lastIndex = 0;
  let rejection: RegExpExecArray | null;
  while ((rejection = REJECTION.exec(body)) !== null) rejections.add(rejection[1]!);

  return { writes, events, rejections };
}

/** Every top-level helper in a file, by name. */
function localFunctions(content: string): Map<string, string> {
  const functions = new Map<string, string>();

  LOCAL_FUNCTION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LOCAL_FUNCTION.exec(content)) !== null) {
    const name = match[1] ?? match[2]!;
    if (functions.has(name)) continue;

    // The body must follow the parameter list, allowing for a return type and
    // an arrow. Taking the next `{` anywhere would give `const TOTAL = (2 + 3)`
    // the body of whatever happened to be declared after it.
    const params = blockAt(content, LOCAL_FUNCTION.lastIndex - 1);
    const after = LOCAL_FUNCTION.lastIndex - 1 + params.length;
    const between = content.slice(after, content.indexOf('{', after) + 1);
    if (!/^\s*(?::[^{;=]*)?(?:=>\s*)?\{$/.test(between)) continue;

    functions.set(name, blockAt(content, after + between.length - 1));
  }
  return functions;
}

/**
 * Folds in what the helpers a body calls do, up to `CALL_DEPTH`.
 *
 * Shared helpers are where the interesting writes end up — a module that has
 * been deduplicated at all moves its kill, its upsert and its auth preamble out
 * of the reducers. Reading only the reducer body then misses exactly the paths
 * that were important enough to factor out.
 */
function foldCalls(
  body: string,
  functions: Map<string, string>,
  into: Effects,
  seen: Set<string>,
  depth: number
): void {
  const direct = directEffects(body);
  for (const write of direct.writes) into.writes.add(write);
  for (const event of direct.events) into.events.add(event);
  for (const rejection of direct.rejections) into.rejections.add(rejection);

  if (depth === 0) return;

  CALL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CALL.exec(body)) !== null) {
    const name = match[1]!;
    if (seen.has(name)) continue;
    const helper = functions.get(name);
    if (!helper) continue;
    seen.add(name);
    foldCalls(helper, functions, into, seen, depth - 1);
  }
}

function parseReducers(sources: ScaffoldSource[]): Array<Omit<Reducer, 'id'>> {
  const reducers: Array<Omit<Reducer, 'id'>> = [];

  for (const source of sources) {
    if (GENERATED.test(source.path)) continue;

    const functions = localFunctions(source.content);

    REDUCER.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = REDUCER.exec(source.content)) !== null) {
      const open = source.content.indexOf('(', match.index + match[1]!.length);
      const body = blockAt(source.content, open);

      const effects: Effects = { writes: new Set(), events: new Set(), rejections: new Set() };
      // The reducer itself is a local const, so exclude it or it folds itself.
      foldCalls(body, functions, effects, new Set([match[1]!]), CALL_DEPTH);

      reducers.push({ name: match[1]!, file: source.path, ...effects });
    }
  }
  return reducers;
}

// --- client ----------------------------------------------------------------

export interface SpacetimeOptions {
  /** Routed file to screen id, from whichever router extractor found them. */
  owner?: Map<string, string>;
}

export function extractSpacetime(
  sources: ScaffoldSource[],
  ids: IdSet,
  options: SpacetimeOptions = {}
): SpacetimeResult {
  const rawTables = parseTables(sources);
  const rawReducers = parseReducers(sources);
  if (rawTables.size === 0 && rawReducers.length === 0) return EMPTY();

  const nodes: ContextModelNode[] = [];
  const edges: GraphEdge[] = [];
  const notes: string[] = [];

  // The event log is not an aggregate: it is where the events are written down.
  const eventLogs = new Set(
    [...rawTables.values()].filter(t => t.isEventLog).map(t => t.name)
  );

  // Aggregates, one per declared table. Keyed by the kebab form, because a
  // table declared as `lobby_settings` is written as `ctx.db.lobbySettings`
  // and subscribed to as `tables.lobbySettings`.
  const tables = new Map<string, Table>();
  for (const [name, table] of rawTables) {
    if (eventLogs.has(name)) continue;
    const id = ids.claim(singularise(kebab(name)), kebab(name));
    tables.set(kebab(name), { ...table, id });

    const data: Record<string, unknown> = {
      implemented_by: [table.file],
      status: 'implemented',
    };
    // Visibility is declared, not inferred: a table without `public` cannot be
    // subscribed to by any client, whatever the code around it intends. Worth
    // carrying into the model, because a writer and a reader can both be built
    // and the reader still never see anything.
    if (!table.public) data.subscribable = false;

    nodes.push({ id, type: 'aggregate', label: titleise(id), data });
  }

  // Commands, one per reducer, with the aggregates they write.
  const reducers = new Map<string, Reducer>();
  const eventIds = new Map<string, string>();

  for (const raw of rawReducers) {
    const id = ids.claim(normalise(raw.name));
    const reducer: Reducer = { ...raw, id };
    reducers.set(normalise(raw.name), reducer);

    const data: Record<string, unknown> = {
      implemented_by: [raw.file],
      status: 'implemented',
    };
    // Not invariants — that is modelling — but the rejection paths the code
    // already spells out, which is what the invariants will be written from.
    if (raw.rejections.size > 0) data.rejects = [...raw.rejections].sort();

    nodes.push({ id, type: 'command', label: titleise(id), data });

    const actsOn = new Set<string>();
    for (const written of raw.writes) {
      const target = tables.get(kebab(written));
      if (target) actsOn.add(target.id);
    }
    for (const target of actsOn) edges.push({ from: id, to: target, type: 'acts-on' });

    for (const event of raw.events) {
      let eventId = eventIds.get(event);
      if (!eventId) {
        eventId = ids.claim(kebab(event));
        eventIds.set(event, eventId);
        nodes.push({
          id: eventId,
          type: 'event',
          label: titleise(eventId),
          data: { implemented_by: [raw.file], status: 'implemented' },
        });
      }
      edges.push({ from: id, to: eventId, type: 'produces' });
    }
  }

  notes.push(
    `${reducers.size} reducer(s) read as commands and ${tables.size} table(s) as aggregates`
  );
  if (eventIds.size > 0) {
    notes.push(
      `${eventIds.size} event(s) named by rows written to the ${[...eventLogs].join(', ')} log`
    );
    notes.push('which aggregate each event belongs to is modelling, so no belongs-to edge is drawn');
  } else if (rawReducers.length > 0) {
    notes.push('no event log found, so the events a command produces are still unmodelled');
  }

  // --- the client seam -----------------------------------------------------

  const owner = options.owner ?? new Map<string, string>();
  if (owner.size === 0) {
    if (tables.size > 0) notes.push('no screens were found, so no subscription edges were drawn');
    return { nodes, edges, notes };
  }

  const reach = screenReach(sources, owner);
  const views = new Map<string, string>();
  const seen = new Set<string>();
  let readEdges = 0;
  let offerEdges = 0;
  let unknownReducer = 0;

  for (const source of sources) {
    if (GENERATED.test(source.path)) continue;
    const screens = reach.get(source.path);
    if (!screens || screens.size === 0) continue;

    USE_TABLE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = USE_TABLE.exec(source.content)) !== null) {
      const table = tables.get(kebab(match[1]!));
      if (!table) continue;

      // SpacetimeDB has no separate read side: the client subscribes to the
      // same table the reducer writes. The projection still deserves its own
      // node — a screen reads a view of an aggregate, not the aggregate — so
      // one is created the first time a client actually subscribes.
      if (!table.view) {
        table.view = ids.claim(pluralise(table.id), `${table.id}-view`);
        views.set(table.name, table.view);
        nodes.push({
          id: table.view,
          type: 'read-model',
          label: titleise(table.view),
          data: { implemented_by: [table.file], status: 'implemented' },
        });
      }

      for (const screen of screens) {
        const key = `${screen}->${table.view}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from: screen, to: table.view, type: 'reads' });
        readEdges++;
      }
    }

    CALL_REDUCER.lastIndex = 0;
    while ((match = CALL_REDUCER.exec(source.content)) !== null) {
      const command = reducers.get(normalise(match[1]!));
      if (!command) {
        unknownReducer++;
        continue;
      }
      for (const screen of screens) {
        const key = `${screen}->${command.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from: screen, to: command.id, type: 'offers' });
        offerEdges++;
      }
    }
  }

  if (views.size > 0) {
    notes.push(
      `${views.size} subscribed table(s) also modelled as read-models; SpacetimeDB writes and reads the same row`
    );
  }
  if (readEdges > 0) notes.push(`${readEdges} read edge(s) from useTable subscriptions`);
  if (offerEdges > 0) notes.push(`${offerEdges} offer edge(s) from reducer calls`);
  if (unknownReducer > 0) {
    notes.push(`${unknownReducer} reducer call(s) named no declared reducer`);
  }

  const unread = [...tables.values()].filter(t => !t.view && t.public);
  if (unread.length > 0) {
    notes.push(`${unread.length} public table(s) no screen subscribes to: ${unread.map(t => t.id).join(', ')}`);
  }

  // The sharper version of the same question. A public table nobody reads yet
  // is a gap someone can close with a subscription; a written table that is
  // not public cannot be read at all, so anything built to display it is dead
  // on arrival and no amount of client code will fix it.
  const written = new Set<string>();
  for (const reducer of reducers.values()) {
    for (const table of reducer.writes) written.add(kebab(table));
  }
  const unreadable = [...tables.entries()]
    .filter(([key, table]) => !table.public && written.has(key))
    .map(([, table]) => table.id);

  if (unreadable.length > 0) {
    notes.push(
      `${unreadable.length} table(s) written but not public, so no client may subscribe: ${unreadable.join(', ')}`
    );
  }

  return { nodes, edges, notes };
}
