# Handoff

Last updated: 2026-11-12

## Open points

### Claude next

**MCP parity** (own branch):

- Move the merge logic of `packages/cli/src/commands/apply.ts` into core so MCP
  can use it; add MCP tools for `apply`, `verify`, `scaffold`, `check --next`.

### Igor decides

- Whether to try the parity lane on a real app built (or to be built) around a
  headless core — the fastest way to see whether the rules hold up.

- **Trial project is Swift, model-first.** Scaffold has no Swift extractor and
  none is needed for a new project; it now names the languages it walks past
  (`unreadLanguages`, `unread` in `--json`). Proposed and not yet confirmed:
  extend `verify` so a `cli` surface that `offers` a command must mention the
  command's name in its own `src` (substring, like `rejects`) — the only
  language-neutral guard against the model claiming a subcommand that does not
  exist. Also to settle before the first line of code: project conventions
  (core first, CLI subcommand per command, `--json`, rejection codes, done =
  `check` + `verify` + a CLI test) and how state survives between CLI calls
  (persistent store or a script mode).

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
  trainer, offered nowhere), teeveebuddy 1 (`import-playlist`, offered only on
  the unreachable `import` screen, so it clears with the existing
  `screen-unreachable` finding).

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
- Maintenance, from the unread-languages change: the list of languages
  scaffold reads exists as `SOURCE_EXT` in core, as the `READ` string in the
  CLI and in the README (export one list from core); `scaffold/sources.ts`
  holds file collection, `blockAt`, id helpers and inflection in one file.
- Maintenance, not bugs: the lane list is written out in six places (export one
  `LANES` const from core); surface-kind properties are spread over five lists
  plus a hardcoded `'cli' || 'tool'` (one table per kind); comment/string
  skipping is written in `blockAt` and again in `blank` (both in
  `scaffold/sources.ts`), and by hand in other extractors; `scaffold()` in
  `scaffold/index.ts` repeats one block per extractor.

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

Known limits of the extractor, all stated in its header or the README: two
files with the same stem (`a/index.ts`, `b/index.ts`) registering the same
name are numbered in sort order, so those ids can still move when a third
such file appears; same-named nested subcommands in one file are numbered in
source order; a type-only import of commander counts as importing it,
deliberately.

Why it exists: the "headless core" architecture puts an app's domain logic
behind a command/query interface with UI, CLI, API and agent tools as equal
surfaces. The parity lane makes eventgraph enforce that an agent or test can
reach what the UI can.
