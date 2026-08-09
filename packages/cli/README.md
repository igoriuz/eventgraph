# eventgraph

Model an application as a queryable graph instead of a diagram nobody
maintains. This package is the CLI.

```
npm install -g eventgraph
eventgraph init --yes
eventgraph check --next 3
```

Most of the value is `check`: whoever writes the model — agent or human — gets
told which gaps are structurally impossible to leave open, so the loop becomes
`check --next` → fill one gap → `check` → repeat.

```
eventgraph scaffold                 extract a partial model from source
eventgraph apply                    merge a model from a file or stdin
eventgraph check                    completeness: what is missing?
eventgraph verify                   do pointers resolve, do callers know the rejections?
eventgraph slice <event>            the swimlane around one event
eventgraph view                     HTML viewer
eventgraph rules                    every rule, and why it exists
```

Full documentation: <https://github.com/igoriuz/eventgraph#readme>

MIT © Igor Kazhdan
