import { describe, it, expect } from 'vitest';
import { scaffold } from '../scaffold/index.js';
import type { ScaffoldSource } from '../scaffold/sources.js';

function src(path: string, content: string): ScaffoldSource {
  return { path, content };
}

const ROUTER = src(
  'lib/core/routing/app_router.dart',
  `
  import 'package:app/features/home/presentation/home_screen.dart';
  class AppRouter {
    static GoRouter create() {
      return GoRouter(
        initialLocation: '/home',
        routes: [
          ShellRoute(
            builder: (context, state, child) => AppShell(child: child),
            routes: [
              GoRoute(path: '/home', name: 'home', builder: (c, s) => const HomeScreen()),
              GoRoute(path: '/live', name: 'live', builder: (c, s) => const LiveScreen()),
            ],
          ),
          GoRoute(
            path: '/settings',
            name: 'settings',
            builder: (c, s) => const OutsideShellFrame(child: SettingsScreen()),
          ),
          GoRoute(
            path: '/movie/:vodId',
            name: 'movie-detail',
            builder: (c, s) => OutsideShellFrame(child: MovieDetailScreen(vodId: 1)),
          ),
        ],
      );
    }
  }
`
);

const SCREENS = [
  src('lib/features/home/presentation/home_screen.dart', `
    import 'package:app/features/home/presentation/home_row.dart';
    class HomeScreen extends StatefulWidget {}
    void open() { context.pushNamed('settings'); }
  `),
  src('lib/features/home/presentation/home_row.dart', `
    class HomeRow extends StatelessWidget {}
    void tap() { context.push('/movie/12'); }
  `),
  src('lib/features/live/presentation/live_screen.dart', `class LiveScreen extends StatefulWidget {}`),
  src('lib/features/settings/presentation/settings_screen.dart', `
    class SettingsScreen extends StatefulWidget {}
    void go() { context.push(dynamicRoute); }
  `),
  src('lib/features/details/presentation/movie_detail_screen.dart', `class MovieDetailScreen extends StatefulWidget {}`),
  src('lib/core/routing/outside_shell_frame.dart', `class OutsideShellFrame extends StatelessWidget {}`),
  src('lib/core/routing/app_shell.dart', `class AppShell extends StatelessWidget {}`),
];

const DRIFT = src(
  'lib/core/storage/database.dart',
  `
  class Playlists extends Table { IntColumn get id => integer()(); }
  class WatchHistoryEntries extends Table { IntColumn get id => integer()(); }
  @DriftDatabase(tables: [Playlists, WatchHistoryEntries])
  class AppDatabase extends _$AppDatabase {}
`
);

const ALL = [ROUTER, ...SCREENS, DRIFT];

describe('flutter routes', () => {
  it('takes one screen per route in the table', () => {
    const { model } = scaffold(ALL, { only: ['screens'] });
    expect(model.nodes.map(n => n.id)).toEqual(['home', 'live', 'settings', 'movie-detail']);
  });

  it('points at the widget that implements the route, not the router', () => {
    const { model } = scaffold(ALL, { only: ['screens'] });
    expect(model.nodes.find(n => n.id === 'home')!.data).toMatchObject({
      implemented_by: ['lib/features/home/presentation/home_screen.dart'],
    });
  });

  it('sees past a wrapper widget to the screen it frames', () => {
    const { model } = scaffold(ALL, { only: ['screens'] });
    expect(model.nodes.find(n => n.id === 'settings')!.data).toMatchObject({
      implemented_by: ['lib/features/settings/presentation/settings_screen.dart'],
    });
    expect(model.nodes.find(n => n.id === 'movie-detail')!.data).toMatchObject({
      implemented_by: ['lib/features/details/presentation/movie_detail_screen.dart'],
    });
  });

  it('marks initialLocation as the entry screen', () => {
    const { model } = scaffold(ALL, { only: ['screens'] });
    expect(model.nodes.filter(n => n.data?.entry === true).map(n => n.id)).toEqual(['home']);
  });

  it('makes the routes inside a shell reach each other', () => {
    const { model } = scaffold(ALL, { only: ['screens'] });
    expect(model.edges).toContainEqual({ from: 'home', to: 'live', type: 'navigates-to' });
    expect(model.edges).toContainEqual({ from: 'live', to: 'home', type: 'navigates-to' });
  });

  it('resolves navigation given only a route name', () => {
    const { model } = scaffold(ALL, { only: ['screens'] });
    expect(model.edges).toContainEqual({ from: 'home', to: 'settings', type: 'navigates-to' });
  });

  it('matches a concrete path against its parameterised route, through a widget', () => {
    const { model, notes } = scaffold(ALL, { only: ['screens'] });
    expect(model.edges).toContainEqual({ from: 'home', to: 'movie-detail', type: 'navigates-to' });
    expect(notes.join(' ')).toMatch(/1 of them reached through a rendered widget/);
  });

  it('reports a route computed from data', () => {
    const { notes } = scaffold(ALL, { only: ['screens'] });
    expect(notes.join(' ')).toMatch(/1 navigation\(s\) target a computed route/);
  });

  it('stays silent on a project with no route table', () => {
    const { model } = scaffold([DRIFT], { only: ['screens'] });
    expect(model.nodes).toHaveLength(0);
  });
});

describe('drift tables', () => {
  it('reads a table class into a candidate aggregate', () => {
    const { model } = scaffold([DRIFT], { only: ['aggregates'] });
    expect(model.nodes.map(n => n.id)).toEqual(['playlist', 'watch-history-entry']);
  });

  it('does not mistake the database class for a table', () => {
    const { model } = scaffold([DRIFT], { only: ['aggregates'] });
    expect(model.nodes.map(n => n.id)).not.toContain('app-database');
  });
});
