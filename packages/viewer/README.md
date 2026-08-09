# eventgraph-viewer

Renders an [eventgraph](https://github.com/igoriuz/eventgraph) model as a
self-contained interactive HTML page — one file, no server, no build step. Used
by `eventgraph view`; install the CLI unless you are embedding the output
yourself.

```ts
import { generateViewerHtml } from 'eventgraph-viewer';

const html = generateViewerHtml(graph, 'my-project');
```

Nodes are laid out in swimlanes by type with [elkjs](https://github.com/kieler/elkjs).
Clicking a node dims everything outside its neighbourhood; Escape clears it.

A whole-graph picture stops being readable within a few dozen nodes — the same
failure that kills a growing swimlane board — so pass a narrowed graph rather
than the whole one. The CLI does this with `view --slice`, `--focus` and
`--type`.

MIT © Igor Kazhdan
