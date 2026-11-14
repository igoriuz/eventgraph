# Handoff

Last updated: 2026-11-12

## Open points

### Claude next

Branch `headless-surfaces` (worktree `../eventgraph-wt/headless-surfaces`, pushed)
is implemented and reviewed but **not merged**. Fix these on the branch, then
merge. Igor agreed to this scope on 2026-11-11.

1. **Lane switches on too early.** `declaresHeadlessSurface`
   (`packages/core/src/rules/headless.ts:22`) is true as soon as any `cli`/`tool`
   node exists anywhere in the graph. Scaffolding a seed script with two
   commander commands into pkmn-soullink-tracker took it from 10 to 39 findings,
   27 of them meaningless parity warnings. Fix: switch on only once a `cli`/`tool`
   surface actually `offers` or `reads` something. Add a test "scaffolded,
   unwired cli stays silent". Optional: per context instead of graph-wide.
2. **Scaffold ids flip for same-named subcommands across files**
   (`packages/core/src/scaffold/headless.ts:80`). Two files registering `list`:
   the first by sort order gets `list-cli`. A later file sorting earlier takes
   that id, and existing edges silently point at the wrong node after
   `scaffold | apply`. Fix: collect names across all files first; a name that
   occurs in more than one file gets the file-stem prefix everywhere.
3. **Nested same-named subcommands in one file are dropped**
   (`scaffold/headless.ts:76`). `remote add` and `tag add` yield one `add-cli`;
   the dedup key is `path|kind|name`. Fix: keep both via `ids.claim`, or emit a
   note.
4. **Scaffold heuristic false positives** (`scaffold/headless.ts:34-39`):
   commented-out `.command('x')` and string contents become surfaces;
   `import type` from commander counts as an import; any quoted mention of the
   MCP SDK (even in a comment) counts; `db:migrate` becomes `dbmigrate-cli`
   because `kebab` deletes the colon. Misses: `require('commander/esm')`,
   `await import('commander')`, `.mts`/`.cts` files. Fix: a comment/string
   skipping helper in `scaffold/sources.ts` (`blockAt` already has the logic),
   and `:` → `-` in `kebab`.
5. **`kind` is never validated** (pre-existing). `kind: CLI` or `kind: mcp` is
   silently treated as an unknown surface and the lane stays off without a
   warning. `SURFACE_KINDS` in `rules/kit.ts` exists but is unused. Fix:
   `validate` warns on a `kind` outside `SURFACE_KINDS`.
6. **Rename the lane `headless` → `parity`** before it ships. `headless` is
   already the actor flag, and `check --lane headless` does not show
   `headless-rejection-lost` (that rule lives in the ux lane). The lane name
   becomes CLI and MCP API on release. Touches: `Lane` type, `LANE_RANK`, CLI
   `LANES`, MCP `z.enum`, preset comment, `Lanes.astro`, tests, both READMEs.
   Consider renaming the scaffold extractor value `headless` along with it or
   deliberately keeping it.
7. Fix the over-promising test name "is silenced by ui_only with a reason, and
   only with one" — `ui_only: true` silences too, as for every reason flag.
8. README corrections that follow from 3 and 4 (nesting loses a node; the
   import requirement is looser than stated).

9. Merging `main` into the branch conflicts in
   `packages/cli/src/commands/scaffold.ts` (the "recognised nothing" block
   gained an unread-languages line on main). Keep both.

Then: `pnpm build && npx vitest run && pnpm lint`, re-run `check --json` on
site/demo, pkmn-soullink-tracker, jetphrase, teeveebuddy and taimetrack against
main's dist (must stay byte-identical), merge `--no-ff` into `main`, push, remove
worktree and branch.

Separate branch afterwards — **MCP parity**:

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
  skipping is written three times in the scaffold; `scaffold()` in
  `scaffold/index.ts` repeats one block per extractor.

## State of `headless-surfaces`

Two commits on top of `cfc5540`:

- `b00acce` — surface kinds `cli` and `tool`; lane `headless` with rules
  `command-ui-only` and `read-model-ui-only`, silenced by `ui_only: <reason>`;
  new file `packages/core/src/rules/headless.ts`.
- `3bc9a5d` — scaffold reads commander subcommands and MCP SDK tool
  registrations as `cli`/`tool` surfaces (extractor `headless`); new file
  `packages/core/src/scaffold/headless.ts`.

Verified: build, 327 tests and `tsc` green; `check --json` byte-identical to
main on the five existing models listed above. Tests need `pnpm build` first.

Why it exists: the "headless core" architecture puts an app's domain logic
behind a command/query interface with UI, CLI, API and agent tools as equal
surfaces. The parity lane makes eventgraph enforce that an agent or test can
reach what the UI can.
