# Architecture

## Shape

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

**State-stored.** The truth is one store (on device SQLite through GRDB, Drift
or a TS binding; on a server its database). Events are in-process
notifications that drive policies; they are not the persisted record. A
read-model is a query over the store, observed live by the UI, so it is
immediate by default (`consistency: immediate`). Several flows sharing a data
source means several queries over the same tables. A projection table is the
exception, for a read-model too expensive to compute per read, and is marked
`consistency: eventual`. An event log only where history is the product.

**Ports.** Every I/O — store, clock, HTTP, notifications, calendar — is a
protocol/interface the core receives. Tests and the CLI pass fakes or local
implementations. Failure comes back as a typed result. Effects returned as data
(Elm/Crux style) only on the Rust row, where the core sits behind an FFI.

## House rules

1. A shell changes domain state only through a command and reads it only through
   read-models. View state stays in the shell: form drafts, validation while
   typing, navigation, scroll, selection, sheets.
2. One flow sets off another only through a policy; no handler calls another
   handler. A screen may issue a command when it appears (a load); the model
   marks that command `triggered_by`.
3. I/O only through ports. A call that can fail has a failure path the caller
   handles: a failure event or a rejection code.
4. A refusal is a code from the command's `rejects`, not an exception text.
5. Every command and read-model is reachable from the CLI (`--json`) unless the
   model says `ui_only`. Each subcommand states its name as a literal equal to
   the command id, so `eventgraph verify` can find it.
6. The CLI keeps state between calls in a store file (`--store <path>`) and uses
   fakes or local implementations for OS-only ports, so a test or an agent can
   run a flow as a sequence of calls.
7. Done means `eventgraph check` and `verify` are clean and the flow has a test
   at core or CLI level.

## Where the authority sits

| Authority | Core runs | Shared data lives | What it adds |
| --- | --- | --- | --- |
| Device only (offline app, no accounts) | in the app | local SQLite | nothing; the simple case |
| Server (web app, accounts, several devices) | on the server; the client core is a thin cache | server DB | read-models show *pending* until the server confirms; an outbox for commands sent offline |
| Both (local-first with sync) | app and server | both | conflict rules per aggregate — needs its own concept first |

With a remote authority, a read-model affected by a pending command shows it as
pending until confirmed or rejected, and a rejection reaches the actor
(`command-no-feedback` checks the second half).

## Model node → code

| eventgraph node | in the core |
| --- | --- |
| command (+ `rejects`) | input type, handler, rejection codes |
| invariant | a check inside the handler that returns a code |
| aggregate | state type + its tables; the unit one command writes in one transaction |
| event | in-process event type, emitted after the write; `failure` for a refusal recorded as an event |
| read-model (+ `consistency`) | a live query (immediate) or a projection table (eventual) |
| policy (+ `idempotent`) | event subscriber that issues a command |
| service (+ `calls`) | a port the handler calls; its failure is a code or a failure event |
| screen / notification / widget | shell code; handles every code of the commands it offers |
| cli / tool / endpoint | shell code; passes codes through to its caller |
| actor | caller identity passed with the command |

## CLI conventions

- One subcommand per command and per read-model; the command id is the
  subcommand name, written as a literal.
- `--store <path>` (default in a dot-directory of the working directory),
  `--json` on every subcommand.
- Exit codes: 0 done, 2 refused (stdout `{"rejected": "<CODE>"}`), 1 anything else.
- Output of a command: the events it produced. Output of a read-model: its
  current value.

## What eventgraph checks for you

- `check`: every command has an issuer and an effect, every outcome reaches the
  actor, every policy is wired at both ends, every service call has a failure
  path, every command and read-model a person reaches is also reachable headless
  (parity lane, once a `cli` surface exists).
- `verify`: `src` pointers resolve; every screen offering a command names each
  of its codes (any spelling: `TOO_LARGE`, `.tooLarge`); every `cli` surface
  names each command it offers.
- `impact <node>`: what a change sets off, and who reads or calls what it changes.
