# Handoff

Last updated: 2026-11-12

## Open points

### Claude next

Nothing queued. Released is 0.3.0 (tag `v0.3.0`), which is `main`. A release
needs the versions raised in the four `package.json` files,
`packages/cli/src/index.ts` and `packages/mcp/src/server.ts`, then a tag `v*`;
npm trusted publishing is set up for all four packages.

What 0.3.0 changed for someone on 0.2.0:
- MCP writes answer with `status` (`applied`, `planned`, `proposed`,
  `refused`, `invalid`) instead of `success`.
- `eventgraph_add_node` refuses an id that exists and, like `add_edge`, a
  change that leaves the model invalid; `eventgraph_init_context` obeys
  `agent.write` and no longer empties an existing context.
- Context names and node ids must be plain names (letters, digits, `-`, `_`).
- `validate` rejects an unknown surface `kind`; `apply` therefore refuses it.
- A merge with `apply` keeps the comments in the file.
- `verify` resolves pointers from the project directory itself when
  `eventgraph.yaml` is not inside a directory named `eventgraph`.
- New rules in the preset: `command-unoffered`, `command-buried`, and the
  parity lane.

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
