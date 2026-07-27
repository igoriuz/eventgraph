import { describe, it, expect } from 'vitest';
import { scaffold } from '../scaffold/index.js';
import { kebab, singularise } from '../scaffold/sources.js';
import type { ScaffoldSource } from '../scaffold/sources.js';

function src(path: string, content: string): ScaffoldSource {
  return { path, content };
}

const ROUTES = src(
  'backend/src/routes/trips.ts',
  `
  export function tripRoutes(db) {
    return async (app) => {
      app.post<{ Body: CreateBody }>('/trips', { schema, preHandler: [auth] }, async (request, reply) => {
        return reply.code(201).send({})
      })
      app.get('/trips/active', { preHandler: [auth] }, async (request, reply) => {})
      app.patch<{ Params: { id: string } }>('/trips/:id', { schema }, async (request, reply) => {})
      app.post('/trips/:id/complete', async (request, reply) => {})
    }
  }
`
);

const CLIENT = src(
  'mobile/src/api/trips.ts',
  `
  export async function createTrip(opts) {
    const { data } = await api.post('/trips', opts)
    return data
  }
  export async function getActiveTrip() {
    return (await api.get('/trips/active')).data
  }
`
);

const SCHEMA = src(
  'backend/src/db/schema.ts',
  `
  export const users = sqliteTable('users', { id: text('id') })
  export const trips = sqliteTable('trips', { id: text('id') })
  export const confidenceScores = sqliteTable('confidence_scores', {})
  export const migrations = sqliteTable('migrations', {})
`
);

const APP_FILES = [
  src('mobile/app/index.tsx', `return <Redirect href="/main/dashboard" />`),
  src('mobile/app/_layout.tsx', `export default function Layout() {}`),
  src('mobile/app/(main)/dashboard.tsx', `router.push('/main/lesson/roleplay?scenarioId=1')`),
  src('mobile/app/(main)/lesson/roleplay.tsx', `router.back()`),
  src('mobile/app/(onboarding)/index.tsx', `router.push('/onboarding/destination')`),
  src('mobile/app/(onboarding)/destination.tsx', `router.push({ pathname: '/onboarding/date' })`),
  src('mobile/app/(onboarding)/date.tsx', `<Link href="/main/dashboard">go</Link>`),
];

describe('endpoint extraction', () => {
  it('finds route registrations and names them after the path', () => {
    const { model } = scaffold([ROUTES], { only: ['endpoints'] });
    expect(model.nodes.map(n => n.id).sort()).toEqual([
      'trips-complete-endpoint',
      'trips-active-endpoint',
      'trips-endpoint',
    ].sort());
  });

  it('marks them as backend surfaces pointing at their file', () => {
    const { model } = scaffold([ROUTES], { only: ['endpoints'] });
    const node = model.nodes.find(n => n.id === 'trips-endpoint')!;
    expect(node.data).toMatchObject({
      kind: 'endpoint',
      implemented_by: ['backend/src/routes/trips.ts'],
      status: 'implemented',
    });
  });

  it('collapses a resource into one surface and names every call on it', () => {
    const { model } = scaffold([ROUTES], { only: ['endpoints'] });
    expect(model.nodes.find(n => n.id === 'trips-endpoint')!.label).toBe('POST /trips, PATCH /trips/:id');
  });

  it('keeps an action under a resource as its own surface', () => {
    const { model } = scaffold([ROUTES], { only: ['endpoints'] });
    expect(model.nodes.find(n => n.id === 'trips-complete-endpoint')!.label).toBe('POST /trips/:id/complete');
  });

  it('ignores a client call to the same path, which binds no handler', () => {
    const { model, notes } = scaffold([ROUTES, CLIENT], { only: ['endpoints'] });
    expect(model.nodes).toHaveLength(3);
    expect(notes.join(' ')).toMatch(/2 call\(s\).*read as clients/);
  });

  it('finds nothing in a file that only calls out', () => {
    expect(scaffold([CLIENT], { only: ['endpoints'] }).model.nodes).toHaveLength(0);
  });

  const labels = (content: string) =>
    scaffold([{ path: 'server/routes.ts', content }], { only: ['endpoints'] })
      .model.nodes.map(n => n.label);

  it('binds a handler passed by name, not only one written inline', () => {
    // The ordinary shape once handlers live in their own module. Requiring an
    // inline arrow dropped every one of these without a word.
    expect(labels(`router.get('/health', healthHandler);`)).toEqual(['GET /health']);
    expect(labels(`app.get('/orders', { schema }, listOrders);`)).toEqual(['GET /orders']);
  });

  it('reads a route that follows a statement with no semicolon', () => {
    expect(labels(`const a = 1\napp.get('/things', listThings)\n`)).toEqual(['GET /things']);
  });

  it('is not derailed by an apostrophe in a comment', () => {
    expect(labels(`app.get('/profile', /* the user's profile */ (req) => 1);`)).toEqual([
      'GET /profile',
    ]);
    expect(labels(`// don't cache\napp.get('/health', healthHandler);`)).toEqual(['GET /health']);
  });

  it('still reads a call feeding a value as a client, however it is written', () => {
    expect(labels(`const res = await api.get('/trips');`)).toEqual([]);
    expect(labels(`function f() { return api.get('/trips'); }`)).toEqual([]);
    expect(labels(`const c = { list: () => api.get('/trips') };`)).toEqual([]);
    expect(labels(`api.post('/auth/signup', { email, password });`)).toEqual([]);
  });
});

describe('screen extraction', () => {
  it('takes one screen per route file, skipping layouts', () => {
    const { model } = scaffold(APP_FILES, { only: ['screens'] });
    expect(model.nodes.map(n => n.id)).toEqual([
      'entry',
      'dashboard',
      'roleplay',
      'onboarding',
      'destination',
      'date',
    ]);
  });

  it('marks the root route as the entry point, not a top-level sibling', () => {
    const { model } = scaffold(APP_FILES, { only: ['screens'] });
    const entries = model.nodes.filter(n => n.data?.entry === true);
    expect(entries.map(n => n.id)).toEqual(['entry']);
  });

  it('resolves navigation across route groups and query strings', () => {
    const { model } = scaffold(APP_FILES, { only: ['screens'] });
    expect(model.edges).toContainEqual({ from: 'entry', to: 'dashboard', type: 'navigates-to' });
    expect(model.edges).toContainEqual({ from: 'dashboard', to: 'roleplay', type: 'navigates-to' });
  });

  it('reads a pathname object and a Link href as navigation', () => {
    const { model } = scaffold(APP_FILES, { only: ['screens'] });
    expect(model.edges).toContainEqual({ from: 'destination', to: 'date', type: 'navigates-to' });
    expect(model.edges).toContainEqual({ from: 'date', to: 'dashboard', type: 'navigates-to' });
  });

  it('drops a navigation to a route that has no file', () => {
    const { model } = scaffold([src('mobile/app/index.tsx', `router.push('/nowhere')`)], {
      only: ['screens'],
    });
    expect(model.edges).toHaveLength(0);
  });

  it('does not emit a screen navigating to itself', () => {
    const { model } = scaffold([src('mobile/app/index.tsx', `router.replace('/')`)], {
      only: ['screens'],
    });
    expect(model.edges).toHaveLength(0);
  });
});

describe('navigation beyond the call site', () => {
  const TABS = [
    src('app/(tabs)/_layout.tsx', `import TutorialOverlay from '../../src/components/TutorialOverlay'
      export default () => <Tabs><Tabs.Screen name="week" /><Tabs.Screen name="month" /><TutorialOverlay /></Tabs>`),
    src('app/(tabs)/week.tsx', `export default function Week() {}`),
    src('app/(tabs)/month.tsx', `router.push({ pathname: '/day-detail' })`),
    src('app/day-detail.tsx', `router.back()`),
    src('src/components/TutorialOverlay.tsx', `router.replace('/(tabs)/week')`),
  ];

  it('makes the screens under a tab layout mutually reachable', () => {
    const { model } = scaffold(TABS, { only: ['screens'] });
    expect(model.edges).toContainEqual({ from: 'week', to: 'month', type: 'navigates-to' });
    expect(model.edges).toContainEqual({ from: 'month', to: 'week', type: 'navigates-to' });
  });

  it('attributes a layout component to the screens beneath it', () => {
    const { model, notes } = scaffold(TABS, { only: ['screens'] });
    expect(model.edges).toContainEqual({ from: 'month', to: 'week', type: 'navigates-to' });
    expect(notes.join(' ')).toMatch(/reached through a rendered component/);
  });

  it('follows a screen into the components it renders', () => {
    const model = scaffold(
      [
        src('app/home.tsx', `import Card from '../src/Card'`),
        src('app/detail.tsx', `export default function D() {}`),
        src('src/Card.tsx', `router.push('/detail')`),
      ],
      { only: ['screens'] }
    ).model;
    expect(model.edges).toContainEqual({ from: 'home', to: 'detail', type: 'navigates-to' });
  });

  it('does not hand one screen its neighbour navigation', () => {
    const model = scaffold(
      [
        src('app/a.tsx', `import b from './b'`),
        src('app/b.tsx', `router.push('/c')`),
        src('app/c.tsx', `export default function C() {}`),
      ],
      { only: ['screens'] }
    ).model;
    expect(model.edges).toEqual([{ from: 'b', to: 'c', type: 'navigates-to' }]);
  });

  it('reports a route computed from data rather than dropping it', () => {
    const { notes } = scaffold(
      [src('app/settings.tsx', `router.push(row.route as any)`), src('app/other.tsx', `//`)],
      { only: ['screens'] }
    );
    expect(notes.join(' ')).toMatch(/1 navigation\(s\) target a computed route/);
  });

  it('reports a literal target with no route file', () => {
    const { notes } = scaffold(
      [src('app/index.tsx', `router.push('/nowhere')`), src('app/other.tsx', `//`)],
      { only: ['screens'] }
    );
    expect(notes.join(' ')).toMatch(/point at a path with no route file/);
  });
});

describe('aggregate extraction', () => {
  it('takes one aggregate per table, singularised', () => {
    const { model } = scaffold([SCHEMA], { only: ['aggregates'] });
    expect(model.nodes.map(n => n.id)).toEqual(['user', 'trip', 'confidence-score']);
  });

  it('leaves out infrastructure tables', () => {
    const { notes } = scaffold([SCHEMA], { only: ['aggregates'] });
    expect(notes.join(' ')).toMatch(/1 table\(s\) skipped as infrastructure/);
  });

  it('reads raw DDL, which a local-first app carries instead of an ORM', () => {
    const raw = src(
      'src/db/schema.ts',
      "export const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS work_days (id TEXT);\nCREATE TABLE settings (k TEXT);`"
    );
    const { model, notes } = scaffold([raw], { only: ['aggregates'] });
    expect(model.nodes.map(n => n.id)).toEqual(['work-day', 'setting']);
    expect(notes.join(' ')).toMatch(/via sql/);
  });

  it('says the names are guessed rather than known', () => {
    const { notes } = scaffold([SCHEMA], { only: ['aggregates'] });
    expect(notes.join(' ')).toMatch(/candidate aggregate/);
  });
});

describe('scaffold', () => {
  it('never guesses commands, events or policies', () => {
    const { model } = scaffold([ROUTES, SCHEMA, ...APP_FILES]);
    expect([...new Set(model.nodes.map(n => n.type))].sort()).toEqual(['aggregate', 'screen']);
  });

  it('keeps ids unique across extractors', () => {
    const { model } = scaffold([ROUTES, SCHEMA, ...APP_FILES]);
    const ids = model.nodes.map(n => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces the same model on a second run', () => {
    const once = scaffold([ROUTES, SCHEMA, ...APP_FILES]);
    const twice = scaffold([ROUTES, SCHEMA, ...APP_FILES]);
    expect(twice.model).toEqual(once.model);
  });

  it('counts what each extractor contributed', () => {
    const { counts } = scaffold([ROUTES, SCHEMA, ...APP_FILES]);
    expect(counts).toEqual({ endpoints: 3, screens: 6, aggregates: 3, domain: 0 });
  });

  it('runs only the extractors asked for', () => {
    const { counts } = scaffold([ROUTES, SCHEMA, ...APP_FILES], { only: ['aggregates'] });
    expect(counts).toEqual({ endpoints: 0, screens: 0, aggregates: 3, domain: 0 });
  });
});

describe('naming helpers', () => {
  it('kebabs camel case and separators alike', () => {
    expect(kebab('confidence_scores')).toBe('confidence-scores');
    expect(kebab('placeOrder')).toBe('place-order');
  });

  it('singularises plurals without mangling words that end in s', () => {
    expect(singularise('trips')).toBe('trip');
    expect(singularise('entries')).toBe('entry');
    expect(singularise('status')).toBe('status');
    expect(singularise('address')).toBe('address');
  });
});
