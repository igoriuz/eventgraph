# Handoff

Last updated: 2026-11-16

## Open points

### Claude next

- **Release 2 of the core concept** (`docs/core-concept.md`): build the Swift
  trial model-first with the `core-first` skill and keep a friction log (where
  model and code disagreed, what `verify` missed, which boilerplate repeated per
  flow). Starts once Igor names the project.

Released is 0.4.0 (tag `v0.4.0`), which is `main`. A release needs the
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

### Igor decides

- **Which project is the Swift trial** (core concept, decision 6: Apple only,
  device authority). Release 1 is done: the global skill `core-first`
  (`~/.claudes/skills/core-first`, with a compiled Swift example under
  `examples/swift-trips`) and eventgraph 0.4.0.

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

- From the maintenance pass of 2026-11-16: the `verify` action in the CLI
  (`packages/cli/src/commands/verify.ts`) is one function of CCN 21 printing
  three reports — split into one printer per report; CLI and MCP each decide
  what makes `verify` fail (sum of three issue lists) — one `verifyAll` in core
  returning `ok`. Also: when everything else is clean, `verify` returns early
  and never prints `unsearchable` callers or CLI surfaces (pre-existing for
  callers); an invalid `impact --depth` (NaN) now walks unbounded where 0.3.0
  returned nothing.

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
