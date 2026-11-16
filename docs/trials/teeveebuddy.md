# Handoff: core-first trial in Boxseat (teeveebuddy), 2026-11-17

Igor chose teeveebuddy (`~/Private/teeveebuddy`, the app is called Boxseat) on
2026-11-17 as the second trial of the core concept (`docs/core-concept.md`,
release 2). It is the concept's row "All platforms, one UI toolkit"
(Flutter/Dart), in a large existing app — so the trial is deliberately narrow:
one feature area behind a pure-Dart core with a Dart CLI, and the Dart recipe
for the `core-first` skill. Moving the whole app is not the goal.

## Open points

**Next session** (in `~/Private/teeveebuddy`, in its own worktree)
- [ ] **Carry this over (S).** A plan `docs/plans/2026-11-17-core-first-trial.md`
  from this file, and one entry in its `docs/handoff.md` pointing at it.
  Move the eventgraph commands to `eventgraph-cli@0.4` and run `check` and
  `verify` once on 0.4. `verify` on 0.4.1 reports one finding the old version
  could not see: the `player` screen offers `start-recording`, whose
  `rejects` lists `REFUSED`, and the player's source never mentions it. Check
  whether a refused recording shows anything on the player; fix the code, or
  the model if `REFUSED` is handled elsewhere.
- [ ] **Core package (M).** `packages/boxseat_core`, pure Dart: no
  `package:flutter`, no plugins. Two couplings to cut first:
  - `lib/core/storage/database.dart` opens the file through `path_provider`
    (a Flutter plugin). The database class takes an opened executor instead;
    the app passes `NativeDatabase` on its path, the CLI and tests a file or
    `NativeDatabase.memory()`.
  - `lib/features/favorites/data/favorite_order.dart` keeps the order in
    SharedPreferences and imports `flutter/foundation`. It goes behind a
    key-value port; the app implements it with SharedPreferences, the CLI with a
    JSON file next to the store.
  Extend `test/architecture/` with a test that the package imports nothing
  from Flutter or from `lib/`.
- [ ] **Favourites through the core (M).** Commands `toggle-favorite`,
  `move-favorite`; read-models `favorites-list`, `home-channel-row`,
  `my-list-row`, `live-lineup` (the favourites part). One toggle reaches seven
  read-models (`eventgraph impact toggle-favorite`), which is the shared-data
  case the concept is about. `FavoritesRepository` and `FavoriteOrder` delegate
  to the core; screens and view models do not change.
- [ ] **Dart CLI (S).** `packages/boxseat_core/bin/boxseat.dart`:
  `--store <sqlite>`, `--json`, subcommands named with the command ids as
  literals, plus read subcommands for the four read-models. A CLI-level test
  runs toggle → move → list against a temporary store.
- [ ] **Model (S).** A `boxseat-cli` surface (`kind: cli`) offering the two
  commands and reading the four read-models, `src` on the new core files.
  Expect the parity lane to report every other UI command and read-model in
  the app — 139 `command-ui-only` and 87 `read-model-ui-only`, measured on a
  copy of the model with this surface added — because the lane switches on
  graph-wide. Do not silence them with
  `ui_only`; filter the trial's own findings (`check --json` and the favourite
  ids) and log the noise as friction — it is the first finding for eventgraph.
- [ ] **Second slice, optional (M).** Playlist sync with the Xtream provider as
  a `service` with `calls` and a failure path — tests the service rules on
  real code. Only if the first slice went smoothly.
- [ ] **Dart recipe (S).** Write `references/dart.md` in the `core-first`
  skill (`~/.claudes/skills/core-first`) from what worked, in the shape of
  `swift.md`, and add it to `references/stacks.md`.
- [ ] **Friction log** in the plan file; a summary into eventgraph's
  `docs/HANDOFF.md` at the end.

**Done when** favourites go only through the core, the CLI drives them against
a store file, `puro flutter analyze` and `puro flutter test` are green
(architecture and format tests included), `eventgraph verify` is clean, the
trial's own `check` findings are closed, and the Dart recipe and friction log
exist.

## State (measured 2026-11-17, read, not run)

- Flutter 3.50 via puro (`puro flutter …`, never the bare `flutter`), Drift
  (SQLite, schema v12), get_it lazy singletons, feature-first
  `lib/features/<f>/{data,domain,presentation}`, view models as
  `ChangeNotifier`. 143k lines of Dart, about 2,500 tests.
- Architecture tests: `core` imports nothing from `features/` or `app/`;
  feature → feature imports have an allowlist that may only shrink; every
  hand-written file must be formatted.
- eventgraph model `eventgraph/`: 681 nodes (216 commands, 90 read-models, 52
  screens). On 0.4.1 (run 2026-11-17): `check` one error,
  `recording-index-write-failed` has no consumer (`event-no-consumer`);
  `verify` 713 pointers resolve, one unhandled rejection (`REFUSED` on the
  player, above).
- The main checkout had an uncommitted change to `.claude/settings.json` on
  2026-11-17 — not part of this work.

## Do not

- Add a feature → feature import edge (the module test forbids it) or change the
  Drift schema without the migration procedure in its `CLAUDE.md`.
- Change what the user sees on any form factor. The device-check list in its
  handoff is long and open.
- Install builds on the parents' Fire TV sticks (`192.168.79.26`, `.32`) or
  touch them without asking.

## Context that is nowhere else

- Narrow on purpose: the question is whether core-first holds in a large app
  and on the Dart row, not to move 216 commands.
- Favourites were picked because one command feeds seven read-models across
  Home, Live, Guide and Search, and because they touch both Drift and
  SharedPreferences — the two couplings any later slice will meet too.

## Start prompt

> Work in ~/Private/teeveebuddy. Read ~/Private/eventgraph/docs/trials/teeveebuddy.md
> and load the core-first skill. Start with the first open point (the plan file
> and the handoff entry, eventgraph 0.4), then cut the two couplings
> (path_provider in the database, SharedPreferences in favourite order) behind
> ports, then favourites through a pure-Dart core with a CLI. No change the user
> can see; puro for every Flutter command.
