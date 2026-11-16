# Handoff: core-first trial in Formox, 2026-11-17

Igor chose Formox (`~/Private/formox`) on 2026-11-17 as the first trial of the
core concept (`docs/core-concept.md`, release 2): an existing native iOS app
moved onto the core-first architecture, using the `core-first` skill and its
section "An existing app". It is the concept's row "Apple only, device
authority".

## Open points

**Next session** (in `~/Private/formox`, in its own worktree)
- [ ] **Carry this over (S).** Copy the open points below into Formox's
  `docs/handoff.md` under "Claude next", with a pointer to this file. Switch the
  handoff's eventgraph commands from `eventgraph-cli@0.3` to `@0.4` and run
  `check` and `verify` once on 0.4 (new: `service` rules, screens held to
  rejection codes, `impact` follows readers).
- [ ] **Saved data first (S, recommended before the core).** The pending item in
  Formox's handoff: drop the `decodeIfPresent` fallbacks, add a schema version,
  move `lastLogged`/`restStartedAt` into the `.resting` phase. Before 1.0 no
  backward compatibility is needed (Igor, 2026-11-16), and the store port below
  then wraps the final format.
- [ ] **Core seam (M).** In `Packages/FormoxKit`: `Command`, `Outcome`,
  `Rejection` and `Core.handle` for the first three commands, chosen to cover
  three shapes — `accept-plan` (creates the log), `report-pain` (changes it),
  `end-workout-early` (closes a session). Ports: a `LogStore` (load, save,
  delete; the JSON implementation moves from `Formox/App/StateFile.swift` into
  the package so the CLI shares it) and a `Clock`. `AppModel` calls
  `core.handle` for these three; its generic `update { }` stays for the rest
  for now.
- [ ] **CLI (S).** Executable target `formox` in FormoxKit with
  swift-argument-parser: `--store` (default `.formox/training.json`), `--json`,
  one subcommand per moved command named with the command id as a literal, plus
  read subcommands for `todays-session`, `active-session`, `next-loads`.
  `scripts/cli-test.sh` runs onboarding → pain report → end as CLI calls. Add
  it to `make test`.
- [ ] **Model (S).** A `formox-cli` surface (`kind: cli`, `src` at the CLI
  target) offering what the CLI has. `check` then reports every other command
  as `command-ui-only`: that is the backlog.
- [ ] **Move the rest flow by flow (L).** Onboarding and plan, settings and
  reminders, block and sidequests, then the workout last — it is the largest
  (`WorkoutSession` is already a state machine; `WorkoutModel` shrinks to view
  state plus the Live Activity mirror). Each move: one commit, a core-level test
  per command (happy path and each code in `rejects`), the CLI subcommand, the
  `src` pointers, `verify`.
- [ ] **Side effects out of `AppModel.save`.** `ReminderScheduler`,
  `RestNotification` and `WorkoutActivityController` stay in the app and react
  to the events in an `Outcome`; nothing in the core schedules or notifies.
- [ ] **Friction log** in Formox `docs/core-first-friction.md`, one line per
  disagreement between model and code, check or verify gap, repeated
  boilerplate. When done, a summary into eventgraph's `docs/HANDOFF.md`.

**Done when** every one of the 35 commands goes through `Core.handle`,
`AppModel` has no generic `update`, the parity lane is clean (or `ui_only`
with a reason), `make test` is green, `eventgraph check` and `verify` are
clean, and the friction log is written.

## State (measured 2026-11-17, read, not run)

- Swift 6 strict concurrency, iOS 27, XcodeGen (`project.yml`), warnings as
  errors, SwiftLint strict. `make test` = lint + `swift test` in FormoxKit +
  app tests in the simulator.
- Domain already sits in `Packages/FormoxKit` (product `TrainingCore`):
  `TrainingLog` is the persisted state, `WorkoutSession` a state machine with
  `handle(_:at:)`, decisions in `LoadDecisions`, tests on the host. Time is
  passed in, not read inside — the clock port is half there.
- `AppModel` (`Formox/App/AppModel.swift`, 127 lines) owns the log, saves to
  `training.json` through `StateFile`, and changes it through `update { }`
  closures and `WorkoutModel` callbacks; reminders are rescheduled inside
  `save`.
- eventgraph model `eventgraph/`: 120 nodes, 35 commands, 17 read-models,
  `check` and `verify` clean on 0.3. No `cli` surface yet, so the parity lane
  is silent.

## Do not

- Change behaviour or UI while moving. Igor's device-check list in Formox's
  handoff is long and open; a move must be invisible to it.
- Switch the store to GRDB or SQLite. The JSON file is state-stored, which is
  all the concept asks.
- Put OS frameworks (UserNotifications, ActivityKit) into FormoxKit.

## Context that is nowhere else

- Formox fits the trial cheaply because the domain package exists; what the
  trial tests is the interface (commands, outcome, CLI, parity), not the
  extraction of logic.
- eventgraph 0.4.1 has `verify` warnings for unsearchable sources and the
  stricter `impact --depth`; use it, not 0.4.0.

## Start prompt

> Work in ~/Private/formox. Read ~/Private/eventgraph/docs/trials/formox.md and
> load the core-first skill. Start with the first open point (carry the trial
> into Formox's docs/handoff.md and move eventgraph to 0.4), then the saved-data
> cleanup, then the core seam with accept-plan, report-pain and
> end-workout-early. No behaviour or UI change while moving.
