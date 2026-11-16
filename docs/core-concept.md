# Concept: a headless core for future apps, planned with eventgraph

Status: draft for decision, 2026-11-16. Reviewed by an independent advisor the
same day; its findings are worked in (see the end).

## Goal

Future apps (web or mobile) are built around one **core** that holds every flow:
commands in, read-models out, I/O behind ports the platform supplies. The UI on
each platform is a thin shell over it, and so are a CLI and an agent tool.
Shared data sources and the effects one flow has on another are written down
where they can be queried, so a change shows its reach before it is made.

What is different afterwards: a new app starts from a model and a fixed set of
architecture rules instead of from screens; adding a platform *on the same
language family* means writing a shell, not porting logic; and an agent can
build and test a flow through the CLI without clicking.

## Where we are

eventgraph 0.3.0 already covers much of the planning half:

- **Vocabulary.** actor, command, event, aggregate, invariant, read-model,
  policy, screen (kinds `screen`, `endpoint`, `cli`, `tool`, …), decision,
  question — the vocabulary of the core below.
- **Shared data.** One aggregate feeding several read-models, one read-model read
  by several screens, are plain edges. `slice <event>` shows one flow.
- **Side effects between flows.** A policy (event → command) is the modelled way
  one flow sets off another, and `check` reports half-wired ones.
- **Headless parity.** The parity lane reports a command or read-model only the
  UI can reach — the guard for "CLI and agent are equal surfaces".

Weaker than it looks, read from the code:

- **`impact` follows outgoing edges only** and goes one step upstream
  (`packages/core/src/impact.ts`). `reads` runs screen → read-model, so the
  screens that show a changed read-model are missing from the result — in the
  example below `report-screen` does not appear. "Who depends on this?" is not
  answered yet.
- **`verify` checks that `src` files exist**, not symbols. The `rejects` check
  searches the `src` of *actors* that issue the command
  (`packages/core/src/contract.ts`); a human actor has no `src`, and in this
  architecture the caller is a shell, so today it checks nothing there.

Missing for the core idea:

1. **No rules for the code side.** Nothing says how a command, policy or
   read-model looks in code. The handoff lists the conventions as open (core
   first, CLI per command, `--json`, rejection codes, how state survives
   between CLI calls).
2. **External services have no node.** An exchange-rate API that three flows
   use is today a headless actor or nothing, and a failing call is not checked.
3. **No field level.** eventgraph knows *that* two flows share a read-model, not
   *which fields* they need.
4. **The model does not reach the compiler.** Generating types from the model is
   parked under "later on purpose".

## The architecture (stack-independent)

```
   SwiftUI · Compose · React · CLI · MCP tool        ← shells: view state, navigation
        │ command                       ▲ read-model (live query)
        ▼                               │
  ┌──────────────────────── core ─────────────────────────────┐
  │ handle(command):                                           │
  │   load state → check invariants → reject(CODE)             │
  │   or write state in one transaction + emit events          │
  │ events → policies → next command   (only flow-to-flow link) │
  │ read-models = queries over the same store                  │
  │ I/O only through ports: Store, Clock, Http, Notify, …      │
  └────────────────────────────────────────────────────────────┘
        ▲ ports implemented per shell (real) and per test/CLI (fake or local)
```

**State-stored, not event-sourced.** The truth is one store (on device: SQLite
via GRDB / Drift / a TS SQLite binding; on a server: the server's database).
Events are in-process notifications that drive policies and say what happened;
they are not the persisted record. A read-model is a query over the store,
observed live by the UI, and therefore immediate by default. Several flows
sharing a data source simply means several queries over the same tables — no
projections to rebuild, no event migrations. A projection table is the
exception, for a read-model too expensive to compute per read, and is then
marked `consistency: eventual`.

**Ports, not effects-as-data.** Testability comes from injecting the I/O
(store, clock, HTTP, notifications) and faking it in tests and in the CLI. A
failure comes back as a typed result. Returning effects as data
(Elm / Crux style) is needed only where the core sits behind an FFI boundary —
the Rust row of the stack table — and there Crux brings it.

### House rules

1. A shell changes domain state only through a command and reads it only through
   read-models. **View state stays in the shell:** form drafts, validation while
   typing, navigation, scroll, selection, sheet open or closed.
2. One flow sets off another only through a policy; no handler calls another
   handler. A screen may issue a command when it appears (a load); the model
   marks that command `triggered_by`.
3. I/O only through ports. A call that can fail has a failure path the caller
   handles: a failure event or a rejection code.
4. A refusal is a code from the command's `rejects`, not an exception text.
5. Every command and read-model is reachable from the CLI (`--json`) unless the
   model says `ui_only`. Each CLI subcommand states its name as a literal
   equal to the command id (in Swift:
   `CommandConfiguration(commandName: "add-expense")`), so `verify` can find it.
6. The CLI keeps state between calls in a local store file (`--store <path>`)
   and uses fakes or local implementations for OS-only ports (notifications,
   calendar), so a test or an agent can run a flow as a sequence of calls.
7. Done means `eventgraph check` and `verify` are clean and the flow has a
   test at core or CLI level.

### Where the authority sits

This decides more of the architecture than the language does.

| Authority | Core runs | Shared data lives | What it adds |
| --- | --- | --- | --- |
| Device only (offline app, no accounts) | in the app | local SQLite | nothing; the simple case |
| Server (web app, accounts, several devices) | on the server; the client core is a thin cache | server DB | read-models show *pending* until the server confirms; an outbox queue for commands sent offline |
| Both (local-first with sync) | in the app and on the server | local + server | conflict rules per aggregate; a separate concept per project |

House rule for the remote case: a read-model affected by a command whose
authority is remote shows that command as pending until confirmed or rejected,
and a rejected one is visible to the actor (the existing rule
`command-no-feedback` already asks the second half).

### How a model node lands in code

| eventgraph node | in the core |
| --- | --- |
| command (+ `rejects`) | input type, handler, rejection codes |
| invariant | a check inside the handler that returns a code |
| aggregate | state type + its tables; the unit one command writes in one transaction |
| event | in-process event type, emitted after the write |
| read-model (+ `consistency`) | a live query (immediate) or a projection table (eventual) |
| policy (+ `idempotent`) | event subscriber that issues a command |
| screen / endpoint / cli / tool | shell code only; never domain logic |
| actor | caller identity passed with the command |

### Example: shared data and side effects

```yaml
nodes:
  traveller:       { type: actor }
  trip:            { type: aggregate, immortal: true }
  add-expense:     { type: command }
  expense-added:   { type: event }
  trip-balance:    { type: read-model, consistency: immediate }
  monthly-report:  { type: read-model, consistency: eventual }
  budget-watch:    { type: policy, idempotent: true }
  warn-budget:     { type: command }
  budget-warned:   { type: event }
  trip-screen:     { type: screen, entry: true }
  report-screen:   { type: screen, detail: true }
edges:
  projects-to: { expense-added: [trip-balance, monthly-report], budget-warned: [trip-balance] }
  triggers:    { expense-added: [budget-watch] }
  invokes:     { budget-watch: [warn-budget] }
  # … issues, produces, acts-on, belongs-to, reads, offers, sees
```

`check` is clean on the full model. One event feeds two read-models (shared
data) and sets off a second flow through a policy (side effect).
`eventgraph impact add-expense` today:

```
Risk: MEDIUM (7 affected nodes)
Direct (2):      expense-added, trip
Transitive (5):  trip-balance, monthly-report, budget-watch, warn-budget, budget-warned
Upstream (2):    traveller, trip-screen
```

`report-screen` and the trip screen as a *reader* of `trip-balance` are
missing — the gap release 1 closes.

## Alternatives

The real fork is **how tightly eventgraph and the core are coupled**. The stack
and the authority are per-project choices (sections above and below).

### A — Map and loop

eventgraph stays the map; the core is hand-written code following the house
rules. A skill (`core-first`) runs the loop: model a flow → `check` → write
the command, its events, read-model queries, policy in the core → test →
`verify`.

- You see: a new project gets a model, the rules and a skill that walks each flow
  through. Nothing generated.
- Costs: see release 1.
- Rules out: nothing; B can follow.
- Weak spot: names drift between model and code until `verify` catches it, and
  `verify` only sees what `src` points at.

### B — Contract from the model

On top of A, `eventgraph gen <lang>` writes the contract per target language:
command and event types, rejection-code enums, the read-model list, a policy
registry, a CLI dispatcher. Handlers and queries stay hand-written.

- You see: a command added to the model breaks the build until it is handled; a
  code in `rejects` is an enum case on both sides.
- Costs: 1–2 weeks for the first language, about one week per further one. Needs
  a payload notation (fields on commands, events, read-models) — where "which
  fields do flows share" gets answered as a side product.
- Rules out: nothing, but eventgraph becomes part of the build and changes what
  the product is.

### C — A runtime that executes the model

A library loads the model and runs it: bus, policy runner, projection scheduler.
Code plugs in handlers only.

- You see: least boilerplate per flow, once it exists.
- Costs: weeks per language; it competes with Crux, TCA, Effect, XState, which
  teams maintain.
- Rules out: freedom of stack, and the model turns from a description into
  configuration that must be exact.

Considered and not an alternative of their own:
- **One local database with reactive queries as the whole answer** (GRDB,
  Drift, SQLite live queries). It answers "many flows share data" well, so it is
  adopted *inside* the architecture above as the store. It does not say which
  flow sets off which, nor check that every outcome is seen — the part
  eventgraph adds.
- **Statecharts (XState/Stately) as source of truth.** Good for the states of one
  flow, silent on data and effects between flows. Usable inside one handler.

## The stack, per project

The house rules and the model are the same on every stack; what changes is the
shells and the build. State as of 2026-11 (research note at the end):

| Target | Core | UI | CLI | Main risk |
| --- | --- | --- | --- | --- |
| Apple only | Swift package (SwiftPM, Swift Testing, GRDB) | SwiftUI | Swift executable target | none worth naming |
| Web only | TypeScript module | React | Node CLI | none worth naming |
| Web + iOS + Android, cross-platform UI acceptable | TypeScript core | React Native/Expo + React | Node CLI | no SwiftUI/Compose — native UI is ruled out on this row |
| All platforms, one UI toolkit | Flutter/Dart (Drift) | Flutter | Dart CLI | Flutter lock-in; not native widgets |
| iOS + Android, native UI | Kotlin Multiplatform core | SwiftUI + Compose | Kotlin/JVM CLI | Swift interop via ObjC export; SKIE or Swift export soften it |
| iOS + Android (+ web), native UI | Rust core: Crux 0.20, or Rust + UniFFI | SwiftUI + Compose (+ React/wasm) | Rust binary | three toolchains; Crux pre-1.0 with monthly breaking releases, FFI tooling in flux |

Swift on Android (official SDK since 6.3, Skip) and on wasm (6.4) exist but are
young; a Swift core under three platforms is the least proven option today.

There is **no single default**. Two questions pick the row: *is native UI
(SwiftUI/Compose) required?* and *which platforms in the first release?* Note
that the TypeScript and Flutter rows reach every platform only because their UI
is not native; a native-UI app on several platforms leads to KMP or Rust.

## Recommendation

**A now, B for one language after a trial project, C not**, with the
state-stored, ports-based architecture above.

A answers "is this the right tool" with real use rather than design, is cheap,
and keeps every option. Four eventgraph changes belong to A because the house
rules depend on them:

1. **`impact` answers "who depends on this"**: follow `reads` (and the new
   `calls`) backwards transitively, so a changed read-model or service lists
   every screen, policy and flow that uses it.
2. **`rejects` check covers surfaces**: search the `src` of every surface that
   `offers` the command, not only of actors.
3. **`verify` for CLI offers**: a `cli` surface that `offers` a command must
   contain the command id in its own `src` (house rule 5 makes that a literal).
4. **Node type `service`** (an API, payment provider, the OS calendar) with an
   edge **`calls`** from a command to it, and a rule: a command that calls a
   service produces a `failure` event or lists a code in `rejects`. The call
   happens inside the handler through a port, so it fits the preset as is
   (only commands produce events). A policy reaches a service through the
   command it invokes. (`external` is taken: it is already a command flag.)

Field-level modelling waits for B, where it is needed anyway.

## Decisions

1. **Core rules.** Adopt house rules 1, 2, 4 and 7 for new apps in `~/Private`?
   *Recommended: yes.* If no, the skill can only run the eventgraph half.
2. **CLI as a surface** (rules 5 and 6): every command reachable from a CLI with
   a store file? *Recommended: yes* — it is what lets an agent build and test
   flows. If no, the parity lane stays off and tests go through the core API only.
4. **Ports over effects-as-data** (rule 3), with effects-as-data only on the Rust
   row? *Recommended: yes.* If effects-as-data everywhere: one shape on every
   stack, at the cost of correlation and cancellation plumbing in Swift/TS/Kotlin.
5. **Coupling.** A now, B after the trial, C not? *Recommended: yes.* If B now:
   the first generator is designed before the trial shows which conventions hold.
6. **Trial project and its row.** Which project, which stack row, which authority?
   *Recommended: the Swift trial from the handoff (Apple only, device
   authority)* — it tests the loop without cross-platform tooling risk. If the
   multi-platform question is the one you want answered, pick a project with an
   Android or web target and its row instead. This also decides which stack
   release 1 writes its worked example for.
7. **eventgraph changes 1–4 above in release 1?** *Recommended: yes.* If only
   some: without 1 the blast radius stays partial; without 4 external services
   stay headless actors and rule 3 is checked by review only.

### Decided

- 2026-11-16 — **Storage (was decision 3):** state-stored with live queries,
  events in-process only; an event log only where history is the product.
  Decided by Igor.

### Assumptions (decided without asking)

- One developer, small to medium apps; no team boundaries inside the core.
- The core is one bounded context per app unless the model says otherwise;
  eventgraph contexts map to modules.
- Local-first sync (authority "both") is a separate concept when a project needs
  it.

## Releases

**1 — Rules, loop and the four eventgraph changes (4–6 days).**
`docs/core-architecture.md` with the house rules, the authority table, the
node→code table and one worked flow for the stack of decision 6; the
`core-first` skill (model → check → core → test → verify; per-stack recipes as
reference files, starting with that one stack); eventgraph changes 1–4 across
core, preset, validate, viewer, MCP, README and rule catalogue, released as
0.4.0. Assumes the skill reuses the existing `check --next` loop and needs no
new eventgraph command. Usable on its own: the next project starts with it.
Depends on decision 6 for the worked example.

**2 — Trial project (the project's own time; about one day of concept work).**
Build the trial model-first with the skill. Keep a friction log: where the
model and code disagreed, what `verify` missed, which boilerplate repeated per
flow.

**3 — Contract generation for one language (1–2 weeks).** Only if the friction
log shows drift or boilerplate that generated types would remove. Payload
notation on commands, events and read-models; `eventgraph gen <lang>` for the
trial's language; a rule for a read-model field nothing writes. Rust or Kotlin
add about 30 % for build integration.

**4 — Further languages (about one week each)**, per project that needs one.

## Out of scope

- A runtime framework (alternative C).
- Sync engines and conflict rules (authority "both").
- Backend architecture beyond "the server core is the same shape; an endpoint is
  a shell".
- UI design systems per stack (`design-system` skill).

## Open questions

- Is the Swift trial in the handoff still the project, or is there a newer
  candidate with web or Android? (Decision 6.)

## Review (2026-11-16)

An independent advisor reviewed the first draft. Worked in: state-stored instead
of an open event-sourcing question; the authority table; ports instead of
universal effects-as-data; the view-state carve-out and `triggered_by` for
loads on appear; dropping TypeScript as a default (it rules out native UI, and
the trial is Swift); the real reach of `impact` and `verify` and the changes
to fix them; `service` instead of the taken name `external`, with a failure
rule that fits the preset; a literal command name for Swift CLIs; decisions
split; release 1 re-estimated from 1–2 to 4–6 days.

## Research note (2026-11-16)

Checked via GitHub API and project pages; secondhand claims marked.

- Crux (Apache-2.0, ~2.8k★): `crux_core` 0.20.0 on 2026-08-07, roughly monthly
  breaking releases; shells for SwiftUI, Compose, React, Leptos, TUI; typegen
  moving to facet, FFI to BoltFFI (young). Self-described "pre-1.0,
  production-ready, occasional breaking changes".
- UniFFI (MPL-2.0, ~5.1k★, 0.32): Swift/Kotlin bindings, used by Mozilla;
  no effect pattern; web via wasm-bindgen separately.
- Kotlin Multiplatform: Android, iOS, desktop stable; Kotlin/Wasm Beta;
  Compose Multiplatform 1.12.
- Swift: official Android SDK since 6.3 (2026-03), Wasm SDK in 6.4; Skip 1.9,
  very active. Android tooling described as early (secondhand).
- Expo SDK 58 / React Native 0.88, New Architecture only. Effect 4.1; XState v6
  in beta.
- Flutter 3.50 (secondhand); flutter_rust_bridge 2.13.
