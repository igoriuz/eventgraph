# @eventgraph/mcp

An MCP server that lets an agent read, check and write an
[eventgraph](https://github.com/igoriuz/eventgraph) model without shelling out
to the CLI.

```json
{
  "mcpServers": {
    "eventgraph": {
      "command": "npx",
      "args": ["-y", "@eventgraph/mcp"]
    }
  }
}
```

Reading: `eventgraph_query`, `eventgraph_get_node`, `eventgraph_list_contexts`,
`eventgraph_impact`, `eventgraph_slice`, `eventgraph_lifecycle`.

Asking what is wrong: `eventgraph_validate` for shape, `eventgraph_check` for
completeness — the one an agent should loop on, since it answers "what is
missing" rather than "is this legal".

Writing: `eventgraph_add_node`, `eventgraph_add_edge`, `eventgraph_remove_node`.
Whether these apply directly or propose a diff is the project's call, via
`agent.write` in `eventgraph.yaml`.

Prefer `eventgraph_slice` over reading the whole graph — a large model does not
fit a context window any better than it fits a screen.

MIT © Igor Kazhdan
