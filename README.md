# eventgraph

Model an application as a queryable graph instead of a diagram nobody maintains.

The premise: event modeling is right about the *shape* of a flow — actor →
command → event → read-model → screen — and wrong about the *storage*. A
swimlane board is a view, not a data structure, which is why it fragments once
cross-cutting concerns show up. Here the graph is the storage and the board is
one projection of it, rebuilt on demand around whatever you ask about.

Most of the value is not the graph itself. It is `check`: an agent or a human
writing the model gets told which gaps are structurally impossible to leave
open, so the loop becomes `check --next` → fill one gap → `check` → repeat.

## Layout

```
eventgraph/
  eventgraph.yaml            name, preset, contexts, platforms
  contexts/<name>/model.yaml nodes and edges for one bounded context
```

Node ids are unique within a context, so a `booking` aggregate and a `booking`
screen can coexist. Commands accept bare ids (`placed`) when unambiguous, or
qualified ones (`app.placed`).

```yaml
context: app
nodes:
  - id: place-order
    type: command
    label: Place Order
    data:
      status: implemented
      implemented_by: [src/orders/place.ts]
edges:
  - { from: app.customer, to: app.place-order, type: issues }
  - { from: app.place-order, to: app.order-placed, type: produces }
```

Edges are first-class and typed, and the preset decides which type may connect
which — a command that "produces" an actor fails validation rather than quietly
producing a nonsense graph.

## Commands

```
eventgraph init                     scaffold a project
eventgraph add / connect            write nodes and edges
eventgraph list / query             read the graph
eventgraph validate                 shape: are types and edges legal?
eventgraph check                    completeness: what is missing?
eventgraph check --next 3           the most pressing gaps, in priority order
eventgraph verify                   do implemented_by pointers still resolve?
eventgraph slice <event>            the swimlane around one event
eventgraph lifecycle <aggregate>    its events, the closing one last
eventgraph impact <node>            blast radius of a change
eventgraph view                     HTML viewer
eventgraph rules                    every rule, and why it exists
```

`--json` for machine-readable output on most of them.

### Don't render everything

A whole-graph picture stops being readable within a few dozen nodes — the same
failure that kills a growing swimlane board. Ask for a part instead:

```
eventgraph view --slice order-placed        the flow around one event
eventgraph view --focus place-order -d 2    two hops around a node
eventgraph view --type command,event        one lane at a time
```

Every view prints how much of the graph it shows, so a narrowed picture is never
mistaken for the whole one. In the viewer, clicking a node dims everything
outside its neighbourhood; Escape clears it.

## validate vs check

`validate` asks whether the graph has a legal *shape*: known node types, known
edge types, edges connecting the types the preset allows.

`check` asks whether it is *complete* — a different question, and the one that
finds real problems. Completeness rules only make sense once a preset fixes the
vocabulary ("this event has no consumer" means nothing without a definition of
event), so they are opt-in per preset via a `rules:` key. A preset without one
keeps shape-only validation.

Rules run in four lanes; `check --lane <lane>` narrows to one.

**bootstrap** — an empty graph must not report success, or the plan-forward loop
has nothing to pull on: no nodes at all, no actor, no aggregate.

**structure** — an event nothing consumes or nothing produces; a read-model
nothing reads; a command nothing issues or that produces nothing; a screen that
neither reads nor offers; a policy missing either half of event-in/command-out;
an invariant no command enforces; an aggregate without events or without a
lifecycle end; an open question blocking other nodes.

**ux** — structural only; nothing about visual design, copy or layout, which are
not graph problems.

- **a command whose outcome the actor never sees.** Every screen looks fine on
  its own, which is why reviews miss it. Followed transitively through policy
  chains, since feedback often surfaces only after a policy turns the event into
  another command.
- a screen no navigation path reaches from an entry screen
- a screen with no action and no way onward
- a command buried more than three navigations deep
- a screen offering an actor a command they may not issue

**platform** — see below.

### Saying "yes, deliberately"

A rule that cannot be told it is wrong becomes noise. These flags live in a
node's `data` and each one that silences a finding demands a reason:

| Flag | On | Means |
| --- | --- | --- |
| `terminal: <reason>` | event | nothing reacts, deliberately |
| `ends_lifecycle` | event | closes an aggregate — orthogonal to `terminal`, since a closing event is often still displayed |
| `transient: <reason>` | event | no aggregate owns it because no state survives it, e.g. a generated file |
| `immortal` | aggregate | genuinely never ends |
| `detail` | screen | a lightbox; having no action and no way onward is the point |
| `kind` | screen | `notification` or `widget` — reaches the user without being navigated to |
| `triggered_by` | command | issued by a scheduler or by a screen appearing |
| `external: <reason>` | command | hands off to a system surface, so no outcome is observable |

## Drift between graph and code

`implemented_by` holds pointers into real source, optionally with a `#symbol`
suffix. `eventgraph verify` checks that those files still exist, so a graph
cannot silently describe code that was renamed away. Nodes marked
`status: implemented` that name no source are reported too.

```
eventgraph verify --root ../          resolve pointers from the repo root
```

## Two codebases, one product

When the same product ships as separate apps, `implemented_by` can be keyed by
platform, with the expected set declared in `eventgraph.yaml`:

```yaml
platforms: [ios, android]
```

```yaml
- id: upload-protocol
  type: command
  data:
    implemented_by:
      ios: []
      android: [app/src/main/java/protocol/ProtocolUploadWorker.kt]
```

A missing or empty entry is drift. A flat list still means "not
platform-specific", so shared domain nodes never report. This is the one check
no linter or test can perform from inside a single repository, because the
information lives between them.

## MCP

The server exposes the read side to agents: `eventgraph_query`,
`eventgraph_impact`, `eventgraph_slice`, `eventgraph_lifecycle`,
`eventgraph_check`, `eventgraph_validate`, plus writes gated by the `agent.write`
mode in the project config (`prompt`, `auto` or `locked`).

## Development

```
pnpm install
npx vitest run                     the whole suite
pnpm --filter @eventgraph/core build
```

Packages: `core` (graph, rules, projections, verify), `cli`, `mcp`, `viewer`.
Core carries no dependencies beyond `yaml` and `ajv`; the others are thin
adapters over it.
