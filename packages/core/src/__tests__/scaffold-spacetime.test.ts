import { describe, it, expect } from 'vitest';
import { scaffold } from '../scaffold/index.js';
import type { ContextModel } from '../schema.js';
import type { ScaffoldSource } from '../scaffold/sources.js';

function src(path: string, content: string): ScaffoldSource {
  return { path, content };
}

const node = (model: ContextModel, id: string) => model.nodes.find(n => n.id === id);
const targets = (model: ContextModel, from: string, type: string) =>
  model.edges.filter(e => e.from === from && e.type === type).map(e => e.to).sort();

const SCHEMA = src(
  'server/src/schema.ts',
  `
  import { schema, table, t } from 'spacetimedb/server';

  const lobby = table(
    { name: 'lobby', public: true },
    { id: t.u64().primaryKey().autoInc(), code: t.string().unique() }
  );

  const encounter = table(
    { name: 'encounter', public: true },
    { id: t.u64().primaryKey(), lobbyId: t.u64(), status: t.string() }
  );

  const lobby_settings = table(
    { name: 'lobby_settings', public: true },
    { lobbyId: t.u64().primaryKey(), theme: t.string() }
  );

  const rate_limit = table(
    { name: 'rate_limit' },
    { id: t.u64().primaryKey(), calls: t.u32() }
  );

  const event = table(
    { name: 'event', public: true },
    { id: t.u64().primaryKey(), encounterId: t.u64(), eventType: t.string() }
  );
`
);

const REDUCERS = src(
  'server/src/index.ts',
  `
  import spacetimedb from './schema';

  const EventType = { CAUGHT: 'caught', FAINTED: 'fainted' } as const;

  function checkRateLimit(ctx, name) {
    ctx.db.rateLimit.insert({ id: 0n, calls: 1 });
    throw new SenderError('RATE_LIMITED');
  }

  // Shared by kill_encounter and report_death — a partner's encounter dies too.
  function killEncounterCore(ctx, enc) {
    ctx.db.encounter.id.update({ ...enc, status: 'DEAD' });
    ctx.db.event.insert({ id: 0n, encounterId: enc.id, eventType: EventType.FAINTED });
  }

  export const log_encounter = spacetimedb.reducer(
    { lobbyId: t.u64() },
    (ctx, args) => {
      checkRateLimit(ctx, 'log_encounter');
      const lobby = ctx.db.lobby.id.find(args.lobbyId);
      if (!lobby) {
        throw new SenderError('LOBBY_NOT_FOUND');
      }
      // Unlink the partner's encounter /* and mind the nesting */ before insert
      const inserted = ctx.db.encounter.insert({ id: 0n, lobbyId: args.lobbyId });
      ctx.db.event.insert({ id: 0n, encounterId: inserted.id, eventType: EventType.CAUGHT });
    }
  );

  export const kill_encounter = spacetimedb.reducer(
    { encounterId: t.u64() },
    (ctx, args) => {
      const enc = ctx.db.encounter.id.find(args.encounterId);
      killEncounterCore(ctx, enc);
    }
  );

  export const update_lobby_settings = spacetimedb.reducer(
    { lobbyId: t.u64() },
    (ctx, args) => {
      ctx.db.lobbySettings.lobbyId.update({ lobbyId: args.lobbyId, theme: 'dark' });
    }
  );
`
);

const APP = src(
  'client/src/App.tsx',
  `
  import { BrowserRouter, Routes, Route } from 'react-router-dom';
  import Home from './pages/Home';
  import LobbyView from './pages/LobbyView';

  export default function App() {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/lobby/:code" element={<LobbyView />} />
        </Routes>
      </BrowserRouter>
    );
  }
`
);

const HOME = src(
  'client/src/pages/Home.tsx',
  `
  import { useNavigate } from 'react-router-dom';
  import LoginPanel from '../components/LoginPanel';

  export default function Home() {
    const navigate = useNavigate();
    return <button onClick={() => navigate('/lobby/ABC')}>Go</button>;
  }
`
);

const LOGIN_PANEL = src(
  'client/src/components/LoginPanel.tsx',
  `
  import { useTable } from 'spacetimedb/react';

  export default function LoginPanel({ conn }) {
    const [lobbies] = useTable(tables.lobby);
    return <button onClick={() => conn.reducers.logEncounter({ lobbyId: 1n })}>Log</button>;
  }
`
);

const LOBBY_VIEW = src(
  'client/src/pages/LobbyView.tsx',
  `
  import { useTable, useReducer } from 'spacetimedb/react';

  export default function LobbyView({ conn }) {
    const [encounters] = useTable(tables.encounter);
    const [settings] = useTable(tables.lobbySettings);
    const kill = useReducer(reducers.killEncounter);
    return <button onClick={() => kill({ encounterId: 1n })}>Kill</button>;
  }
`
);

const ALL = [SCHEMA, REDUCERS, APP, HOME, LOGIN_PANEL, LOBBY_VIEW];

describe('spacetime scaffold', () => {
  it('reads reducers as commands and tables as aggregates', () => {
    const { model } = scaffold(ALL);

    expect(node(model, 'log-encounter')?.type).toBe('command');
    expect(node(model, 'kill-encounter')?.type).toBe('command');
    expect(node(model, 'encounter')?.type).toBe('aggregate');
    expect(node(model, 'rate-limit')?.type).toBe('aggregate');
  });

  it('does not make the event log an aggregate', () => {
    const { model } = scaffold(ALL);
    expect(node(model, 'event')).toBeUndefined();
  });

  it('names events from the rows written to the event log', () => {
    const { model } = scaffold(ALL);

    expect(node(model, 'caught')?.type).toBe('event');
    expect(targets(model, 'log-encounter', 'produces')).toEqual(['caught']);
  });

  it('follows a shared helper to the events and writes it makes', () => {
    const { model } = scaffold(ALL);

    // kill_encounter writes nothing itself: killEncounterCore does.
    expect(targets(model, 'kill-encounter', 'produces')).toEqual(['fainted']);
    expect(targets(model, 'kill-encounter', 'acts-on')).toEqual(['encounter']);
  });

  it('is not derailed by an apostrophe in a comment', () => {
    const { model } = scaffold(ALL);

    // The comment above killEncounterCore contains "partner's". A quote-only
    // skipper reads the rest of the file as one string and every later event
    // lands on whichever reducer came first.
    expect(targets(model, 'log-encounter', 'produces')).not.toContain('fainted');
  });

  it('matches a camelCase table access to its snake_case declaration', () => {
    const { model } = scaffold(ALL);

    // ctx.db.lobbySettings against `name: 'lobby_settings'`.
    expect(targets(model, 'update-lobby-settings', 'acts-on')).toEqual(['lobby-setting']);
  });

  it('collects the rejection paths a command spells out', () => {
    const { model } = scaffold(ALL);

    expect(node(model, 'log-encounter')?.data?.rejects).toEqual([
      'LOBBY_NOT_FOUND',
      'RATE_LIMITED',
    ]);
  });

  it('reads a subscription as a screen reading a read-model', () => {
    const { model } = scaffold(ALL);

    expect(node(model, 'encounters')?.type).toBe('read-model');
    expect(targets(model, 'lobby-view', 'reads')).toEqual(['encounters', 'lobby-settings']);
  });

  it('names the read-model in the plural so it never collides with its aggregate', () => {
    const { model } = scaffold(ALL);

    expect(node(model, 'lobby')?.type).toBe('aggregate');
    expect(node(model, 'lobbies')?.type).toBe('read-model');
  });

  it('creates no read-model for a table no client subscribes to', () => {
    const { model } = scaffold(ALL);
    expect(node(model, 'rate-limits')).toBeUndefined();
  });

  it('credits a component subscription to the screen that imports it', () => {
    const { model } = scaffold(ALL);

    // Both the useTable and the reducer call live in LoginPanel, not in Home.
    expect(targets(model, 'home', 'reads')).toEqual(['lobbies']);
    expect(targets(model, 'home', 'offers')).toEqual(['log-encounter']);
  });

  it('reads useReducer as a screen offering a command', () => {
    const { model } = scaffold(ALL);
    expect(targets(model, 'lobby-view', 'offers')).toEqual(['kill-encounter']);
  });

  it('stays silent on a codebase with no module', () => {
    const { model, counts } = scaffold([APP, HOME]);
    expect(counts.domain).toBe(0);
    expect(model.nodes.every(n => n.type === 'screen')).toBe(true);
  });
});

describe('react-router scaffold', () => {
  it('points implemented_by at the component, not the router', () => {
    const { model } = scaffold(ALL);

    expect(node(model, 'lobby-view')?.data?.implemented_by).toEqual([
      'client/src/pages/LobbyView.tsx',
    ]);
  });

  it('names the screen after its component rather than the path segment', () => {
    const { model } = scaffold([
      APP,
      HOME,
      LOBBY_VIEW,
      src(
        'client/src/AppEdit.tsx',
        `<Routes><Route path="/lobby/:code/edit" element={<LobbyEdit />} /></Routes>`
      ),
    ]);

    // The last segment alone would call this screen "edit".
    expect(node(model, 'lobby-edit')?.type).toBe('screen');
  });

  it('marks the root route as the entry screen', () => {
    const { model } = scaffold(ALL);

    expect(node(model, 'home')?.data?.entry).toBe(true);
    expect(node(model, 'lobby-view')?.data?.entry).toBeUndefined();
  });

  it('matches a navigate() with a substituted segment to its parameterised route', () => {
    const { model } = scaffold(ALL);

    // navigate('/lobby/ABC') against the route '/lobby/:code'.
    expect(targets(model, 'home', 'navigates-to')).toEqual(['lobby-view']);
  });

  it('skips a nested route whose path is relative to a parent', () => {
    const { model, notes } = scaffold([
      src(
        'client/src/App.tsx',
        `<Routes>
           <Route path="/" element={<Shell />}>
             <Route path="details" element={<Details />} />
           </Route>
         </Routes>`
      ),
    ]);

    expect(node(model, 'details')).toBeUndefined();
    expect(notes.some(n => n.includes('nested route'))).toBe(true);
  });
});
