# eventgraph — Design Specification

**Date:** 2026-05-03
**Status:** Draft
**Repo:** `eventgraph/` (within `~/Private/research/`)
**License:** Open Source (MIT)

## Overview

eventgraph is an agent-first architecture modeling tool. It stores software architecture as a typed, directed graph — primarily for LLM agents to query, plan against, and update. Humans review and correct via a visual viewer and YAML files.

The tool combines ideas from Event Modeling (structured system design on a timeline) with agent-workflow tooling (like claude-mem and superpowers): a searchable, traversable graph that agents consult *before* writing code, not after.

## Design Principles

1. **Agent-workflow tool, not a drawing app.** The graph is a steering layer for LLM agents. Visualization is for human review and verification.
2. **Flexible schema with opinionated presets.** Event Modeling is a built-in, validated preset — but simpler models (service dependencies, data flows) are equally supported.
3. **YAML as source of truth, index as cache.** Files are human-readable and Git-tracked. An in-memory index provides fast graph queries. The index is derived, not canonical.
4. **Configurable agent autonomy.** Projects choose how much write access agents get: `prompt` (propose + confirm), `auto` (write directly), or `locked` (read-only).

## Graph Schema & Data Model

### Node Types

Extensible, with a built-in Event Modeling preset:

| Type | Preset | Description |
|------|--------|-------------|
| `command` | Event Modeling | Intention to perform an action |
| `event` | Event Modeling | Fact that has occurred |
| `read-model` | Event Modeling | Projection for consumers |
| `policy` | Event Modeling | Automated reaction to events |
| `screen` | Event Modeling | UI component |
| `aggregate` | Event Modeling | Consistency boundary |
| `service` | Generic | External service / infrastructure |
| `custom` | Generic | Freely definable with custom schema |

### Edge Types

| Type | Description | Example |
|------|-------------|---------|
| `produces` | Command produces event | `PlaceOrder → OrderPlaced` |
| `projects-to` | Event feeds read model | `OrderPlaced → OrderSummary` |
| `triggers` | Event triggers policy | `OrderPlaced → SendConfirmation` |
| `reads` | Screen/Policy reads read model | `OrderScreen → OrderSummary` |
| `depends-on` | Generic dependency | `PaymentService → Stripe` |

Edge types are extensible — custom types can be added per project.

### Node Structure

Every node has:
- `id` (string, unique within context)
- `type` (one of the registered node types)
- `label` (human-readable name)
- `data` (optional, free-form object — fields, descriptions, tags, etc.)

### Edge Structure

Every edge has:
- `from` (node ID, dot-notation for cross-context: `payments.order-placed`)
- `to` (node ID)
- `type` (one of the registered edge types)
- `metadata` (optional, free-form object)

### Bounded Contexts

Contexts are directories, not node types. Each context is a folder with its own `model.yaml`. Cross-context references use dot-notation: `payments.order-placed`.

## Project Structure & File Format

### Directory Layout

```
project/
  eventgraph/
    eventgraph.yaml           # Root config
    contexts/
      payments/
        model.yaml
      shipping/
        model.yaml
    presets/
      event-modeling.yaml     # Built-in preset (validation rules)
    schema/
      eventgraph.schema.json  # JSON Schema for editor support
```

### Root Config (`eventgraph.yaml`)

```yaml
name: my-project
version: 1
preset: event-modeling       # or "generic", or custom preset name

agent:
  write: prompt              # prompt | auto | locked

contexts:
  - payments
  - shipping
```

### Context Model (`contexts/payments/model.yaml`)

```yaml
context: payments

nodes:
  - id: place-order
    type: command
    label: Place Order
    data:
      fields: [orderId, customerId, items, total]
      description: Customer submits a new order

  - id: order-placed
    type: event
    label: Order Placed
    data:
      fields: [orderId, customerId, items, total, placedAt]

  - id: order-summary
    type: read-model
    label: Order Summary

edges:
  - from: place-order
    to: order-placed
    type: produces

  - from: order-placed
    to: order-summary
    type: projects-to

  - from: order-placed
    to: shipping.start-fulfillment
    type: triggers
```

### Presets

Presets define which node types are allowed and which edge validations apply. The Event Modeling preset enforces that `produces` edges only go from `command` to `event`, `projects-to` only from `event` to `read-model`, etc.

### Scalability

Files are split per bounded context, keeping each file small (~300 lines). The in-memory index merges all contexts into a single graph at startup. For large systems, only the relevant contexts need to be loaded by an agent.

## CLI Commands

```
eventgraph init                      # Initialize project (interactive)
eventgraph validate                  # Check schema + preset rules
eventgraph query <expression>        # Query the graph
eventgraph impact <node-id>          # Impact analysis: what's downstream?
eventgraph view                      # Generate static HTML viewer + open
eventgraph list [--context] [--type] # List nodes with filters
eventgraph add <type> <id>           # Add node (interactive)
eventgraph connect <from> <to>       # Create edge
```

### `eventgraph init`

Interactive setup:
1. Project name
2. Choose preset (event-modeling / generic / custom)
3. Agent write mode (prompt / auto / locked)
4. Create first context
5. Generate JSON Schema + `.gitignore` entry for cache

### `eventgraph query`

Examples:
- `eventgraph query "type:event context:payments"` — all events in payments context
- `eventgraph query "downstream:order-placed"` — everything downstream of OrderPlaced
- `eventgraph query "upstream:order-summary"` — everything that feeds into OrderSummary
- `eventgraph query "path:place-order..order-screen"` — path between two nodes

### `eventgraph impact`

Core feature for agents. `eventgraph impact order-placed` returns:
- Directly affected nodes (read models, policies)
- Transitively affected nodes (screens, downstream events)
- Affected contexts
- Risk assessment (number of affected nodes, cross-context yes/no)

### `eventgraph view`

Generates a standalone HTML file with:
- Timeline layout (classic Event Modeling swimlanes)
- Filter by context and node type
- Clickable nodes with detail popup
- Opens automatically in browser

## MCP Plugin (Agent Integration)

The plugin exposes the graph engine as MCP tools via `@eventgraph/mcp`.

### Read Tools

| Tool | Description | Input |
|------|-------------|-------|
| `eventgraph_query` | Query the graph | `{ "expr": "type:event context:payments" }` |
| `eventgraph_impact` | Impact analysis | `{ "nodeId": "order-placed", "depth": 3 }` |
| `eventgraph_get_node` | Load single node | `{ "nodeId": "payments.order-placed" }` |
| `eventgraph_list_contexts` | List all bounded contexts | `{}` |
| `eventgraph_validate` | Validate model | `{}` |

### Write Tools

Behavior depends on `agent.write` config:

| Tool | Description | Behavior |
|------|-------------|----------|
| `eventgraph_add_node` | Add node | `prompt`: returns YAML diff, waits for confirmation |
| `eventgraph_add_edge` | Create edge | `auto`: writes directly to YAML file |
| `eventgraph_update_node` | Update node | `locked`: rejects with explanation |
| `eventgraph_remove_node` | Remove node | Always shows impact warning first |

### Meta Tools

| Tool | Description |
|------|-------------|
| `eventgraph_view` | Generate viewer, return URL |
| `eventgraph_diff` | Show changes since last commit |
| `eventgraph_init_context` | Create new bounded context |

### Agent Workflow

Typical flow when an agent builds a new feature:
1. `eventgraph_query` — understand current state of relevant context
2. `eventgraph_impact` — assess what would be affected by planned changes
3. `eventgraph_add_node` / `eventgraph_add_edge` — extend the model (per write mode)
4. Implement the code
5. `eventgraph_validate` — verify model consistency

The agent consults the graph *before* writing code, not after.

## Static HTML Viewer

### Layout

Classic Event Modeling timeline with horizontal swimlanes:
- **Top:** Screens
- **Upper middle:** Read Models
- **Center:** Events (the timeline)
- **Lower middle:** Commands
- **Bottom:** Policies

### Features (MVP)

- **Context filter** — pill buttons in toolbar to show/hide contexts
- **Color coding** — fixed colors per node type (blue=command, amber=event, green=read-model, red=policy, purple=screen)
- **Click → Detail panel** — fields, upstream/downstream count, affected contexts
- **Standalone HTML** — CSS + JS + data embedded, no server required
- **Dark theme** — fits terminal workflow

### Tech

- **elkjs** for graph layout computation (swimlane arrangement)
- Template-based HTML generation from `@eventgraph/viewer`
- All data embedded as JSON in a `<script>` tag

## Package Architecture (Monorepo)

### Structure

```
eventgraph/
  packages/
    core/                    # Graph engine (no CLI/MCP dependencies)
      src/
        schema.ts            # TypeScript types + JSON Schema definitions
        parser.ts            # YAML → Graph loader
        graph.ts             # In-memory graph data structure
        query.ts             # Query engine (text search, filters)
        impact.ts            # Impact analysis (graph traversal)
        validate.ts          # Preset rule checking
        index.ts             # Public API
      package.json           # @eventgraph/core

    cli/                     # CLI adapter
      src/
        commands/
          init.ts
          query.ts
          impact.ts
          validate.ts
          view.ts
          list.ts
          add.ts
          connect.ts
        index.ts
      package.json           # eventgraph (npm bin)

    mcp/                     # MCP server
      src/
        server.ts            # MCP server setup
        tools/
          read.ts            # query, impact, get_node, list_contexts, validate
          write.ts           # add_node, add_edge, update_node, remove_node
          meta.ts            # view, diff, init_context
      package.json           # @eventgraph/mcp

    viewer/                  # HTML generator
      src/
        generate.ts          # Graph → HTML renderer
        templates/
          timeline.html      # Timeline layout template
          styles.css
          viewer.js          # Client-side interactivity
      package.json           # @eventgraph/viewer

  presets/
    event-modeling.yaml      # Built-in preset
    generic.yaml

  schema/
    eventgraph.schema.json   # JSON Schema for editor support

  package.json               # Workspace root (pnpm workspaces)
  tsconfig.json              # Shared TypeScript config
```

### Dependency Graph

```
cli → core, viewer
mcp → core, viewer
viewer → core
core → (no internal deps)
```

### Tech Stack

- **TypeScript** — throughout
- **pnpm workspaces** — monorepo management
- **Vitest** — testing
- **yaml** (npm package) — YAML parsing
- **ajv** — JSON Schema validation
- **@modelcontextprotocol/sdk** — MCP server
- **commander** — CLI framework
- **elkjs** — graph layout for the viewer

## MVP Scope

### Included

1. `eventgraph init` — interactive project setup
2. Graph schema + YAML format with JSON Schema validation
3. CLI queries — `query`, `impact`, `validate`, `list`, `view`, `add`, `connect`
4. Static HTML viewer with timeline layout
5. MCP plugin with read/write/meta tools
6. Event Modeling preset with edge validation rules

### Explicitly Not in MVP

- Semantic search (text search is sufficient initially)
- Code scaffolding from the model
- Incremental index cache (full rebuild on each CLI invocation)
- Live/interactive viewer (static HTML only)
- Multiple layout modes (timeline only, graph layout comes later)

## Future Directions (Post-MVP)

- Semantic search over nodes and relationships
- Code scaffolding (generate boilerplate from model)
- Live viewer with WebSocket hot-reload
- Graph layout mode (alternative to timeline)
- Incremental index for large models
- Git integration (model diff in PRs)
- Multi-agent support (conflict resolution for concurrent writes)
- Import from existing Event Storming / Event Modeling tools
