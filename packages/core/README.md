# eventgraph-core

The graph model, completeness rules and source scaffolding behind the
[`eventgraph-cli`](https://www.npmjs.com/package/eventgraph-cli) CLI. Install the CLI
unless you are building your own tooling on top of the model.

```ts
import { EventGraph, parseContextModel, checkGraph, QueryEngine } from 'eventgraph-core';
```

What lives here:

- `EventGraph` — the in-memory graph, plus `QueryEngine`
- `validateGraph` — shape: are node and edge types legal for the preset?
- `checkGraph` — completeness, in six lanes (bootstrap, structure, ux, backend, parity, platform)
- `scaffold` — extracts a partial model from real source: React Router, SpacetimeDB, Dart,
  commander subcommands, MCP tools
- `verifyImplementations` / `verifyRejectionHandling` / `verifyCliOffers` — do
  source pointers still resolve, do callers (actors and the screens offering a
  command) know its rejection codes, and does every CLI subcommand the model
  claims exist?
- `analyzeImpact` follows `reads` and `calls` backwards, so it answers "who
  depends on this?" as well as "what does this set off?"
- the model file reader and writer, in the compact on-disk form

Full documentation: <https://github.com/igoriuz/eventgraph#readme>

MIT © Igor Kazhdan
