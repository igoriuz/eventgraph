# Handoff

Last updated: 2026-11-17

## Open points

### Claude next

- **Release 2 of the core concept: two trials**, each run in its own project
  with the handoff and start prompt in `docs/trials/` — `formox.md` (Swift,
  the whole app, done) and `teeveebuddy.md` (Flutter, favourites only, done).
  Both friction summaries are below; together they decide release 3 (contract
  generation) — see "Igor decides".
- **Formox trial done (2026-11-17).** Every Formox command goes through
  `Core.handle`; `AppModel` has no generic `update`; 25 commands are offered
  by the `formox` CLI, 3 are `ui_only` with a reason, the rest are issued by
  timers or policies. Every read-model is a core type the CLI prints. `check`
  reports no findings, `verify` is clean, `make test` green (125 core tests,
  CLI flow script, 32 app tests). Full log: Formox `docs/core-first-friction.md`.
  What it says for release 3:
  - **Boilerplate per command: 8 touch points** (`Command` case, dispatch
    arm, handler, `Event` cases, `Rejection` raw values, CLI subcommand of
    ~10 lines, `rejects`/`src` in the model, a gate comment per offering
    screen). Mechanical, but never the hard part: the cost was in judging
    events and refusals. The twelve workout steps are near-identical. Weak
    case for generating the contract on this trial alone; decide with
    teeveebuddy.
  - **Policies the code does in one write.** The model chains
    `report-pain` → policy → `exclude-exercise`, `session-finished` →
    `apply-progression` → `decide-next-loads`, `finish-after-last-set` →
    `finish-session`; the code is one atomic write each, and the handler
    emits both events. Three times the same shape: worth a rule or a
    modelling convention (a policy whose two commands write the same aggregate
    in the same transaction).
  - **Derived, not written.** `end-block` and the joint-swap policies have no
    write; the state is computed when read. The model cannot say "derived".
  - **`ui_only` commands that still emit events** (`pause-session`,
    `resume-session`): `check` accepts them; their events describe nothing.
  - **`verify` and gates.** Screens are held to every code of what they
    offer, also codes their own gate makes impossible: ~15 gate comments.
    Proposal: `unreachable: [CODE]` per offer. Refusals land in one shared
    handler (`AppModel.send`), which `verify` cannot point at.
  - **Read-model parity is invisible.** The core read-models are used by the
    CLI only; screens still compute from the log (e.g. muscle coverage).
    `verify` checks the `src` exists, not that the screen reads it.
  - **The CLI paid off at once:** it found a pre-existing bug (deleting the
    store failed under "Application Support", a percent-encoded path).
- **teeveebuddy trial done (2026-11-17).** Favourites go through a pure-Dart
  core (`packages/boxseat_core`: the Drift store moved in, `FavoritesCore.handle`,
  the order behind a key-value port, one policy) with a Dart CLI offering
  `toggle-favorite`, `move-favorite` and four read subcommands; state-stored,
  events are emitted, not kept. No visible change; analyze clean, 2489 app
  tests and 17 package tests green, `verify` clean (718 pointers), the trial's
  own `check` findings closed. Dart recipe: skill `references/dart.md`. Full
  log: teeveebuddy `docs/plans/2026-11-17-core-first-trial.md`. What it says
  for release 3:
  - **The parity lane is unusable for a partial migration.** With one `cli`
    surface, `check` reports 139 `command-ui-only` and 84
    `read-model-ui-only` — every UI node — and the trial's own were found
    only with `check --json | jq` on ids. Wanted: parity scoped to what a
    surface claims, or `check --only <ids>`; the full list stays the backlog.
  - **Composed read-models cannot be partly headless.** `home-channel-row` is
    favourites + recents + now/next; the core answers only the favourites
    part, yet the CLI `reads` the whole node. Recipe advice: split read-models
    by question (`favorite-channels` read by Home, Live, Guide and the CLI).
  - **Codes a caller cannot meet** (again, as in Formox): a `NOT_FAVORITE` on
    `move-favorite` is right for the CLI and impossible from the screen;
    worked around with event-less no-ops. Same fix: `unreachable: [CODE]`.
  - **Handling in a helper file.** `verify` reported `REFUSED` as unhandled on
    the player; it is handled in `record_action.dart`. Fixed by adding the
    file to `src`; the message could suggest exactly that. Formox's shared
    `AppModel.send` is the same shape.
  - **Undeclared reactions and second writers are invisible.** A stream
    subscription was a hidden policy; a backup restore and a playlist delete
    write the favourite order too. Only reading the code found them.
  - **Boilerplate: 6 places per command**, all derivable from the model's ids
    (command class + `id`, CLI `addCommand` + `case`, event class + `id` +
    `toJson`, `switch` arm). Evidence for generating the contract, not the
    handlers.
  - **A command's `src` changes meaning mid-migration** (issuing UI → core
    handler). A convention — command → handler, screen → UI — would make a
    half-migrated model readable.

Released is 0.4.1 (tag `v0.4.1`), which is `main`. A release needs the
versions raised in the four `package.json` files, `packages/cli/src/index.ts`
and `packages/mcp/src/server.ts`, then a tag `v*`; npm trusted publishing is
set up for all four packages.

What 0.4.0 changed for someone on 0.3.0:
- Node type `service` and edge `calls` (command → service) in the
  event-modeling preset, with the rules `service-call-unhandled` and
  `service-unused` (structure lane, warnings).
- `impact` follows `reads` and `calls` backwards: a changed read-model lists
  the screens and policies reading it, a changed service every command calling
  it. A screen reached that way is a leaf. Totals and risk are higher than on
  0.3.0 for the same model; "Upstream dependents" in the CLI is now
  "Upstream, leading here" and leaves out what is already affected.
- `verify`: screens, notifications and widgets that `offer` a command are held
  to its `rejects` like actors (headless surfaces are not, they pass codes on);
  codes match across spellings (`TOO_FAST`, `tooFast`, `TooFast`,
  `too-fast`); a `cli` surface must name every command it offers.
- JSON of `verify` (CLI `--json` and MCP): `contract.actors` is now
  `contract.callers`, `contract.issues[].actor` is `caller`; new `cli` block
  `{checked, issues[{surface, command, name}], unsearchable}`.

What 0.4.1 changed: `verifyAll` in core decides what fails `verify` for CLI
and MCP alike, and `verify --json` carries `ok`; `verify` warns about source it
could not search also when everything else is clean; `impact --depth` refuses
anything but a positive whole number; `check`, `verify`, `validate` and
`apply` no longer cut their output at 64 KiB when it goes through a pipe
(they exited before the pipe drained).

### Igor decides

- **Release 3 scope, after both trials.** Recommendation: generate the
  contract only — command and event types with their ids, rejection enums and
  the CLI subcommand names — from the model (Formox: 8 touch points per
  command, teeveebuddy: 6, all mechanical); handlers stay hand-written, the
  judgement was always there. Before it, two small rule changes both trials
  asked for: parity scoped to what a surface claims (or `check --only`), and
  `unreachable: [CODE]` per offer. Smaller: a `verify` hint to add the
  handling file to `src`; a modelling convention for policies written in one
  transaction and for derived state (Formox).
- **jetphrase: 13 `command-buried` warnings** since the rule was enabled in
  the preset on 2026-11-14. Most come from the model: the only `entry` screen
  is `trips.onboarding-welcome`, so every depth is measured through the
  onboarding funnel; marking `learning.dashboard` as `entry` too should clear
  those (untried). What is then left (`register-account`, `sign-in` behind
  five onboarding screens) is intended — accept it with `buried: <reason>` on
  the command.
- **Open findings from `command-unoffered` in other projects** (rule merged
  2026-11-14; counts offers on reachable screens and on endpoints, not on
  notifications or widgets): pkmn-soullink-tracker 4 (`log-failed-encounter`,
  `delete-encounter`, `mark-failed`, `update-nickname` — issued by the
  trainer, offered nowhere). teeveebuddy no longer shows one on 0.4.1
  (2026-11-17); its open findings are in `docs/trials/teeveebuddy.md`.

### Later on purpose


- Inferring `issues`/`sees` when exactly one non-headless actor exists
  (Formox trial: 22 + 19 edges of boilerplate). Not built: it saves typing
  only, and implicit edges make the model say less than it reads.
- `command-no-feedback` counts as satisfied when only an agent tool reads the
  outcome, even if a human issued the command. Left as is until a real model
  gets it wrong.
- Generating the core contract (command types, rejection codes, stubs) from the
  model. Changes what the product is; only after the parity lane and scaffold
  have proven themselves on a real project.
- Scaling features for large projects, by expected value: `check --baseline`;
  `check --since <git-ref>` and graph diff (same finding comparison as
  baseline); reverse drift (scaffold vs. model as a check); `check --context`
  and cross-context rules; more scaffold sources (Kotlin/Ktor, Swift, Godot)
  per concrete project only.
- Maintenance, not bugs: the list of languages scaffold reads exists as
  `SOURCE_EXT` in core, as the `READ` string in the CLI, in an MCP tool
  description and in the README (export one list from core); surface-kind
  properties are spread over five lists plus a hardcoded `'cli' || 'tool'`
  (one table per kind); `scaffold()` in `scaffold/index.ts` repeats one block
  per extractor; `presetsDir` is written once in the CLI and once in MCP;
  `extractSpacetime` (CCN 40) and three other extractors are over the
  complexity limit.
- From the review of 2026-11-14, left as they are: the MCP server exits at
  startup on a model file that does not parse, so such a file cannot be
  repaired through it; `command-buried` still reports a command four screens
  deep that a `cli` also offers; apply stages its files and moves them into
  place, which narrows a failed write to one context but is not a transaction
  across several; a CLI and an MCP server writing at the same moment are
  unguarded.

## The parity lane (merged 2026-11-14, unreleased)

Surface kinds `cli` and `tool`; lane `parity` (`packages/core/src/rules/parity.ts`)
with `command-ui-only` and `read-model-ui-only`, silenced by `ui_only: <reason>`;
scaffold extractor `headless` (`packages/core/src/scaffold/headless.ts`) reads
commander subcommands and MCP SDK tool registrations as `cli`/`tool` surfaces.
The extractor kept its name on purpose: it finds headless surfaces, and only
the lane collided with the `headless` actor flag.

The lane switches on once a `cli` or `tool` surface offers or reads something,
graph-wide. `validate` rejects a `kind` outside `SURFACE_KINDS` (an error —
`validate` has no warnings). `command-unoffered` counts offers on `cli` and
`tool` like those on endpoints.

Known limits of the extractor, all stated in its header or the README:
same-named nested subcommands in one file are numbered in source order; a
type-only import of commander counts as importing it, deliberately; a name
registered in several files is prefixed with file name and, where those match,
directory, so a prefix only changes when a new file collides with an existing
one on both; `blank` tells a regex literal from a division by what precedes
it, which JSX text can fool within one line.

Why it exists: the "headless core" architecture puts an app's domain logic
behind a command/query interface with UI, CLI, API and agent tools as equal
surfaces. The parity lane makes eventgraph enforce that an agent or test can
reach what the UI can.
