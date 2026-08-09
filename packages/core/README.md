# eventgraph-core

The graph model, completeness rules and source scaffolding behind the
[`eventgraph-cli`](https://www.npmjs.com/package/eventgraph-cli) CLI. Install the CLI
unless you are building your own tooling on top of the model.

```ts
import { EventGraph, parseContextModel, checkGraph, QueryEngine } from 'eventgraph-core';
```

What lives here:

- `EventGraph` — the in-memory graph, plus `QueryEngine` and `analyzeImpact`
- `validateGraph` — shape: are node and edge types legal for the preset?
- `checkGraph` — completeness, in five lanes (bootstrap, structure, ux, backend, platform)
- `scaffold` — extracts a partial model from real source: React Router, SpacetimeDB, Dart
- `verifyImplementations` / `verifyRejectionHandling` — do source pointers still
  resolve, and do callers in one codebase know the rejections declared in another?
- the model file reader and writer, in the compact on-disk form

Full documentation: <https://github.com/igoriuz/eventgraph#readme>

MIT © Igor Kazhdan
