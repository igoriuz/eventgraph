---
name: core-first
description: Build an app around a headless core (commands in, read-models out, I/O behind ports) with thin UI, CLI and agent shells, planned and checked with eventgraph. Use when starting an app or a new flow in a project whose CLAUDE.md says core-first, when a feature touches several flows or shared data, or when asked where logic belongs or what a change affects. Triggers on "core-first", "headless core", "new flow", "which flows does this affect", "Core bauen", "neuer Flow", "Seiteneffekte", "eventgraph". Not for UI-only work (build-screen).
---

# Core first

The domain of an app lives in one core. Every surface — SwiftUI, Compose, React,
a CLI, an agent tool — is a thin shell that sends commands and shows
read-models. The model in eventgraph is the map of that core: which command
changes what, which flows share a data source, which flow sets off another. The
map is written first, and the code follows it, so a change shows its reach
before it is made.

Concept and decisions behind this: `docs/core-concept.md` in the eventgraph repository
(this skill lives in its `skills/` folder).

**Running eventgraph.** `eventgraph <cmd>` below means the CLI from npm, pinned to the
minor version this skill was written against: `npx -y eventgraph-cli@0.5 <cmd>`. Check
`command -v eventgraph` first; a project may have it installed.

## References — read before writing code

- `references/architecture.md` — the house rules, where the authority sits,
  how each model node lands in code, CLI conventions. Read once per session.
- `references/stacks.md` — which stack for which target, and when there is no
  recipe yet.
- `references/swift.md` — package layout and a worked flow in Swift.
- `references/dart.md` — a pure-Dart core package inside a Flutter app.

## Start of a project

1. **Pick the row.** Two questions: is native UI (SwiftUI/Compose) required, and
   which platforms ship first? `references/stacks.md` maps the answer to a
   stack. Where the authority sits (device, server, both) is decided in the
   same breath — `references/architecture.md`. Both are the user's decisions
   if the project does not state them.
2. **Lay out the repo** as the stack recipe says: core library, store, CLI,
   app shell, tests, and `eventgraph/` beside them (`eventgraph init`).
3. **Say so in the project's `CLAUDE.md`:** "This app follows core-first
   (skill `core-first`). Done = `eventgraph check` and `eventgraph verify`
   clean, and a core- or CLI-level test per flow."
4. **Wire the checks** where the project runs its tests (CI or a `make check`):
   `eventgraph check`, `eventgraph verify`, the test suite.

## An existing app

Do not rewrite. Move one flow at a time behind the core, and keep the app
working after every commit.

1. **Find the owner of the state today** — a model object, repositories, view
   models. The core grows there.
2. **Give the core its own module without UI imports** (a SwiftPM package, a
   pure Dart package, a TS module). Opening the store, file paths, preferences
   and the clock come in as ports; a plugin like `path_provider` stays in the
   app.
3. **Introduce the interface for the first flows**: `Command`, `Outcome`,
   rejection codes. The old owner calls `core.handle` instead of changing
   state itself. Generic entry points (an `update { }` closure, a repository
   method any screen can call) shrink with every flow until they are gone.
4. **Add the CLI early**, reading and writing the same persisted format the app
   uses, so every moved flow can be driven and tested without the UI.
5. **Add a `cli` surface to the model.** The parity lane then lists every
   command the UI offers and the CLI does not: that list is the migration
   backlog. Mark what belongs to the UI for good with `ui_only: <reason>`
   (playback, a drag to reorder), not to silence the list.
6. **Side effects the owner performs today** (scheduling reminders, a Live
   Activity, notifications) become ports or shell reactions to the events in
   the outcome. They do not move into the core.
7. **Keep the existing storage** unless it blocks; state-stored is the rule,
   SQLite is not.
8. **No behaviour change while moving.** A move that changes what the user
   sees is two changes; do the move first.

Keep a friction log in the project while doing this: where model and code
disagreed, what `verify` missed, which boilerplate repeated per flow. It
decides whether eventgraph should generate the contract (concept release 3).

## The loop, per flow

One flow = one command and what follows from it. Run these in order; do not
start the code before the model is clean.

1. **Model it.** Add actor, command, events, the aggregate it writes, the
   read-models that change, the screen and the `cli` surface that offer it.
   Name the refusals in `rejects`, the external systems as `service` with
   `calls`. Prefer one `eventgraph apply` of a YAML fragment over many single
   `add` calls.
2. **Ask what it touches.** `eventgraph impact <command>` and, for every
   read-model or service the flow reuses, `impact <it>`. Everything listed is
   either changed on purpose or needs a look. Shared data shows up here — two
   flows reading the same read-model, a policy reacting to the new event.
3. **Close the gaps.** `eventgraph check --next 3` until clean. Silence a
   finding only with the flag the rule names and a real reason.
4. **Write the core.** Command type, handler (load → invariants → reject or
   write in one transaction → events), read-model queries, policy if one flow
   sets off another. I/O only through ports. See the stack recipe.
5. **Write the shells.** The CLI subcommand (named with the command id as a
   literal), then the screen. View state stays in the shell.
6. **Test.** At least one test per flow at core or CLI level: the happy path
   and each code in `rejects`. A policy gets a test that the first command's
   event leads to the second command's outcome.
7. **Point the model at the code.** `src:` on command, aggregate, read-model,
   policy, and on each surface. Then `eventgraph verify`.
8. **Done** when check, verify and the tests are green. Commit model and code
   together — the model is part of the change, not documentation after it.

## Judgment calls the rules cannot make

- **Is it a new command or a parameter of an existing one?** New command when
  the invariants or the events differ; a parameter when only the data does.
- **Policy or one handler?** One handler when the writes belong to one
  aggregate and must be atomic. A policy when the second step belongs to
  another aggregate, may fail on its own, or another flow also wants it.
- **New read-model or a query on an existing one?** A read-model per question a
  screen asks, not per screen. Two screens asking the same question share one.
- **Does this state belong in the core?** If losing it on app restart is fine
  and no other flow reads it, it is view state and stays in the shell.
- **A service or a port only?** Model a `service` when a flow depends on an
  outside system that can fail or change independently. Clock, IDs and logging
  are ports without a node.

## What not to do

- No logic in a shell beyond formatting and view state. If a screen computes
  something another surface also needs, it belongs in a read-model.
- No handler calling another handler; no screen issuing a second command after
  the first "to keep things in sync". That is a policy, and it goes in the model.
- No event sourcing unless history is the product. State lives in the store;
  events are in-process notifications.
- No framework or generator built for a single project. If the same boilerplate
  repeats in every flow, write it down in the project's handoff; generating it
  from the model is release 3 of the concept and needs evidence.
