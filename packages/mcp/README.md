# eventgraph-mcp

An MCP server that lets an agent read, check and write an
[eventgraph](https://github.com/igoriuz/eventgraph) model without shelling out
to the CLI.

```json
{
  "mcpServers": {
    "eventgraph": {
      "command": "npx",
      "args": ["-y", "eventgraph-mcp"]
    }
  }
}
```

Reading: `eventgraph_query`, `eventgraph_get_node`, `eventgraph_list_contexts`,
`eventgraph_impact`, `eventgraph_slice`, `eventgraph_lifecycle`.

Asking what is wrong: `eventgraph_validate` for shape, `eventgraph_check` for
completeness — the one an agent should loop on, since it answers "what is
missing" rather than "is this legal"; `limit` gives the most pressing gaps, as
`check --next` does. `eventgraph_verify` holds the model against the code:
pointers that no longer resolve, rejection codes a caller does not handle.

Writing: `eventgraph_apply` takes a whole context as YAML and validates the
merged result before anything is written — the way to describe a model.
`eventgraph_add_node` (with its flags in `data`), `eventgraph_add_edge` and
`eventgraph_remove_node` are for single edits. Whether these apply directly or
propose a diff is the project's call, via `agent.write` in `eventgraph.yaml`.

Starting from code: `eventgraph_scaffold` returns a partial model read from
source and writes nothing; review it, then pass it to `eventgraph_apply`.

Prefer `eventgraph_slice` over reading the whole graph — a large model does not
fit a context window any better than it fits a screen.

MIT © Igor Kazhdan
