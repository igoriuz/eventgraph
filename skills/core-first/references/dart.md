# Dart recipe (Flutter, device authority)

Worked example: Boxseat, a Flutter IPTV app, where favourites run through
`packages/boxseat_core` inside a 143k-line Flutter app — `puro dart test` in the
package, `puro flutter test` at the root, and `eventgraph check` / `verify` pass.
Copy from it rather than from memory. Verified 2026-11-17 with Flutter 3.50 /
Dart 3.14, Drift 2.35, sqlite3 3.9 (native assets), args 2.7. Trial notes and
friction log: `docs/plans/2026-11-17-core-first-trial.md` there.

## Layout

```
pubspec.yaml               the app; `workspace: [packages/<app>_core]`, depends on it by path
lib/                       the Flutter shell: screens, view models, plugin adapters
packages/<app>_core/       pure Dart — no package:flutter, no plugin, nothing from lib/
  pubspec.yaml             resolution: workspace; drift, sqlite3, path, args; dev: test, lints, build_runner, drift_dev
  lib/store.dart           export of the Drift database + stored enums
  lib/core.dart            export of ports and flows
  lib/src/
    ports.dart             KeyValueStore (+ MemoryKeyValueStore), one interface per outside system
    store/                 database.dart (+ .g.dart), migrations, stored enums
    <area>/contract.dart   sealed commands and events (id = the model's id)
    <area>/<area>_core.dart  handle(command): handlers, events stream, policies run
    <area>/policies.dart   event in, commands out
    <area>/read_models.dart  one query per question
    cli/<app>_cli.dart     runCli(args, out): one subcommand per command and read-model
  bin/<app>.dart           main → runCli(args, stdout)
  test/                    package:test, in-memory store; CLI tests call runCli in-process
test/architecture/core_package_test.dart   the package imports nothing from Flutter, plugins or lib/
eventgraph/                the model; src pointers resolve from the repo root
```

A **pub workspace** keeps one lockfile and one `flutter pub get`; the package
still runs its own `dart test`, and `flutter analyze` at the root covers it.
The architecture test is cheap; the real proof is that `dart test` compiles the
package at all (no `dart:ui` without Flutter).

## Moving the store in an existing app

The core needs the database, so the database moves into the package:

1. The database class takes an opened `QueryExecutor` (`AppDatabase(super.executor)`).
   The app opens its file with `path_provider` in a function of its own
   (`LazyDatabase` + `NativeDatabase.createInBackground`); tests pass
   `NativeDatabase.memory()`, the CLI `NativeDatabase(File(path))`.
2. `git mv` the database, its `.g.dart`, migrations and stored enums into
   `lib/src/store/`, export them from `lib/store.dart`, rewrite the app's imports
   mechanically (Boxseat: 126 files) and `dart fix --apply --code=unnecessary_import`.
   Run `build_runner` **in the package** and diff the regenerated `.g.dart` and a
   `drift_dev schema dump` against the old ones — both should be identical.
3. Keep `drift_dev` as a dev dependency of the app too when its migration tests
   use `SchemaVerifier`.

Preferences stay where they are (SharedPreferences) behind a port: the core
gets a `KeyValueStore` with synchronous reads (every implementation holds the
values in memory) and async writes; the app passes an adapter over
SharedPreferences, the CLI a JSON file next to the store, tests a map.

## The interface

```dart
sealed class FavoriteCommand { const FavoriteCommand(); String get id; }
final class ToggleFavorite extends FavoriteCommand {
  const ToggleFavorite(this.channelId, {required this.on});
  final int channelId; final bool on;
  @override String get id => 'toggle-favorite';
}
sealed class FavoriteEvent { const FavoriteEvent(); String get id; Map<String, Object?> toJson(); }
```

Exhaustive `switch` over the sealed types replaces the Swift enum cases. Add a
`Rejection` enum (`enum Rejection { notPositive('NOT_POSITIVE'), … }`) and a
sealed `Outcome` only when a command has a code in `rejects`; without one,
`handle` returns the events, and "nothing to do" (a row that is gone, a move
at either end) is an empty list, not a refusal.

## Handling a command

```dart
Future<List<FavoriteEvent>> handle(FavoriteCommand command) async {
  final produced = switch (command) {
    ToggleFavorite() => await _toggle(command),
    MoveFavorite() => await _move(command),
    ForgetFavoriteOrder() => await _forget(command),
  };
  final outcome = <FavoriteEvent>[];
  for (final event in produced) {
    outcome.add(event);
    _events.add(event);                       // StreamController.broadcast(sync: true)
    for (final next in policies.react(event)) outcome.addAll(await handle(next));
  }
  return outcome;
}
```

- **Events on a synchronous broadcast stream**: a listener has heard the event
  when `handle` returns, which is what the old `ChangeNotifier` code did
  (`await write(); notifyListeners();`). An adapter that used to deliver
  asynchronously keeps its own async `StreamController` and re-emits, so the
  app's timing does not change.
- Writes to two stores (Drift and preferences) cannot share a transaction: the
  second write is a policy with its own command, so its failure does not undo
  the first.
- Time and ids come in from ports (`package:clock` is fine: tests pin it).

## Read-models

A function per question over the store (`select` … `.get()`), returning Drift
row classes; `.watch()` where a screen observes it. In an existing app the
screens may compose a read-model in memory from several sources (a catalogue
cache, display filters): the core then owns the part it can answer, and the
CLI's read is that part — say so in its doc comment, and in the model keep the
app file in `src` beside the core's.

## The app side

The old owners become thin adapters with their old signatures, so screens and
view models do not change: a repository forwards to `core.handle` and maps the
core's events to its old `changes` stream; a `ChangeNotifier` listens to the
events and calls `notifyListeners`. DI builds one core and hands it to both.
Tests that built the old owners get a helper (`favoritesCore(db, prefs:)`) —
expect to touch every test that constructed them (Boxseat: 15 files).

## CLI

`package:args`, one `ArgParser.addCommand('toggle-favorite', …)` per command
and read-model: the literal is what `eventgraph verify` looks for. Global
`--store` (default `.<app>/store.sqlite`, must exist), `--json`, and a scope
option where the app has one (`--playlist`). Prints `{"events": [...]}` or the
read-model's value; exit 0, 2 with `{"rejected": "CODE"}`, 1 otherwise. Put the
logic in `runCli(args, StringSink out)` so tests run whole flows in-process;
`puro dart run bin/<app>.dart` builds sqlite3 through its native-assets hook
(about 1.5 s per call). It reads a copy of the app's real database as well.

## Tests

- `package:test` with an in-memory store and a `MemoryKeyValueStore`: the
  happy path asserting the events and the read-model; each code in `rejects`;
  per policy, that the first command's outcome holds the second's events and
  that running it again repeats nothing.
- A CLI test: temp dir, seed a store file through the database class, close it,
  then a sequence of `runCli` calls (toggle → move → list).
- In the app: the adapters' old tests keep passing; the format test and the
  architecture test cover the package.

## Model pointers

`src` on command, aggregate, event, read-model and policy → the core files; a
`cli` surface (`type: screen, kind: cli`) → the CLI file, with an `agent` actor
that `sees` it and `issues` its commands. In a large app the parity lane
lists every other UI command and read-model once the surface exists — that is
the migration backlog, not a finding to silence.

## Checks to wire

```sh
puro flutter analyze && puro flutter test \
  && (cd packages/<app>_core && puro dart test) \
  && npx -y eventgraph-cli@0.5 check && npx -y eventgraph-cli@0.5 verify
```
