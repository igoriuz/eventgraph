# eventgraph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an agent-first architecture modeling tool that stores software architecture as a typed directed graph (YAML files), queryable via CLI and MCP plugin, with a static HTML viewer.

**Architecture:** Monorepo with 4 packages — `core` (graph engine), `cli` (commander.js adapter), `mcp` (MCP server adapter), `viewer` (HTML generator). Core has no external package dependencies beyond yaml/ajv. CLI and MCP are thin adapters over core. All YAML files are source of truth; in-memory graph is rebuilt on each invocation.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, yaml, ajv, commander, @modelcontextprotocol/sdk, elkjs

---

## File Structure

```
eventgraph/
  packages/
    core/
      src/
        schema.ts              # TypeScript types, node/edge type registries
        graph.ts               # EventGraph class — in-memory graph data structure
        parser.ts              # YAML file loading → EventGraph
        query.ts               # Query engine — filter, upstream, downstream, path
        impact.ts              # Impact analysis — traversal + risk assessment
        validate.ts            # Preset loading + rule enforcement
        writer.ts              # Graph mutations → YAML file writes
        index.ts               # Public API re-exports
      __tests__/
        schema.test.ts
        graph.test.ts
        parser.test.ts
        query.test.ts
        impact.test.ts
        validate.test.ts
        writer.test.ts
      package.json
      tsconfig.json

    cli/
      src/
        index.ts               # CLI entrypoint + commander program
        commands/
          init.ts              # eventgraph init (interactive)
          query.ts             # eventgraph query <expr>
          impact.ts            # eventgraph impact <node-id>
          validate.ts          # eventgraph validate
          view.ts              # eventgraph view
          list.ts              # eventgraph list [--context] [--type]
          add.ts               # eventgraph add <type> <id>
          connect.ts           # eventgraph connect <from> <to>
        util.ts                # Shared CLI helpers (load graph, format output)
      __tests__/
        commands.test.ts
      package.json
      tsconfig.json

    viewer/
      src/
        generate.ts            # Graph → standalone HTML file
        layout.ts              # Swimlane layout computation
        templates/
          timeline.html        # Main HTML template
          styles.css            # Dark theme styles
          viewer.js             # Client-side interactivity (filter, click, detail panel)
      __tests__/
        generate.test.ts
        layout.test.ts
      package.json
      tsconfig.json

    mcp/
      src/
        server.ts              # MCP server entrypoint
        tools/
          read.ts              # query, impact, get_node, list_contexts, validate
          write.ts             # add_node, add_edge, update_node, remove_node
          meta.ts              # view, diff, init_context
      __tests__/
        read.test.ts
        write.test.ts
      package.json
      tsconfig.json

  presets/
    event-modeling.yaml        # Built-in Event Modeling preset
    generic.yaml               # Permissive generic preset

  schema/
    eventgraph.schema.json     # JSON Schema for YAML editor support

  package.json                 # Workspace root
  tsconfig.base.json           # Shared TS config
  vitest.workspace.ts          # Vitest workspace config
  .gitignore
```

---

### Task 1: Monorepo Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `.gitignore`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/viewer/package.json`
- Create: `packages/viewer/tsconfig.json`
- Create: `packages/mcp/package.json`
- Create: `packages/mcp/tsconfig.json`

- [ ] **Step 1: Create workspace root package.json**

```json
{
  "name": "eventgraph-monorepo",
  "private": true,
  "packageManager": "pnpm@9.15.4",
  "scripts": {
    "build": "pnpm -r run build",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit -p packages/core/tsconfig.json && tsc --noEmit -p packages/cli/tsconfig.json && tsc --noEmit -p packages/viewer/tsconfig.json && tsc --noEmit -p packages/mcp/tsconfig.json"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

- [ ] **Step 4: Create vitest.workspace.ts**

```typescript
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/core',
  'packages/cli',
  'packages/viewer',
  'packages/mcp',
]);
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
*.tsbuildinfo
.eventgraph-cache/
```

- [ ] **Step 6: Create packages/core/package.json and tsconfig.json**

`packages/core/package.json`:
```json
{
  "name": "@eventgraph/core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "yaml": "^2.7.0",
    "ajv": "^8.17.0"
  }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 7: Create packages/cli/package.json and tsconfig.json**

`packages/cli/package.json`:
```json
{
  "name": "eventgraph",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "eventgraph": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@eventgraph/core": "workspace:*",
    "@eventgraph/viewer": "workspace:*",
    "commander": "^13.0.0",
    "inquirer": "^12.0.0"
  }
}
```

`packages/cli/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 8: Create packages/viewer/package.json and tsconfig.json**

`packages/viewer/package.json`:
```json
{
  "name": "@eventgraph/viewer",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/generate.js",
  "types": "dist/generate.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@eventgraph/core": "workspace:*",
    "elkjs": "^0.9.0"
  }
}
```

`packages/viewer/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 9: Create packages/mcp/package.json and tsconfig.json**

`packages/mcp/package.json`:
```json
{
  "name": "@eventgraph/mcp",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/server.js",
  "types": "dist/server.d.ts",
  "bin": {
    "eventgraph-mcp": "dist/server.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@eventgraph/core": "workspace:*",
    "@eventgraph/viewer": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.12.0"
  }
}
```

`packages/mcp/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 10: Install dependencies and verify workspace**

Run: `pnpm install`
Expected: Clean install, all 4 packages linked

Run: `pnpm ls -r --depth 0`
Expected: Lists all 4 packages with their dependencies

- [ ] **Step 11: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json vitest.workspace.ts .gitignore packages/*/package.json packages/*/tsconfig.json
git commit -m "scaffold: monorepo with core, cli, viewer, mcp packages"
```

---

### Task 2: Core — Schema Types

**Files:**
- Create: `packages/core/src/schema.ts`
- Create: `packages/core/src/__tests__/schema.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/__tests__/schema.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  type GraphNode,
  type GraphEdge,
  type ContextModel,
  type ProjectConfig,
  type PresetDefinition,
  type EdgeRule,
  EVENT_MODELING_NODE_TYPES,
  EVENT_MODELING_EDGE_TYPES,
  GENERIC_NODE_TYPES,
  GENERIC_EDGE_TYPES,
} from '../schema.js';

describe('schema', () => {
  it('defines event modeling node types', () => {
    expect(EVENT_MODELING_NODE_TYPES).toContain('command');
    expect(EVENT_MODELING_NODE_TYPES).toContain('event');
    expect(EVENT_MODELING_NODE_TYPES).toContain('read-model');
    expect(EVENT_MODELING_NODE_TYPES).toContain('policy');
    expect(EVENT_MODELING_NODE_TYPES).toContain('screen');
    expect(EVENT_MODELING_NODE_TYPES).toContain('aggregate');
    expect(EVENT_MODELING_NODE_TYPES).toHaveLength(6);
  });

  it('defines event modeling edge types', () => {
    expect(EVENT_MODELING_EDGE_TYPES).toContain('produces');
    expect(EVENT_MODELING_EDGE_TYPES).toContain('projects-to');
    expect(EVENT_MODELING_EDGE_TYPES).toContain('triggers');
    expect(EVENT_MODELING_EDGE_TYPES).toContain('reads');
    expect(EVENT_MODELING_EDGE_TYPES).toHaveLength(4);
  });

  it('defines generic node and edge types', () => {
    expect(GENERIC_NODE_TYPES).toContain('service');
    expect(GENERIC_NODE_TYPES).toContain('custom');
    expect(GENERIC_EDGE_TYPES).toContain('depends-on');
  });

  it('validates GraphNode shape', () => {
    const node: GraphNode = {
      id: 'place-order',
      type: 'command',
      label: 'Place Order',
      context: 'payments',
      data: { fields: ['orderId', 'customerId'] },
    };
    expect(node.id).toBe('place-order');
    expect(node.context).toBe('payments');
  });

  it('validates GraphEdge shape', () => {
    const edge: GraphEdge = {
      from: 'place-order',
      to: 'order-placed',
      type: 'produces',
    };
    expect(edge.from).toBe('place-order');
    expect(edge.metadata).toBeUndefined();
  });

  it('validates ContextModel shape', () => {
    const model: ContextModel = {
      context: 'payments',
      nodes: [{ id: 'test', type: 'event', label: 'Test' }],
      edges: [],
    };
    expect(model.context).toBe('payments');
    expect(model.nodes).toHaveLength(1);
  });

  it('validates ProjectConfig shape', () => {
    const config: ProjectConfig = {
      name: 'my-project',
      version: 1,
      preset: 'event-modeling',
      agent: { write: 'prompt' },
      contexts: ['payments', 'shipping'],
    };
    expect(config.agent.write).toBe('prompt');
  });

  it('validates PresetDefinition shape', () => {
    const preset: PresetDefinition = {
      name: 'event-modeling',
      nodeTypes: ['command', 'event'],
      edgeTypes: ['produces'],
      edgeRules: [
        { type: 'produces', from: 'command', to: 'event' },
      ],
    };
    expect(preset.edgeRules).toHaveLength(1);
    expect(preset.edgeRules[0].from).toBe('command');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test -- --filter core`
Expected: FAIL — cannot find module '../schema.js'

- [ ] **Step 3: Write implementation**

`packages/core/src/schema.ts`:
```typescript
export interface GraphNode {
  id: string;
  type: string;
  label: string;
  context: string;
  data?: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: string;
  metadata?: Record<string, unknown>;
}

export interface ContextModelNode {
  id: string;
  type: string;
  label: string;
  data?: Record<string, unknown>;
}

export interface ContextModel {
  context: string;
  nodes: ContextModelNode[];
  edges: GraphEdge[];
}

export interface ProjectConfig {
  name: string;
  version: number;
  preset: string;
  agent: {
    write: 'prompt' | 'auto' | 'locked';
  };
  contexts: string[];
}

export interface EdgeRule {
  type: string;
  from: string;
  to: string;
}

export interface PresetDefinition {
  name: string;
  nodeTypes: string[];
  edgeTypes: string[];
  edgeRules: EdgeRule[];
}

export const EVENT_MODELING_NODE_TYPES = [
  'command',
  'event',
  'read-model',
  'policy',
  'screen',
  'aggregate',
] as const;

export const EVENT_MODELING_EDGE_TYPES = [
  'produces',
  'projects-to',
  'triggers',
  'reads',
] as const;

export const GENERIC_NODE_TYPES = [
  'service',
  'custom',
] as const;

export const GENERIC_EDGE_TYPES = [
  'depends-on',
] as const;

export function qualifiedId(context: string, nodeId: string): string {
  if (nodeId.includes('.')) return nodeId;
  return `${context}.${nodeId}`;
}

export function parseQualifiedId(qualifiedId: string): { context: string; nodeId: string } {
  const dotIndex = qualifiedId.indexOf('.');
  if (dotIndex === -1) return { context: '', nodeId: qualifiedId };
  return {
    context: qualifiedId.substring(0, dotIndex),
    nodeId: qualifiedId.substring(dotIndex + 1),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test -- --filter core`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schema.ts packages/core/src/__tests__/schema.test.ts
git commit -m "feat(core): add schema types and type registries"
```

---

### Task 3: Core — In-Memory Graph

**Files:**
- Create: `packages/core/src/graph.ts`
- Create: `packages/core/src/__tests__/graph.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/__tests__/graph.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { EventGraph } from '../graph.js';
import type { GraphNode, GraphEdge } from '../schema.js';

describe('EventGraph', () => {
  let graph: EventGraph;

  beforeEach(() => {
    graph = new EventGraph();
  });

  describe('nodes', () => {
    it('adds and retrieves a node', () => {
      const node: GraphNode = {
        id: 'place-order',
        type: 'command',
        label: 'Place Order',
        context: 'payments',
      };
      graph.addNode(node);
      expect(graph.getNode('payments.place-order')).toEqual(node);
    });

    it('returns undefined for unknown node', () => {
      expect(graph.getNode('payments.unknown')).toBeUndefined();
    });

    it('lists all nodes', () => {
      graph.addNode({ id: 'a', type: 'event', label: 'A', context: 'ctx1' });
      graph.addNode({ id: 'b', type: 'event', label: 'B', context: 'ctx2' });
      expect(graph.getAllNodes()).toHaveLength(2);
    });

    it('filters nodes by context', () => {
      graph.addNode({ id: 'a', type: 'event', label: 'A', context: 'ctx1' });
      graph.addNode({ id: 'b', type: 'event', label: 'B', context: 'ctx2' });
      expect(graph.getNodesByContext('ctx1')).toHaveLength(1);
      expect(graph.getNodesByContext('ctx1')[0].id).toBe('a');
    });

    it('filters nodes by type', () => {
      graph.addNode({ id: 'a', type: 'command', label: 'A', context: 'ctx' });
      graph.addNode({ id: 'b', type: 'event', label: 'B', context: 'ctx' });
      expect(graph.getNodesByType('event')).toHaveLength(1);
    });

    it('removes a node and its edges', () => {
      graph.addNode({ id: 'a', type: 'command', label: 'A', context: 'ctx' });
      graph.addNode({ id: 'b', type: 'event', label: 'B', context: 'ctx' });
      graph.addEdge({ from: 'ctx.a', to: 'ctx.b', type: 'produces' });
      graph.removeNode('ctx.a');
      expect(graph.getNode('ctx.a')).toBeUndefined();
      expect(graph.getAllEdges()).toHaveLength(0);
    });
  });

  describe('edges', () => {
    it('adds and retrieves edges', () => {
      graph.addNode({ id: 'a', type: 'command', label: 'A', context: 'ctx' });
      graph.addNode({ id: 'b', type: 'event', label: 'B', context: 'ctx' });
      graph.addEdge({ from: 'ctx.a', to: 'ctx.b', type: 'produces' });

      const outgoing = graph.getOutgoingEdges('ctx.a');
      expect(outgoing).toHaveLength(1);
      expect(outgoing[0].to).toBe('ctx.b');

      const incoming = graph.getIncomingEdges('ctx.b');
      expect(incoming).toHaveLength(1);
      expect(incoming[0].from).toBe('ctx.a');
    });

    it('lists all edges', () => {
      graph.addNode({ id: 'a', type: 'command', label: 'A', context: 'ctx' });
      graph.addNode({ id: 'b', type: 'event', label: 'B', context: 'ctx' });
      graph.addEdge({ from: 'ctx.a', to: 'ctx.b', type: 'produces' });
      expect(graph.getAllEdges()).toHaveLength(1);
    });
  });

  describe('traversal', () => {
    it('finds downstream nodes', () => {
      graph.addNode({ id: 'cmd', type: 'command', label: 'Cmd', context: 'c' });
      graph.addNode({ id: 'evt', type: 'event', label: 'Evt', context: 'c' });
      graph.addNode({ id: 'rm', type: 'read-model', label: 'RM', context: 'c' });
      graph.addEdge({ from: 'c.cmd', to: 'c.evt', type: 'produces' });
      graph.addEdge({ from: 'c.evt', to: 'c.rm', type: 'projects-to' });

      const downstream = graph.getDownstream('c.cmd');
      expect(downstream.map(n => n.id)).toEqual(['evt', 'rm']);
    });

    it('finds upstream nodes', () => {
      graph.addNode({ id: 'cmd', type: 'command', label: 'Cmd', context: 'c' });
      graph.addNode({ id: 'evt', type: 'event', label: 'Evt', context: 'c' });
      graph.addNode({ id: 'rm', type: 'read-model', label: 'RM', context: 'c' });
      graph.addEdge({ from: 'c.cmd', to: 'c.evt', type: 'produces' });
      graph.addEdge({ from: 'c.evt', to: 'c.rm', type: 'projects-to' });

      const upstream = graph.getUpstream('c.rm');
      expect(upstream.map(n => n.id)).toEqual(['evt', 'cmd']);
    });

    it('finds path between two nodes', () => {
      graph.addNode({ id: 'cmd', type: 'command', label: 'Cmd', context: 'c' });
      graph.addNode({ id: 'evt', type: 'event', label: 'Evt', context: 'c' });
      graph.addNode({ id: 'rm', type: 'read-model', label: 'RM', context: 'c' });
      graph.addEdge({ from: 'c.cmd', to: 'c.evt', type: 'produces' });
      graph.addEdge({ from: 'c.evt', to: 'c.rm', type: 'projects-to' });

      const path = graph.findPath('c.cmd', 'c.rm');
      expect(path?.map(n => n.id)).toEqual(['cmd', 'evt', 'rm']);
    });

    it('returns null for no path', () => {
      graph.addNode({ id: 'a', type: 'command', label: 'A', context: 'c' });
      graph.addNode({ id: 'b', type: 'event', label: 'B', context: 'c' });
      expect(graph.findPath('c.a', 'c.b')).toBeNull();
    });

    it('handles cross-context edges', () => {
      graph.addNode({ id: 'evt', type: 'event', label: 'Evt', context: 'payments' });
      graph.addNode({ id: 'policy', type: 'policy', label: 'P', context: 'shipping' });
      graph.addEdge({ from: 'payments.evt', to: 'shipping.policy', type: 'triggers' });

      const downstream = graph.getDownstream('payments.evt');
      expect(downstream).toHaveLength(1);
      expect(downstream[0].context).toBe('shipping');
    });
  });

  describe('contexts', () => {
    it('lists all contexts', () => {
      graph.addNode({ id: 'a', type: 'event', label: 'A', context: 'payments' });
      graph.addNode({ id: 'b', type: 'event', label: 'B', context: 'shipping' });
      expect(graph.getContexts().sort()).toEqual(['payments', 'shipping']);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test -- --filter core`
Expected: FAIL — cannot find module '../graph.js'

- [ ] **Step 3: Write implementation**

`packages/core/src/graph.ts`:
```typescript
import type { GraphNode, GraphEdge } from './schema.js';
import { qualifiedId } from './schema.js';

export class EventGraph {
  private nodes = new Map<string, GraphNode>();
  private outgoing = new Map<string, GraphEdge[]>();
  private incoming = new Map<string, GraphEdge[]>();

  addNode(node: GraphNode): void {
    const qid = qualifiedId(node.context, node.id);
    this.nodes.set(qid, node);
  }

  getNode(qualifiedId: string): GraphNode | undefined {
    return this.nodes.get(qualifiedId);
  }

  removeNode(qualifiedId: string): void {
    this.nodes.delete(qualifiedId);
    const edgesToRemove = [
      ...(this.outgoing.get(qualifiedId) ?? []),
      ...(this.incoming.get(qualifiedId) ?? []),
    ];
    for (const edge of edgesToRemove) {
      this.removeEdgeInternal(edge);
    }
    this.outgoing.delete(qualifiedId);
    this.incoming.delete(qualifiedId);
  }

  getAllNodes(): GraphNode[] {
    return [...this.nodes.values()];
  }

  getNodesByContext(context: string): GraphNode[] {
    return this.getAllNodes().filter(n => n.context === context);
  }

  getNodesByType(type: string): GraphNode[] {
    return this.getAllNodes().filter(n => n.type === type);
  }

  getContexts(): string[] {
    const contexts = new Set<string>();
    for (const node of this.nodes.values()) {
      contexts.add(node.context);
    }
    return [...contexts];
  }

  addEdge(edge: GraphEdge): void {
    const out = this.outgoing.get(edge.from) ?? [];
    out.push(edge);
    this.outgoing.set(edge.from, out);

    const inc = this.incoming.get(edge.to) ?? [];
    inc.push(edge);
    this.incoming.set(edge.to, inc);
  }

  getOutgoingEdges(qualifiedId: string): GraphEdge[] {
    return this.outgoing.get(qualifiedId) ?? [];
  }

  getIncomingEdges(qualifiedId: string): GraphEdge[] {
    return this.incoming.get(qualifiedId) ?? [];
  }

  getAllEdges(): GraphEdge[] {
    const edges: GraphEdge[] = [];
    for (const list of this.outgoing.values()) {
      edges.push(...list);
    }
    return edges;
  }

  getDownstream(startId: string, maxDepth = Infinity): GraphNode[] {
    const visited = new Set<string>();
    const result: GraphNode[] = [];
    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);

      if (id !== startId) {
        const node = this.nodes.get(id);
        if (node) result.push(node);
      }

      if (depth < maxDepth) {
        for (const edge of this.getOutgoingEdges(id)) {
          if (!visited.has(edge.to)) {
            queue.push({ id: edge.to, depth: depth + 1 });
          }
        }
      }
    }

    return result;
  }

  getUpstream(startId: string, maxDepth = Infinity): GraphNode[] {
    const visited = new Set<string>();
    const result: GraphNode[] = [];
    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);

      if (id !== startId) {
        const node = this.nodes.get(id);
        if (node) result.push(node);
      }

      if (depth < maxDepth) {
        for (const edge of this.getIncomingEdges(id)) {
          if (!visited.has(edge.from)) {
            queue.push({ id: edge.from, depth: depth + 1 });
          }
        }
      }
    }

    return result;
  }

  findPath(fromId: string, toId: string): GraphNode[] | null {
    const visited = new Set<string>();
    const parent = new Map<string, string>();
    const queue = [fromId];
    visited.add(fromId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === toId) {
        const path: GraphNode[] = [];
        let id = toId;
        while (id !== undefined) {
          const node = this.nodes.get(id);
          if (node) path.unshift(node);
          id = parent.get(id)!;
        }
        return path;
      }

      for (const edge of this.getOutgoingEdges(current)) {
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          parent.set(edge.to, current);
          queue.push(edge.to);
        }
      }
    }

    return null;
  }

  private removeEdgeInternal(edge: GraphEdge): void {
    const out = this.outgoing.get(edge.from);
    if (out) {
      const idx = out.indexOf(edge);
      if (idx !== -1) out.splice(idx, 1);
    }
    const inc = this.incoming.get(edge.to);
    if (inc) {
      const idx = inc.indexOf(edge);
      if (idx !== -1) inc.splice(idx, 1);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test -- --filter core`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/graph.ts packages/core/src/__tests__/graph.test.ts
git commit -m "feat(core): add in-memory graph data structure with traversal"
```

---

### Task 4: Core — YAML Parser

**Files:**
- Create: `packages/core/src/parser.ts`
- Create: `packages/core/src/__tests__/parser.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/__tests__/parser.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadProject, loadContext, loadConfig } from '../parser.js';

const TMP = join(tmpdir(), 'eventgraph-test-' + Date.now());

function setupProject(config: string, contexts: Record<string, string>) {
  const egDir = join(TMP, 'eventgraph');
  mkdirSync(join(egDir, 'contexts'), { recursive: true });
  writeFileSync(join(egDir, 'eventgraph.yaml'), config);

  for (const [name, content] of Object.entries(contexts)) {
    mkdirSync(join(egDir, 'contexts', name), { recursive: true });
    writeFileSync(join(egDir, 'contexts', name, 'model.yaml'), content);
  }
  return egDir;
}

describe('parser', () => {
  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('loads a project config', () => {
    const dir = setupProject(`
name: test-project
version: 1
preset: event-modeling
agent:
  write: prompt
contexts:
  - payments
`, { payments: `
context: payments
nodes: []
edges: []
` });

    const config = loadConfig(dir);
    expect(config.name).toBe('test-project');
    expect(config.preset).toBe('event-modeling');
    expect(config.agent.write).toBe('prompt');
    expect(config.contexts).toEqual(['payments']);
  });

  it('loads a context model into a graph', () => {
    const dir = setupProject(`
name: test
version: 1
preset: event-modeling
agent:
  write: auto
contexts:
  - payments
`, { payments: `
context: payments
nodes:
  - id: place-order
    type: command
    label: Place Order
    data:
      fields: [orderId, total]
  - id: order-placed
    type: event
    label: Order Placed
edges:
  - from: place-order
    to: order-placed
    type: produces
` });

    const graph = loadContext(dir, 'payments');
    expect(graph.getAllNodes()).toHaveLength(2);
    expect(graph.getNode('payments.place-order')?.label).toBe('Place Order');
    expect(graph.getNode('payments.place-order')?.data?.fields).toEqual(['orderId', 'total']);
    expect(graph.getAllEdges()).toHaveLength(1);
    expect(graph.getAllEdges()[0].from).toBe('payments.place-order');
  });

  it('loads full project with cross-context edges', () => {
    const dir = setupProject(`
name: test
version: 1
preset: event-modeling
agent:
  write: prompt
contexts:
  - payments
  - shipping
`, {
      payments: `
context: payments
nodes:
  - id: order-placed
    type: event
    label: Order Placed
edges:
  - from: order-placed
    to: shipping.start-fulfillment
    type: triggers
`,
      shipping: `
context: shipping
nodes:
  - id: start-fulfillment
    type: policy
    label: Start Fulfillment
edges: []
`,
    });

    const { config, graph } = loadProject(dir);
    expect(config.name).toBe('test');
    expect(graph.getAllNodes()).toHaveLength(2);
    expect(graph.getContexts().sort()).toEqual(['payments', 'shipping']);

    const downstream = graph.getDownstream('payments.order-placed');
    expect(downstream).toHaveLength(1);
    expect(downstream[0].context).toBe('shipping');
  });

  it('throws on missing eventgraph.yaml', () => {
    mkdirSync(join(TMP, 'eventgraph'), { recursive: true });
    expect(() => loadConfig(join(TMP, 'eventgraph'))).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test -- --filter core`
Expected: FAIL — cannot find module '../parser.js'

- [ ] **Step 3: Write implementation**

`packages/core/src/parser.ts`:
```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ProjectConfig, ContextModel } from './schema.js';
import { qualifiedId } from './schema.js';
import { EventGraph } from './graph.js';

export function loadConfig(projectDir: string): ProjectConfig {
  const configPath = join(projectDir, 'eventgraph.yaml');
  const content = readFileSync(configPath, 'utf-8');
  const raw = parseYaml(content);
  return raw as ProjectConfig;
}

export function loadContext(projectDir: string, contextName: string): EventGraph {
  const modelPath = join(projectDir, 'contexts', contextName, 'model.yaml');
  const content = readFileSync(modelPath, 'utf-8');
  const raw = parseYaml(content) as ContextModel;

  const graph = new EventGraph();
  loadContextIntoGraph(graph, raw);
  return graph;
}

export function loadContextIntoGraph(graph: EventGraph, model: ContextModel): void {
  for (const node of model.nodes) {
    graph.addNode({
      ...node,
      context: model.context,
    });
  }

  for (const edge of model.edges) {
    const from = edge.from.includes('.')
      ? edge.from
      : qualifiedId(model.context, edge.from);
    const to = edge.to.includes('.')
      ? edge.to
      : qualifiedId(model.context, edge.to);

    graph.addEdge({ ...edge, from, to });
  }
}

export function loadProject(projectDir: string): { config: ProjectConfig; graph: EventGraph } {
  const config = loadConfig(projectDir);
  const graph = new EventGraph();

  for (const contextName of config.contexts) {
    const modelPath = join(projectDir, 'contexts', contextName, 'model.yaml');
    const content = readFileSync(modelPath, 'utf-8');
    const model = parseYaml(content) as ContextModel;
    loadContextIntoGraph(graph, model);
  }

  return { config, graph };
}

export function findProjectDir(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, 'eventgraph');
    try {
      readFileSync(join(candidate, 'eventgraph.yaml'));
      return candidate;
    } catch {
      const parent = join(dir, '..');
      if (parent === dir) return null;
      dir = parent;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test -- --filter core`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/parser.ts packages/core/src/__tests__/parser.test.ts
git commit -m "feat(core): add YAML parser for project config and context models"
```

---

### Task 5: Core — Query Engine

**Files:**
- Create: `packages/core/src/query.ts`
- Create: `packages/core/src/__tests__/query.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/__tests__/query.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { EventGraph } from '../graph.js';
import { QueryEngine } from '../query.js';

describe('QueryEngine', () => {
  let graph: EventGraph;
  let engine: QueryEngine;

  beforeEach(() => {
    graph = new EventGraph();
    graph.addNode({ id: 'place-order', type: 'command', label: 'Place Order', context: 'payments' });
    graph.addNode({ id: 'order-placed', type: 'event', label: 'Order Placed', context: 'payments' });
    graph.addNode({ id: 'order-summary', type: 'read-model', label: 'Order Summary', context: 'payments' });
    graph.addNode({ id: 'start-fulfillment', type: 'policy', label: 'Start Fulfillment', context: 'shipping' });
    graph.addNode({ id: 'order-screen', type: 'screen', label: 'Order Screen', context: 'payments' });
    graph.addEdge({ from: 'payments.place-order', to: 'payments.order-placed', type: 'produces' });
    graph.addEdge({ from: 'payments.order-placed', to: 'payments.order-summary', type: 'projects-to' });
    graph.addEdge({ from: 'payments.order-placed', to: 'shipping.start-fulfillment', type: 'triggers' });
    graph.addEdge({ from: 'payments.order-screen', to: 'payments.order-summary', type: 'reads' });
    engine = new QueryEngine(graph);
  });

  it('filters by type', () => {
    const result = engine.query('type:event');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('order-placed');
  });

  it('filters by context', () => {
    const result = engine.query('context:shipping');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('start-fulfillment');
  });

  it('combines type and context filters', () => {
    const result = engine.query('type:command context:payments');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('place-order');
  });

  it('finds downstream nodes', () => {
    const result = engine.query('downstream:order-placed');
    expect(result.map(n => n.id).sort()).toEqual(['order-summary', 'start-fulfillment']);
  });

  it('finds upstream nodes', () => {
    const result = engine.query('upstream:order-summary');
    expect(result.map(n => n.id).sort()).toEqual(['order-placed', 'place-order']);
  });

  it('finds path between nodes', () => {
    const result = engine.query('path:place-order..order-summary');
    expect(result.map(n => n.id)).toEqual(['place-order', 'order-placed', 'order-summary']);
  });

  it('returns empty for path with no connection', () => {
    const result = engine.query('path:order-summary..place-order');
    expect(result).toHaveLength(0);
  });

  it('searches by label text', () => {
    const result = engine.query('Order');
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it('returns all nodes for empty query', () => {
    const result = engine.query('');
    expect(result).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test -- --filter core`
Expected: FAIL — cannot find module '../query.js'

- [ ] **Step 3: Write implementation**

`packages/core/src/query.ts`:
```typescript
import type { GraphNode } from './schema.js';
import type { EventGraph } from './graph.js';

interface QueryFilter {
  type?: string;
  context?: string;
  downstream?: string;
  upstream?: string;
  path?: { from: string; to: string };
  text?: string;
}

export class QueryEngine {
  constructor(private graph: EventGraph) {}

  query(expr: string): GraphNode[] {
    const filter = this.parseExpression(expr);

    if (filter.path) {
      const fromId = this.resolveNodeId(filter.path.from);
      const toId = this.resolveNodeId(filter.path.to);
      if (!fromId || !toId) return [];
      return this.graph.findPath(fromId, toId) ?? [];
    }

    if (filter.downstream) {
      const nodeId = this.resolveNodeId(filter.downstream);
      if (!nodeId) return [];
      return this.graph.getDownstream(nodeId);
    }

    if (filter.upstream) {
      const nodeId = this.resolveNodeId(filter.upstream);
      if (!nodeId) return [];
      return this.graph.getUpstream(nodeId);
    }

    let nodes = this.graph.getAllNodes();

    if (filter.type) {
      nodes = nodes.filter(n => n.type === filter.type);
    }

    if (filter.context) {
      nodes = nodes.filter(n => n.context === filter.context);
    }

    if (filter.text) {
      const lower = filter.text.toLowerCase();
      nodes = nodes.filter(n =>
        n.label.toLowerCase().includes(lower) ||
        n.id.toLowerCase().includes(lower)
      );
    }

    return nodes;
  }

  private parseExpression(expr: string): QueryFilter {
    const filter: QueryFilter = {};
    const parts = expr.trim().split(/\s+/);

    for (const part of parts) {
      if (part.startsWith('type:')) {
        filter.type = part.substring(5);
      } else if (part.startsWith('context:')) {
        filter.context = part.substring(8);
      } else if (part.startsWith('downstream:')) {
        filter.downstream = part.substring(11);
      } else if (part.startsWith('upstream:')) {
        filter.upstream = part.substring(9);
      } else if (part.startsWith('path:')) {
        const pathExpr = part.substring(5);
        const [from, to] = pathExpr.split('..');
        if (from && to) {
          filter.path = { from, to };
        }
      } else if (part.length > 0) {
        filter.text = (filter.text ? filter.text + ' ' : '') + part;
      }
    }

    return filter;
  }

  private resolveNodeId(shortId: string): string | null {
    if (shortId.includes('.')) {
      return this.graph.getNode(shortId) ? shortId : null;
    }
    const allNodes = this.graph.getAllNodes();
    const match = allNodes.find(n => n.id === shortId);
    if (!match) return null;
    return `${match.context}.${match.id}`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test -- --filter core`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/query.ts packages/core/src/__tests__/query.test.ts
git commit -m "feat(core): add query engine with filter, traversal, and text search"
```

---

### Task 6: Core — Impact Analysis

**Files:**
- Create: `packages/core/src/impact.ts`
- Create: `packages/core/src/__tests__/impact.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/__tests__/impact.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { EventGraph } from '../graph.js';
import { analyzeImpact, type ImpactResult } from '../impact.js';

describe('analyzeImpact', () => {
  let graph: EventGraph;

  beforeEach(() => {
    graph = new EventGraph();
    graph.addNode({ id: 'place-order', type: 'command', label: 'Place Order', context: 'payments' });
    graph.addNode({ id: 'order-placed', type: 'event', label: 'Order Placed', context: 'payments' });
    graph.addNode({ id: 'order-summary', type: 'read-model', label: 'Order Summary', context: 'payments' });
    graph.addNode({ id: 'order-screen', type: 'screen', label: 'Order Screen', context: 'payments' });
    graph.addNode({ id: 'start-fulfillment', type: 'policy', label: 'Start Fulfillment', context: 'shipping' });
    graph.addNode({ id: 'shipment-started', type: 'event', label: 'Shipment Started', context: 'shipping' });
    graph.addEdge({ from: 'payments.place-order', to: 'payments.order-placed', type: 'produces' });
    graph.addEdge({ from: 'payments.order-placed', to: 'payments.order-summary', type: 'projects-to' });
    graph.addEdge({ from: 'payments.order-screen', to: 'payments.order-summary', type: 'reads' });
    graph.addEdge({ from: 'payments.order-placed', to: 'shipping.start-fulfillment', type: 'triggers' });
    graph.addEdge({ from: 'shipping.start-fulfillment', to: 'shipping.shipment-started', type: 'produces' });
  });

  it('returns direct and transitive downstream nodes', () => {
    const result = analyzeImpact(graph, 'payments.order-placed');
    expect(result.direct.map(n => n.id).sort()).toEqual(['order-summary', 'start-fulfillment']);
    expect(result.transitive.map(n => n.id)).toEqual(['shipment-started']);
  });

  it('lists affected contexts', () => {
    const result = analyzeImpact(graph, 'payments.order-placed');
    expect(result.affectedContexts.sort()).toEqual(['payments', 'shipping']);
  });

  it('detects cross-context impact', () => {
    const result = analyzeImpact(graph, 'payments.order-placed');
    expect(result.crossContext).toBe(true);
  });

  it('calculates risk based on node count', () => {
    const result = analyzeImpact(graph, 'payments.order-placed');
    expect(result.totalAffected).toBe(3);
    expect(result.risk).toBe('medium');
  });

  it('returns low risk for leaf nodes', () => {
    const result = analyzeImpact(graph, 'shipping.shipment-started');
    expect(result.totalAffected).toBe(0);
    expect(result.risk).toBe('low');
  });

  it('includes upstream dependents (who reads this?)', () => {
    const result = analyzeImpact(graph, 'payments.order-summary');
    expect(result.upstreamDependents.map(n => n.id)).toContain('order-screen');
  });

  it('respects depth limit', () => {
    const result = analyzeImpact(graph, 'payments.order-placed', { maxDepth: 1 });
    expect(result.direct.map(n => n.id).sort()).toEqual(['order-summary', 'start-fulfillment']);
    expect(result.transitive).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test -- --filter core`
Expected: FAIL — cannot find module '../impact.js'

- [ ] **Step 3: Write implementation**

`packages/core/src/impact.ts`:
```typescript
import type { GraphNode } from './schema.js';
import type { EventGraph } from './graph.js';

export interface ImpactOptions {
  maxDepth?: number;
}

export interface ImpactResult {
  node: GraphNode;
  direct: GraphNode[];
  transitive: GraphNode[];
  upstreamDependents: GraphNode[];
  affectedContexts: string[];
  crossContext: boolean;
  totalAffected: number;
  risk: 'low' | 'medium' | 'high';
}

export function analyzeImpact(
  graph: EventGraph,
  qualifiedId: string,
  options: ImpactOptions = {},
): ImpactResult {
  const maxDepth = options.maxDepth ?? Infinity;
  const sourceNode = graph.getNode(qualifiedId);
  if (!sourceNode) {
    throw new Error(`Node not found: ${qualifiedId}`);
  }

  const direct = graph.getDownstream(qualifiedId, 1);

  const allDownstream = graph.getDownstream(qualifiedId, maxDepth);
  const directIds = new Set(direct.map(n => `${n.context}.${n.id}`));
  const transitive = allDownstream.filter(n => !directIds.has(`${n.context}.${n.id}`));

  const upstreamDependents = graph.getUpstream(qualifiedId, 1);

  const affectedContexts = new Set<string>();
  for (const node of allDownstream) {
    affectedContexts.add(node.context);
  }
  if (allDownstream.length > 0) {
    affectedContexts.add(sourceNode.context);
  }

  const totalAffected = allDownstream.length;
  const crossContext = affectedContexts.size > 1;

  let risk: 'low' | 'medium' | 'high';
  if (totalAffected === 0) {
    risk = 'low';
  } else if (totalAffected <= 3 && !crossContext) {
    risk = 'low';
  } else if (totalAffected <= 6 || !crossContext) {
    risk = 'medium';
  } else {
    risk = 'high';
  }

  return {
    node: sourceNode,
    direct,
    transitive,
    upstreamDependents,
    affectedContexts: [...affectedContexts],
    crossContext,
    totalAffected,
    risk,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test -- --filter core`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/impact.ts packages/core/src/__tests__/impact.test.ts
git commit -m "feat(core): add impact analysis with risk assessment"
```

---

### Task 7: Core — Preset Validation

**Files:**
- Create: `packages/core/src/validate.ts`
- Create: `packages/core/src/__tests__/validate.test.ts`
- Create: `presets/event-modeling.yaml`
- Create: `presets/generic.yaml`

- [ ] **Step 1: Write the failing test**

`packages/core/src/__tests__/validate.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { EventGraph } from '../graph.js';
import { validateGraph, loadPreset, type ValidationError } from '../validate.js';
import type { PresetDefinition } from '../schema.js';

const EVENT_MODELING_PRESET: PresetDefinition = {
  name: 'event-modeling',
  nodeTypes: ['command', 'event', 'read-model', 'policy', 'screen', 'aggregate'],
  edgeTypes: ['produces', 'projects-to', 'triggers', 'reads'],
  edgeRules: [
    { type: 'produces', from: 'command', to: 'event' },
    { type: 'projects-to', from: 'event', to: 'read-model' },
    { type: 'triggers', from: 'event', to: 'policy' },
    { type: 'reads', from: 'screen', to: 'read-model' },
    { type: 'reads', from: 'policy', to: 'read-model' },
  ],
};

describe('validateGraph', () => {
  let graph: EventGraph;

  beforeEach(() => {
    graph = new EventGraph();
  });

  it('passes for a valid graph', () => {
    graph.addNode({ id: 'cmd', type: 'command', label: 'Cmd', context: 'c' });
    graph.addNode({ id: 'evt', type: 'event', label: 'Evt', context: 'c' });
    graph.addEdge({ from: 'c.cmd', to: 'c.evt', type: 'produces' });

    const errors = validateGraph(graph, EVENT_MODELING_PRESET);
    expect(errors).toHaveLength(0);
  });

  it('rejects unknown node types', () => {
    graph.addNode({ id: 'x', type: 'unknown-type', label: 'X', context: 'c' });
    const errors = validateGraph(graph, EVENT_MODELING_PRESET);
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('invalid-node-type');
    expect(errors[0].nodeId).toBe('c.x');
  });

  it('rejects unknown edge types', () => {
    graph.addNode({ id: 'a', type: 'command', label: 'A', context: 'c' });
    graph.addNode({ id: 'b', type: 'event', label: 'B', context: 'c' });
    graph.addEdge({ from: 'c.a', to: 'c.b', type: 'unknown-edge' });

    const errors = validateGraph(graph, EVENT_MODELING_PRESET);
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('invalid-edge-type');
  });

  it('rejects edges violating rules (command → read-model via produces)', () => {
    graph.addNode({ id: 'cmd', type: 'command', label: 'Cmd', context: 'c' });
    graph.addNode({ id: 'rm', type: 'read-model', label: 'RM', context: 'c' });
    graph.addEdge({ from: 'c.cmd', to: 'c.rm', type: 'produces' });

    const errors = validateGraph(graph, EVENT_MODELING_PRESET);
    expect(errors.some(e => e.type === 'edge-rule-violation')).toBe(true);
  });

  it('detects dangling edge references', () => {
    graph.addNode({ id: 'a', type: 'command', label: 'A', context: 'c' });
    graph.addEdge({ from: 'c.a', to: 'c.nonexistent', type: 'produces' });

    const errors = validateGraph(graph, EVENT_MODELING_PRESET);
    expect(errors.some(e => e.type === 'dangling-edge')).toBe(true);
  });

  it('allows any types with generic preset', () => {
    const generic: PresetDefinition = {
      name: 'generic',
      nodeTypes: [],
      edgeTypes: [],
      edgeRules: [],
    };
    graph.addNode({ id: 'x', type: 'anything', label: 'X', context: 'c' });
    graph.addNode({ id: 'y', type: 'whatever', label: 'Y', context: 'c' });
    graph.addEdge({ from: 'c.x', to: 'c.y', type: 'custom-edge' });

    const errors = validateGraph(graph, generic);
    expect(errors).toHaveLength(0);
  });
});

describe('loadPreset', () => {
  it('loads event-modeling preset from YAML', () => {
    const preset = loadPreset('event-modeling', new URL('../../../presets', import.meta.url).pathname);
    expect(preset.name).toBe('event-modeling');
    expect(preset.nodeTypes).toContain('command');
    expect(preset.edgeRules.length).toBeGreaterThan(0);
  });

  it('loads generic preset from YAML', () => {
    const preset = loadPreset('generic', new URL('../../../presets', import.meta.url).pathname);
    expect(preset.name).toBe('generic');
    expect(preset.nodeTypes).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Create preset YAML files**

`presets/event-modeling.yaml`:
```yaml
name: event-modeling
nodeTypes:
  - command
  - event
  - read-model
  - policy
  - screen
  - aggregate
edgeTypes:
  - produces
  - projects-to
  - triggers
  - reads
edgeRules:
  - type: produces
    from: command
    to: event
  - type: projects-to
    from: event
    to: read-model
  - type: triggers
    from: event
    to: policy
  - type: reads
    from: screen
    to: read-model
  - type: reads
    from: policy
    to: read-model
```

`presets/generic.yaml`:
```yaml
name: generic
nodeTypes: []
edgeTypes: []
edgeRules: []
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test -- --filter core`
Expected: FAIL — cannot find module '../validate.js'

- [ ] **Step 4: Write implementation**

`packages/core/src/validate.ts`:
```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { PresetDefinition } from './schema.js';
import type { EventGraph } from './graph.js';

export interface ValidationError {
  type: 'invalid-node-type' | 'invalid-edge-type' | 'edge-rule-violation' | 'dangling-edge';
  message: string;
  nodeId?: string;
  edgeFrom?: string;
  edgeTo?: string;
}

export function loadPreset(name: string, presetsDir: string): PresetDefinition {
  const filePath = join(presetsDir, `${name}.yaml`);
  const content = readFileSync(filePath, 'utf-8');
  return parseYaml(content) as PresetDefinition;
}

export function validateGraph(graph: EventGraph, preset: PresetDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  const isPermissive = preset.nodeTypes.length === 0 && preset.edgeTypes.length === 0;

  if (!isPermissive) {
    for (const node of graph.getAllNodes()) {
      if (!preset.nodeTypes.includes(node.type)) {
        errors.push({
          type: 'invalid-node-type',
          message: `Node "${node.context}.${node.id}" has invalid type "${node.type}". Allowed: ${preset.nodeTypes.join(', ')}`,
          nodeId: `${node.context}.${node.id}`,
        });
      }
    }
  }

  for (const edge of graph.getAllEdges()) {
    const fromNode = graph.getNode(edge.from);
    const toNode = graph.getNode(edge.to);

    if (!fromNode || !toNode) {
      errors.push({
        type: 'dangling-edge',
        message: `Edge from "${edge.from}" to "${edge.to}" references a non-existent node`,
        edgeFrom: edge.from,
        edgeTo: edge.to,
      });
      continue;
    }

    if (!isPermissive && !preset.edgeTypes.includes(edge.type)) {
      errors.push({
        type: 'invalid-edge-type',
        message: `Edge from "${edge.from}" to "${edge.to}" has invalid type "${edge.type}". Allowed: ${preset.edgeTypes.join(', ')}`,
        edgeFrom: edge.from,
        edgeTo: edge.to,
      });
      continue;
    }

    if (preset.edgeRules.length > 0) {
      const matchingRules = preset.edgeRules.filter(r => r.type === edge.type);
      if (matchingRules.length > 0) {
        const valid = matchingRules.some(r => r.from === fromNode.type && r.to === toNode.type);
        if (!valid) {
          errors.push({
            type: 'edge-rule-violation',
            message: `Edge "${edge.type}" from "${edge.from}" (${fromNode.type}) to "${edge.to}" (${toNode.type}) violates preset rules`,
            edgeFrom: edge.from,
            edgeTo: edge.to,
          });
        }
      }
    }
  }

  return errors;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test -- --filter core`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/validate.ts packages/core/src/__tests__/validate.test.ts presets/event-modeling.yaml presets/generic.yaml
git commit -m "feat(core): add preset validation with event-modeling and generic presets"
```

---

### Task 8: Core — Writer (Graph Mutations → YAML)

**Files:**
- Create: `packages/core/src/writer.ts`
- Create: `packages/core/src/__tests__/writer.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/__tests__/writer.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addNodeToContext, addEdgeToContext, removeNodeFromContext, generateYamlDiff } from '../writer.js';
import type { ContextModelNode, GraphEdge } from '../schema.js';
import { parse as parseYaml } from 'yaml';

const TMP = join(tmpdir(), 'eventgraph-writer-test-' + Date.now());

function setupContext(contextName: string, content: string): string {
  const dir = join(TMP, 'eventgraph');
  mkdirSync(join(dir, 'contexts', contextName), { recursive: true });
  writeFileSync(join(dir, 'contexts', contextName, 'model.yaml'), content);
  return dir;
}

describe('writer', () => {
  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('adds a node to a context YAML file', () => {
    const dir = setupContext('payments', `context: payments\nnodes:\n  - id: existing\n    type: event\n    label: Existing\nedges: []\n`);
    const node: ContextModelNode = { id: 'new-cmd', type: 'command', label: 'New Command' };
    addNodeToContext(dir, 'payments', node);

    const content = readFileSync(join(dir, 'contexts', 'payments', 'model.yaml'), 'utf-8');
    const model = parseYaml(content);
    expect(model.nodes).toHaveLength(2);
    expect(model.nodes[1].id).toBe('new-cmd');
  });

  it('adds an edge to a context YAML file', () => {
    const dir = setupContext('payments', `context: payments\nnodes:\n  - id: a\n    type: command\n    label: A\n  - id: b\n    type: event\n    label: B\nedges: []\n`);
    const edge: GraphEdge = { from: 'a', to: 'b', type: 'produces' };
    addEdgeToContext(dir, 'payments', edge);

    const content = readFileSync(join(dir, 'contexts', 'payments', 'model.yaml'), 'utf-8');
    const model = parseYaml(content);
    expect(model.edges).toHaveLength(1);
    expect(model.edges[0].type).toBe('produces');
  });

  it('removes a node and its edges from a context YAML file', () => {
    const dir = setupContext('payments', `context: payments\nnodes:\n  - id: a\n    type: command\n    label: A\n  - id: b\n    type: event\n    label: B\nedges:\n  - from: a\n    to: b\n    type: produces\n`);
    removeNodeFromContext(dir, 'payments', 'a');

    const content = readFileSync(join(dir, 'contexts', 'payments', 'model.yaml'), 'utf-8');
    const model = parseYaml(content);
    expect(model.nodes).toHaveLength(1);
    expect(model.nodes[0].id).toBe('b');
    expect(model.edges).toHaveLength(0);
  });

  it('generates a YAML diff for a node addition', () => {
    const dir = setupContext('payments', `context: payments\nnodes: []\nedges: []\n`);
    const node: ContextModelNode = { id: 'new-cmd', type: 'command', label: 'New Command' };
    const diff = generateYamlDiff(dir, 'payments', { addNodes: [node] });

    expect(diff).toContain('new-cmd');
    expect(diff).toContain('+');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test -- --filter core`
Expected: FAIL — cannot find module '../writer.js'

- [ ] **Step 3: Write implementation**

`packages/core/src/writer.ts`:
```typescript
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ContextModel, ContextModelNode, GraphEdge } from './schema.js';

function readContextModel(projectDir: string, contextName: string): ContextModel {
  const path = join(projectDir, 'contexts', contextName, 'model.yaml');
  const content = readFileSync(path, 'utf-8');
  return parseYaml(content) as ContextModel;
}

function writeContextModel(projectDir: string, contextName: string, model: ContextModel): void {
  const path = join(projectDir, 'contexts', contextName, 'model.yaml');
  writeFileSync(path, stringifyYaml(model, { lineWidth: 120 }));
}

export function addNodeToContext(projectDir: string, contextName: string, node: ContextModelNode): void {
  const model = readContextModel(projectDir, contextName);
  model.nodes.push(node);
  writeContextModel(projectDir, contextName, model);
}

export function addEdgeToContext(projectDir: string, contextName: string, edge: GraphEdge): void {
  const model = readContextModel(projectDir, contextName);
  model.edges.push(edge);
  writeContextModel(projectDir, contextName, model);
}

export function removeNodeFromContext(projectDir: string, contextName: string, nodeId: string): void {
  const model = readContextModel(projectDir, contextName);
  model.nodes = model.nodes.filter(n => n.id !== nodeId);
  model.edges = model.edges.filter(e => {
    const fromId = e.from.includes('.') ? e.from.split('.').pop()! : e.from;
    const toId = e.to.includes('.') ? e.to.split('.').pop()! : e.to;
    return fromId !== nodeId && toId !== nodeId;
  });
  writeContextModel(projectDir, contextName, model);
}

export interface DiffChanges {
  addNodes?: ContextModelNode[];
  addEdges?: GraphEdge[];
  removeNodes?: string[];
}

export function generateYamlDiff(
  projectDir: string,
  contextName: string,
  changes: DiffChanges,
): string {
  const before = readFileSync(
    join(projectDir, 'contexts', contextName, 'model.yaml'),
    'utf-8',
  );
  const model = parseYaml(before) as ContextModel;

  if (changes.addNodes) {
    for (const node of changes.addNodes) model.nodes.push(node);
  }
  if (changes.addEdges) {
    for (const edge of changes.addEdges) model.edges.push(edge);
  }
  if (changes.removeNodes) {
    for (const nodeId of changes.removeNodes) {
      model.nodes = model.nodes.filter(n => n.id !== nodeId);
      model.edges = model.edges.filter(e => {
        const fromId = e.from.includes('.') ? e.from.split('.').pop()! : e.from;
        const toId = e.to.includes('.') ? e.to.split('.').pop()! : e.to;
        return fromId !== nodeId && toId !== nodeId;
      });
    }
  }

  const after = stringifyYaml(model, { lineWidth: 120 });

  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const diff: string[] = [];

  diff.push(`--- contexts/${contextName}/model.yaml`);
  diff.push(`+++ contexts/${contextName}/model.yaml (proposed)`);

  for (const line of beforeLines) {
    if (!afterLines.includes(line)) {
      diff.push(`- ${line}`);
    }
  }
  for (const line of afterLines) {
    if (!beforeLines.includes(line)) {
      diff.push(`+ ${line}`);
    }
  }

  return diff.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test -- --filter core`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/writer.ts packages/core/src/__tests__/writer.test.ts
git commit -m "feat(core): add writer for YAML mutations and diff generation"
```

---

### Task 9: Core — Public API + JSON Schema

**Files:**
- Create: `packages/core/src/index.ts`
- Create: `schema/eventgraph.schema.json`

- [ ] **Step 1: Create public API barrel export**

`packages/core/src/index.ts`:
```typescript
export type {
  GraphNode,
  GraphEdge,
  ContextModel,
  ContextModelNode,
  ProjectConfig,
  PresetDefinition,
  EdgeRule,
} from './schema.js';

export {
  EVENT_MODELING_NODE_TYPES,
  EVENT_MODELING_EDGE_TYPES,
  GENERIC_NODE_TYPES,
  GENERIC_EDGE_TYPES,
  qualifiedId,
  parseQualifiedId,
} from './schema.js';

export { EventGraph } from './graph.js';
export { loadProject, loadContext, loadConfig, loadContextIntoGraph, findProjectDir } from './parser.js';
export { QueryEngine } from './query.js';
export { analyzeImpact, type ImpactResult, type ImpactOptions } from './impact.js';
export { validateGraph, loadPreset, type ValidationError } from './validate.js';
export { addNodeToContext, addEdgeToContext, removeNodeFromContext, generateYamlDiff, type DiffChanges } from './writer.js';
```

- [ ] **Step 2: Create JSON Schema for editor support**

`schema/eventgraph.schema.json`:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://eventgraph.dev/schema/context-model.json",
  "title": "EventGraph Context Model",
  "description": "Schema for eventgraph context model YAML files",
  "type": "object",
  "required": ["context", "nodes", "edges"],
  "properties": {
    "context": {
      "type": "string",
      "description": "Bounded context name"
    },
    "nodes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "type", "label"],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9-]*$",
            "description": "Unique node identifier (kebab-case)"
          },
          "type": {
            "type": "string",
            "description": "Node type (e.g., command, event, read-model)"
          },
          "label": {
            "type": "string",
            "description": "Human-readable name"
          },
          "data": {
            "type": "object",
            "description": "Free-form data (fields, descriptions, tags)",
            "additionalProperties": true
          }
        }
      }
    },
    "edges": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["from", "to", "type"],
        "properties": {
          "from": {
            "type": "string",
            "description": "Source node ID (or context.id for cross-context)"
          },
          "to": {
            "type": "string",
            "description": "Target node ID (or context.id for cross-context)"
          },
          "type": {
            "type": "string",
            "description": "Edge type (e.g., produces, projects-to, triggers)"
          },
          "metadata": {
            "type": "object",
            "description": "Free-form edge metadata",
            "additionalProperties": true
          }
        }
      }
    }
  }
}
```

- [ ] **Step 3: Verify core builds cleanly**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm --filter @eventgraph/core run build`
Expected: Clean build, dist/ directory created

- [ ] **Step 4: Run all core tests**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test -- --filter core`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts schema/eventgraph.schema.json
git commit -m "feat(core): add public API exports and JSON Schema for editor support"
```

---

### Task 10: CLI — Scaffold + Utility Helpers

**Files:**
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/util.ts`

- [ ] **Step 1: Create CLI entrypoint**

`packages/cli/src/index.ts`:
```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { registerInitCommand } from './commands/init.js';
import { registerQueryCommand } from './commands/query.js';
import { registerImpactCommand } from './commands/impact.js';
import { registerValidateCommand } from './commands/validate.js';
import { registerViewCommand } from './commands/view.js';
import { registerListCommand } from './commands/list.js';
import { registerAddCommand } from './commands/add.js';
import { registerConnectCommand } from './commands/connect.js';

const program = new Command();

program
  .name('eventgraph')
  .description('Agent-first architecture modeling tool')
  .version('0.1.0');

registerInitCommand(program);
registerQueryCommand(program);
registerImpactCommand(program);
registerValidateCommand(program);
registerViewCommand(program);
registerListCommand(program);
registerAddCommand(program);
registerConnectCommand(program);

program.parse();
```

- [ ] **Step 2: Create shared CLI utility**

`packages/cli/src/util.ts`:
```typescript
import { findProjectDir, loadProject, type ProjectConfig, type EventGraph } from '@eventgraph/core';

export interface LoadedProject {
  projectDir: string;
  config: ProjectConfig;
  graph: EventGraph;
}

export function loadOrFail(): LoadedProject {
  const projectDir = findProjectDir();
  if (!projectDir) {
    console.error('Error: No eventgraph project found. Run "eventgraph init" first.');
    process.exit(1);
  }
  const { config, graph } = loadProject(projectDir);
  return { projectDir, config, graph };
}

export function formatNode(node: { id: string; type: string; label: string; context: string }): string {
  const typeColors: Record<string, string> = {
    command: '\x1b[34m',     // blue
    event: '\x1b[33m',      // amber
    'read-model': '\x1b[32m', // green
    policy: '\x1b[31m',     // red
    screen: '\x1b[35m',     // purple
    aggregate: '\x1b[36m',  // cyan
    service: '\x1b[90m',    // gray
  };
  const color = typeColors[node.type] ?? '\x1b[37m';
  const reset = '\x1b[0m';
  return `${color}[${node.type}]${reset} ${node.context}.${node.id} — ${node.label}`;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/src/util.ts
git commit -m "feat(cli): add CLI entrypoint and shared utilities"
```

---

### Task 11: CLI — init Command

**Files:**
- Create: `packages/cli/src/commands/init.ts`

- [ ] **Step 1: Write implementation**

`packages/cli/src/commands/init.ts`:
```typescript
import { Command } from 'commander';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import inquirer from 'inquirer';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new eventgraph project')
    .option('-d, --dir <path>', 'Target directory', process.cwd())
    .action(async (opts) => {
      const targetDir = join(opts.dir, 'eventgraph');

      if (existsSync(join(targetDir, 'eventgraph.yaml'))) {
        console.error('Error: eventgraph project already exists in this directory.');
        process.exit(1);
      }

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Project name:',
          default: 'my-project',
        },
        {
          type: 'list',
          name: 'preset',
          message: 'Choose a preset:',
          choices: ['event-modeling', 'generic'],
          default: 'event-modeling',
        },
        {
          type: 'list',
          name: 'agentWrite',
          message: 'Agent write mode:',
          choices: [
            { name: 'prompt — Agent proposes changes, you confirm', value: 'prompt' },
            { name: 'auto — Agent writes directly', value: 'auto' },
            { name: 'locked — Read-only for agents', value: 'locked' },
          ],
          default: 'prompt',
        },
        {
          type: 'input',
          name: 'firstContext',
          message: 'Name of your first bounded context:',
          default: 'core',
        },
      ]);

      mkdirSync(join(targetDir, 'contexts', answers.firstContext), { recursive: true });

      const config = {
        name: answers.name,
        version: 1,
        preset: answers.preset,
        agent: { write: answers.agentWrite },
        contexts: [answers.firstContext],
      };
      writeFileSync(join(targetDir, 'eventgraph.yaml'), stringifyYaml(config, { lineWidth: 120 }));

      const contextModel = {
        context: answers.firstContext,
        nodes: [],
        edges: [],
      };
      writeFileSync(
        join(targetDir, 'contexts', answers.firstContext, 'model.yaml'),
        stringifyYaml(contextModel, { lineWidth: 120 }),
      );

      console.log(`\nEventgraph project initialized at ${targetDir}`);
      console.log(`  Preset: ${answers.preset}`);
      console.log(`  Agent mode: ${answers.agentWrite}`);
      console.log(`  Context: ${answers.firstContext}`);
      console.log(`\nNext steps:`);
      console.log(`  1. Add nodes: eventgraph add command place-order --label "Place Order"`);
      console.log(`  2. Validate: eventgraph validate`);
      console.log(`  3. View: eventgraph view`);
    });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/cli/src/commands/init.ts
git commit -m "feat(cli): add interactive init command"
```

---

### Task 12: CLI — query, list, validate Commands

**Files:**
- Create: `packages/cli/src/commands/query.ts`
- Create: `packages/cli/src/commands/list.ts`
- Create: `packages/cli/src/commands/validate.ts`
- Create: `packages/cli/src/__tests__/commands.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/cli/src/__tests__/commands.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

const TMP = join(tmpdir(), 'eventgraph-cli-test-' + Date.now());

function setupTestProject() {
  const egDir = join(TMP, 'eventgraph');
  mkdirSync(join(egDir, 'contexts', 'payments'), { recursive: true });
  writeFileSync(join(egDir, 'eventgraph.yaml'), `
name: test
version: 1
preset: event-modeling
agent:
  write: prompt
contexts:
  - payments
`);
  writeFileSync(join(egDir, 'contexts', 'payments', 'model.yaml'), `
context: payments
nodes:
  - id: place-order
    type: command
    label: Place Order
  - id: order-placed
    type: event
    label: Order Placed
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
`);
  return TMP;
}

function runCli(args: string, cwd: string): string {
  const cliPath = join(__dirname, '..', '..', '..', '..', 'packages', 'cli', 'src', 'index.ts');
  return execSync(`npx tsx ${cliPath} ${args}`, { cwd, encoding: 'utf-8', env: { ...process.env } });
}

describe('CLI commands', () => {
  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('list shows all nodes', () => {
    const cwd = setupTestProject();
    const output = runCli('list', cwd);
    expect(output).toContain('place-order');
    expect(output).toContain('order-placed');
    expect(output).toContain('order-summary');
  });

  it('list filters by type', () => {
    const cwd = setupTestProject();
    const output = runCli('list --type event', cwd);
    expect(output).toContain('order-placed');
    expect(output).not.toContain('place-order');
  });

  it('query filters by expression', () => {
    const cwd = setupTestProject();
    const output = runCli('query "type:command"', cwd);
    expect(output).toContain('place-order');
    expect(output).not.toContain('order-placed');
  });

  it('validate passes for valid project', () => {
    const cwd = setupTestProject();
    const output = runCli('validate', cwd);
    expect(output).toContain('valid');
  });
});
```

- [ ] **Step 2: Write query command**

`packages/cli/src/commands/query.ts`:
```typescript
import { Command } from 'commander';
import { QueryEngine } from '@eventgraph/core';
import { loadOrFail, formatNode } from '../util.js';

export function registerQueryCommand(program: Command): void {
  program
    .command('query')
    .argument('<expression>', 'Query expression')
    .description('Query the graph (e.g., "type:event context:payments")')
    .action((expression) => {
      const { graph } = loadOrFail();
      const engine = new QueryEngine(graph);
      const results = engine.query(expression);

      if (results.length === 0) {
        console.log('No matching nodes found.');
        return;
      }

      console.log(`Found ${results.length} node(s):\n`);
      for (const node of results) {
        console.log('  ' + formatNode(node));
      }
    });
}
```

- [ ] **Step 3: Write list command**

`packages/cli/src/commands/list.ts`:
```typescript
import { Command } from 'commander';
import { loadOrFail, formatNode } from '../util.js';

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List all nodes')
    .option('-c, --context <name>', 'Filter by context')
    .option('-t, --type <type>', 'Filter by node type')
    .action((opts) => {
      const { graph } = loadOrFail();
      let nodes = graph.getAllNodes();

      if (opts.context) {
        nodes = nodes.filter(n => n.context === opts.context);
      }
      if (opts.type) {
        nodes = nodes.filter(n => n.type === opts.type);
      }

      if (nodes.length === 0) {
        console.log('No nodes found.');
        return;
      }

      console.log(`${nodes.length} node(s):\n`);
      for (const node of nodes) {
        console.log('  ' + formatNode(node));
      }
    });
}
```

- [ ] **Step 4: Write validate command**

`packages/cli/src/commands/validate.ts`:
```typescript
import { Command } from 'commander';
import { loadPreset, validateGraph } from '@eventgraph/core';
import { loadOrFail } from '../util.js';

export function registerValidateCommand(program: Command): void {
  program
    .command('validate')
    .description('Validate the model against preset rules')
    .action(() => {
      const { projectDir, config, graph } = loadOrFail();

      let presetsDir: string;
      try {
        presetsDir = new URL('../../../../presets', import.meta.url).pathname;
      } catch {
        presetsDir = projectDir + '/../presets';
      }

      const preset = loadPreset(config.preset, presetsDir);
      const errors = validateGraph(graph, preset);

      if (errors.length === 0) {
        console.log(`Model is valid. (${graph.getAllNodes().length} nodes, ${graph.getAllEdges().length} edges, preset: ${config.preset})`);
        return;
      }

      console.error(`Found ${errors.length} validation error(s):\n`);
      for (const err of errors) {
        console.error(`  ✗ [${err.type}] ${err.message}`);
      }
      process.exit(1);
    });
}
```

- [ ] **Step 5: Run tests**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/query.ts packages/cli/src/commands/list.ts packages/cli/src/commands/validate.ts packages/cli/src/__tests__/commands.test.ts
git commit -m "feat(cli): add query, list, and validate commands"
```

---

### Task 13: CLI — impact, add, connect Commands

**Files:**
- Create: `packages/cli/src/commands/impact.ts`
- Create: `packages/cli/src/commands/add.ts`
- Create: `packages/cli/src/commands/connect.ts`

- [ ] **Step 1: Write impact command**

`packages/cli/src/commands/impact.ts`:
```typescript
import { Command } from 'commander';
import { analyzeImpact } from '@eventgraph/core';
import { loadOrFail, formatNode } from '../util.js';

export function registerImpactCommand(program: Command): void {
  program
    .command('impact')
    .argument('<node-id>', 'Node ID (e.g., order-placed or payments.order-placed)')
    .description('Analyze impact: what is affected downstream?')
    .option('--depth <n>', 'Max traversal depth', '100')
    .action((nodeId, opts) => {
      const { graph } = loadOrFail();

      let qualifiedId = nodeId;
      if (!nodeId.includes('.')) {
        const match = graph.getAllNodes().find(n => n.id === nodeId);
        if (!match) {
          console.error(`Node not found: ${nodeId}`);
          process.exit(1);
        }
        qualifiedId = `${match.context}.${match.id}`;
      }

      const result = analyzeImpact(graph, qualifiedId, { maxDepth: parseInt(opts.depth) });

      const riskColors: Record<string, string> = {
        low: '\x1b[32m',
        medium: '\x1b[33m',
        high: '\x1b[31m',
      };
      const reset = '\x1b[0m';

      console.log(`\nImpact Analysis: ${qualifiedId}`);
      console.log(`Risk: ${riskColors[result.risk]}${result.risk.toUpperCase()}${reset} (${result.totalAffected} affected nodes)`);
      console.log(`Cross-context: ${result.crossContext ? 'yes' : 'no'}`);
      console.log(`Affected contexts: ${result.affectedContexts.join(', ') || 'none'}`);

      if (result.direct.length > 0) {
        console.log(`\nDirect (${result.direct.length}):`);
        for (const node of result.direct) {
          console.log('  ' + formatNode(node));
        }
      }

      if (result.transitive.length > 0) {
        console.log(`\nTransitive (${result.transitive.length}):`);
        for (const node of result.transitive) {
          console.log('  ' + formatNode(node));
        }
      }

      if (result.upstreamDependents.length > 0) {
        console.log(`\nUpstream dependents (${result.upstreamDependents.length}):`);
        for (const node of result.upstreamDependents) {
          console.log('  ' + formatNode(node));
        }
      }
    });
}
```

- [ ] **Step 2: Write add command**

`packages/cli/src/commands/add.ts`:
```typescript
import { Command } from 'commander';
import { addNodeToContext, loadConfig } from '@eventgraph/core';
import { findProjectDir } from '@eventgraph/core';
import type { ContextModelNode } from '@eventgraph/core';

export function registerAddCommand(program: Command): void {
  program
    .command('add')
    .argument('<type>', 'Node type (e.g., command, event, read-model)')
    .argument('<id>', 'Node ID (kebab-case)')
    .description('Add a node to a context')
    .option('-l, --label <label>', 'Human-readable label')
    .option('-c, --context <context>', 'Target context')
    .action((type, id, opts) => {
      const projectDir = findProjectDir();
      if (!projectDir) {
        console.error('Error: No eventgraph project found. Run "eventgraph init" first.');
        process.exit(1);
      }

      const config = loadConfig(projectDir);
      const context = opts.context ?? config.contexts[0];

      if (!config.contexts.includes(context)) {
        console.error(`Error: Context "${context}" not found. Available: ${config.contexts.join(', ')}`);
        process.exit(1);
      }

      const label = opts.label ?? id.split('-').map((w: string) => w[0].toUpperCase() + w.slice(1)).join(' ');

      const node: ContextModelNode = { id, type, label };
      addNodeToContext(projectDir, context, node);

      console.log(`Added [${type}] ${context}.${id} — ${label}`);
    });
}
```

- [ ] **Step 3: Write connect command**

`packages/cli/src/commands/connect.ts`:
```typescript
import { Command } from 'commander';
import { addEdgeToContext, findProjectDir, loadConfig } from '@eventgraph/core';

export function registerConnectCommand(program: Command): void {
  program
    .command('connect')
    .argument('<from>', 'Source node ID')
    .argument('<to>', 'Target node ID')
    .description('Create an edge between two nodes')
    .option('-t, --type <type>', 'Edge type', 'depends-on')
    .option('-c, --context <context>', 'Context to add the edge to')
    .action((from, to, opts) => {
      const projectDir = findProjectDir();
      if (!projectDir) {
        console.error('Error: No eventgraph project found. Run "eventgraph init" first.');
        process.exit(1);
      }

      const config = loadConfig(projectDir);
      const context = opts.context ?? config.contexts[0];

      if (!config.contexts.includes(context)) {
        console.error(`Error: Context "${context}" not found. Available: ${config.contexts.join(', ')}`);
        process.exit(1);
      }

      addEdgeToContext(projectDir, context, { from, to, type: opts.type });

      console.log(`Connected ${from} → ${to} [${opts.type}] in context "${context}"`);
    });
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/impact.ts packages/cli/src/commands/add.ts packages/cli/src/commands/connect.ts
git commit -m "feat(cli): add impact, add, and connect commands"
```

---

### Task 14: Viewer — HTML Generator

**Files:**
- Create: `packages/viewer/src/generate.ts`
- Create: `packages/viewer/src/layout.ts`
- Create: `packages/viewer/src/templates/styles.css`
- Create: `packages/viewer/src/templates/viewer.js`
- Create: `packages/viewer/src/__tests__/generate.test.ts`
- Create: `packages/viewer/src/__tests__/layout.test.ts`

- [ ] **Step 1: Write layout test**

`packages/viewer/src/__tests__/layout.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { EventGraph } from '@eventgraph/core';
import { computeLayout, type LayoutNode } from '../layout.js';

describe('computeLayout', () => {
  it('assigns swimlanes by node type', () => {
    const graph = new EventGraph();
    graph.addNode({ id: 'cmd', type: 'command', label: 'Cmd', context: 'c' });
    graph.addNode({ id: 'evt', type: 'event', label: 'Evt', context: 'c' });
    graph.addNode({ id: 'rm', type: 'read-model', label: 'RM', context: 'c' });
    graph.addNode({ id: 'scr', type: 'screen', label: 'Scr', context: 'c' });
    graph.addNode({ id: 'pol', type: 'policy', label: 'Pol', context: 'c' });

    const layout = computeLayout(graph);
    const byId = new Map(layout.map(n => [n.id, n]));

    expect(byId.get('c.scr')!.swimlane).toBe(0);
    expect(byId.get('c.rm')!.swimlane).toBe(1);
    expect(byId.get('c.evt')!.swimlane).toBe(2);
    expect(byId.get('c.cmd')!.swimlane).toBe(3);
    expect(byId.get('c.pol')!.swimlane).toBe(4);
  });

  it('assigns x positions based on topological order', () => {
    const graph = new EventGraph();
    graph.addNode({ id: 'cmd', type: 'command', label: 'Cmd', context: 'c' });
    graph.addNode({ id: 'evt', type: 'event', label: 'Evt', context: 'c' });
    graph.addNode({ id: 'rm', type: 'read-model', label: 'RM', context: 'c' });
    graph.addEdge({ from: 'c.cmd', to: 'c.evt', type: 'produces' });
    graph.addEdge({ from: 'c.evt', to: 'c.rm', type: 'projects-to' });

    const layout = computeLayout(graph);
    const byId = new Map(layout.map(n => [n.id, n]));

    expect(byId.get('c.cmd')!.x).toBeLessThan(byId.get('c.evt')!.x);
    expect(byId.get('c.evt')!.x).toBeLessThan(byId.get('c.rm')!.x);
  });
});
```

- [ ] **Step 2: Write layout implementation**

`packages/viewer/src/layout.ts`:
```typescript
import type { EventGraph, GraphNode } from '@eventgraph/core';

export interface LayoutNode {
  id: string;
  label: string;
  type: string;
  context: string;
  swimlane: number;
  x: number;
  y: number;
  data?: Record<string, unknown>;
}

export interface LayoutEdge {
  from: string;
  to: string;
  type: string;
}

export interface ViewerLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  swimlanes: string[];
}

const SWIMLANE_ORDER: Record<string, number> = {
  screen: 0,
  'read-model': 1,
  event: 2,
  command: 3,
  policy: 4,
  aggregate: 3,
  service: 5,
  custom: 5,
};

const SWIMLANE_HEIGHT = 80;
const NODE_WIDTH = 160;
const NODE_SPACING = 40;

export function computeLayout(graph: EventGraph): LayoutNode[] {
  const nodes = graph.getAllNodes();
  const edges = graph.getAllEdges();

  const order = topologicalOrder(nodes, edges, graph);

  const layoutNodes: LayoutNode[] = [];
  const columnCounts = new Map<number, number>();

  for (const qid of order) {
    const node = graph.getNode(qid)!;
    const swimlane = SWIMLANE_ORDER[node.type] ?? 5;
    const col = columnCounts.get(swimlane) ?? 0;
    columnCounts.set(swimlane, col + 1);

    layoutNodes.push({
      id: qid,
      label: node.label,
      type: node.type,
      context: node.context,
      swimlane,
      x: col * (NODE_WIDTH + NODE_SPACING),
      y: swimlane * SWIMLANE_HEIGHT,
      data: node.data,
    });
  }

  return layoutNodes;
}

export function computeFullLayout(graph: EventGraph): ViewerLayout {
  const nodes = computeLayout(graph);
  const edges = graph.getAllEdges().map(e => ({
    from: e.from,
    to: e.to,
    type: e.type,
  }));

  return {
    nodes,
    edges,
    swimlanes: ['Screens', 'Read Models', 'Events', 'Commands', 'Policies', 'Other'],
  };
}

function topologicalOrder(nodes: GraphNode[], edges: { from: string; to: string }[], graph: EventGraph): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    const qid = `${node.context}.${node.id}`;
    inDegree.set(qid, 0);
    adjacency.set(qid, []);
  }

  for (const edge of edges) {
    const current = inDegree.get(edge.to) ?? 0;
    inDegree.set(edge.to, current + 1);
    const adj = adjacency.get(edge.from) ?? [];
    adj.push(edge.to);
    adjacency.set(edge.from, adj);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      const deg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, deg);
      if (deg === 0) queue.push(neighbor);
    }
  }

  for (const node of nodes) {
    const qid = `${node.context}.${node.id}`;
    if (!result.includes(qid)) result.push(qid);
  }

  return result;
}
```

- [ ] **Step 3: Create CSS styles**

`packages/viewer/src/templates/styles.css`:
```css
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #0f0f1a; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
.toolbar { display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: #1e1e2e; border-bottom: 1px solid #333; }
.toolbar .filters { display: flex; gap: 4px; }
.toolbar .legend { display: flex; gap: 12px; margin-left: auto; }
.pill { padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; cursor: pointer; border: none; }
.pill.active { background: #7c3aed; color: white; }
.pill.inactive { background: #2a2a3e; color: #aaa; }
.legend-item { display: flex; align-items: center; gap: 4px; font-size: 10px; color: #888; }
.legend-dot { width: 10px; height: 10px; border-radius: 2px; }
.canvas { padding: 24px; overflow: auto; min-height: calc(100vh - 90px); position: relative; }
.swimlane-label { position: absolute; left: 16px; color: #555; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
.node { position: absolute; padding: 6px 14px; border-radius: 6px; font-size: 11px; font-weight: 500; cursor: pointer; white-space: nowrap; transition: transform 0.15s, box-shadow 0.15s; }
.node:hover { transform: scale(1.05); z-index: 10; }
.node[data-type="command"] { background: #3b82f6; color: white; box-shadow: 0 2px 8px rgba(59,130,246,0.3); }
.node[data-type="event"] { background: #f59e0b; color: #000; box-shadow: 0 2px 8px rgba(245,158,11,0.3); }
.node[data-type="read-model"] { background: #10b981; color: white; box-shadow: 0 2px 8px rgba(16,185,129,0.3); }
.node[data-type="policy"] { background: #ef4444; color: white; box-shadow: 0 2px 8px rgba(239,68,68,0.3); }
.node[data-type="screen"] { background: #8b5cf6; color: white; box-shadow: 0 2px 8px rgba(139,92,246,0.3); }
.node[data-type="aggregate"] { background: #06b6d4; color: white; box-shadow: 0 2px 8px rgba(6,182,212,0.3); }
.node[data-type="service"] { background: #6b7280; color: white; box-shadow: 0 2px 8px rgba(107,114,128,0.3); }
.detail-panel { position: fixed; bottom: 0; left: 0; right: 0; padding: 12px 16px; background: #1a1a2e; border-top: 1px solid #333; display: none; align-items: center; gap: 12px; }
.detail-panel.visible { display: flex; }
.detail-type { padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; }
.detail-name { font-size: 12px; font-weight: 500; }
.detail-id { color: #666; font-size: 11px; }
.detail-info { color: #555; font-size: 11px; margin-left: auto; }
svg.edges { position: absolute; top: 0; left: 0; pointer-events: none; }
svg.edges line { stroke: #444; stroke-width: 1; }
```

- [ ] **Step 4: Create viewer JavaScript**

`packages/viewer/src/templates/viewer.js`:
```javascript
(function() {
  const data = window.__EVENTGRAPH_DATA__;
  if (!data) return;

  const activeContexts = new Set(data.contexts);
  const detailPanel = document.getElementById('detail-panel');

  document.querySelectorAll('.context-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      const ctx = btn.dataset.context;
      if (ctx === '__all__') {
        data.contexts.forEach(c => activeContexts.add(c));
      } else if (activeContexts.has(ctx)) {
        activeContexts.delete(ctx);
      } else {
        activeContexts.add(ctx);
      }
      updateVisibility();
      updateFilterButtons();
    });
  });

  document.querySelectorAll('.node').forEach(el => {
    el.addEventListener('click', () => {
      const nodeId = el.dataset.id;
      const node = data.nodes.find(n => n.id === nodeId);
      if (!node) return;
      showDetail(node);
    });
  });

  function updateVisibility() {
    document.querySelectorAll('.node').forEach(el => {
      const ctx = el.dataset.context;
      el.style.display = activeContexts.has(ctx) ? '' : 'none';
    });
    document.querySelectorAll('.edge-line').forEach(el => {
      const fromCtx = el.dataset.fromContext;
      const toCtx = el.dataset.toContext;
      el.style.display = (activeContexts.has(fromCtx) && activeContexts.has(toCtx)) ? '' : 'none';
    });
  }

  function updateFilterButtons() {
    document.querySelectorAll('.context-filter').forEach(btn => {
      const ctx = btn.dataset.context;
      if (ctx === '__all__') {
        btn.className = 'pill ' + (activeContexts.size === data.contexts.length ? 'active' : 'inactive');
      } else {
        btn.className = 'pill ' + (activeContexts.has(ctx) ? 'active' : 'inactive');
      }
    });
  }

  function showDetail(node) {
    detailPanel.className = 'detail-panel visible';
    detailPanel.innerHTML = `
      <span class="detail-type" data-type="${node.type}">${node.type.toUpperCase()}</span>
      <span class="detail-name">${node.label}</span>
      <span class="detail-id">${node.id}</span>
      <span class="detail-info">${node.data ? 'fields: ' + (node.data.fields || []).join(', ') : ''}</span>
    `;
  }
})();
```

- [ ] **Step 5: Write HTML generator**

`packages/viewer/src/generate.ts`:
```typescript
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventGraph } from '@eventgraph/core';
import { computeFullLayout, type ViewerLayout } from './layout.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function generateViewerHtml(graph: EventGraph, projectName: string): string {
  const layout = computeFullLayout(graph);
  const css = readFileSync(join(__dirname, 'templates', 'styles.css'), 'utf-8');
  const js = readFileSync(join(__dirname, 'templates', 'viewer.js'), 'utf-8');
  const contexts = graph.getContexts();

  const NODE_LEFT_OFFSET = 100;
  const SWIMLANE_HEIGHT = 80;

  const nodeElements = layout.nodes.map(n => {
    const left = NODE_LEFT_OFFSET + n.x;
    const top = 24 + n.y;
    return `<div class="node" data-type="${n.type}" data-id="${n.id}" data-context="${n.context}" style="left:${left}px;top:${top}px">${n.label}</div>`;
  }).join('\n');

  const nodePositions = new Map(layout.nodes.map(n => [
    n.id,
    { x: NODE_LEFT_OFFSET + n.x + 80, y: 24 + n.y + 16 },
  ]));

  const edgeLines = layout.edges.map(e => {
    const from = nodePositions.get(e.from);
    const to = nodePositions.get(e.to);
    if (!from || !to) return '';
    const fromNode = layout.nodes.find(n => n.id === e.from);
    const toNode = layout.nodes.find(n => n.id === e.to);
    return `<line class="edge-line" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" data-from-context="${fromNode?.context}" data-to-context="${toNode?.context}" />`;
  }).join('\n');

  const filterButtons = [
    `<button class="pill active context-filter" data-context="__all__">All</button>`,
    ...contexts.map(c => `<button class="pill inactive context-filter" data-context="${c}">${c}</button>`),
  ].join('\n');

  const swimlaneLabels = layout.swimlanes.map((label, i) =>
    `<span class="swimlane-label" style="top:${28 + i * SWIMLANE_HEIGHT}px">${label}</span>`
  ).join('\n');

  const canvasHeight = (layout.swimlanes.length + 1) * SWIMLANE_HEIGHT;
  const maxX = Math.max(...layout.nodes.map(n => n.x + NODE_LEFT_OFFSET + 200), 800);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>eventgraph — ${projectName}</title>
<style>${css}</style>
</head>
<body>
<div class="toolbar">
  <div class="filters">${filterButtons}</div>
  <div class="legend">
    <span class="legend-item"><span class="legend-dot" style="background:#3b82f6"></span>Command</span>
    <span class="legend-item"><span class="legend-dot" style="background:#f59e0b"></span>Event</span>
    <span class="legend-item"><span class="legend-dot" style="background:#10b981"></span>Read Model</span>
    <span class="legend-item"><span class="legend-dot" style="background:#ef4444"></span>Policy</span>
    <span class="legend-item"><span class="legend-dot" style="background:#8b5cf6"></span>Screen</span>
  </div>
</div>
<div class="canvas" style="height:${canvasHeight}px;width:${maxX}px">
  ${swimlaneLabels}
  <svg class="edges" width="${maxX}" height="${canvasHeight}">
    ${edgeLines}
  </svg>
  ${nodeElements}
</div>
<div id="detail-panel" class="detail-panel"></div>
<script>
window.__EVENTGRAPH_DATA__ = ${JSON.stringify({ nodes: layout.nodes, edges: layout.edges, contexts })};
${js}
</script>
</body>
</html>`;
}
```

- [ ] **Step 6: Write generate test**

`packages/viewer/src/__tests__/generate.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { EventGraph } from '@eventgraph/core';
import { generateViewerHtml } from '../generate.js';

describe('generateViewerHtml', () => {
  it('generates valid HTML with embedded data', () => {
    const graph = new EventGraph();
    graph.addNode({ id: 'cmd', type: 'command', label: 'Place Order', context: 'payments' });
    graph.addNode({ id: 'evt', type: 'event', label: 'Order Placed', context: 'payments' });
    graph.addEdge({ from: 'payments.cmd', to: 'payments.evt', type: 'produces' });

    const html = generateViewerHtml(graph, 'test-project');

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('test-project');
    expect(html).toContain('Place Order');
    expect(html).toContain('Order Placed');
    expect(html).toContain('__EVENTGRAPH_DATA__');
    expect(html).toContain('data-type="command"');
    expect(html).toContain('data-type="event"');
  });

  it('includes context filter buttons', () => {
    const graph = new EventGraph();
    graph.addNode({ id: 'a', type: 'event', label: 'A', context: 'payments' });
    graph.addNode({ id: 'b', type: 'event', label: 'B', context: 'shipping' });

    const html = generateViewerHtml(graph, 'test');
    expect(html).toContain('data-context="payments"');
    expect(html).toContain('data-context="shipping"');
    expect(html).toContain('data-context="__all__"');
  });
});
```

- [ ] **Step 7: Run tests**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add packages/viewer/src/ packages/viewer/src/__tests__/
git commit -m "feat(viewer): add static HTML viewer with timeline layout"
```

---

### Task 15: CLI — view Command

**Files:**
- Create: `packages/cli/src/commands/view.ts`

- [ ] **Step 1: Write implementation**

`packages/cli/src/commands/view.ts`:
```typescript
import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { generateViewerHtml } from '@eventgraph/viewer';
import { loadOrFail } from '../util.js';

export function registerViewCommand(program: Command): void {
  program
    .command('view')
    .description('Generate and open the HTML viewer')
    .option('-o, --output <path>', 'Output file path')
    .option('--no-open', 'Do not open in browser')
    .action((opts) => {
      const { projectDir, config, graph } = loadOrFail();

      const html = generateViewerHtml(graph, config.name);
      const outputPath = opts.output ?? join(projectDir, '..', 'eventgraph-viewer.html');

      writeFileSync(outputPath, html);
      console.log(`Viewer generated: ${outputPath}`);

      if (opts.open !== false) {
        const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${openCmd} "${outputPath}"`);
      }
    });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/cli/src/commands/view.ts
git commit -m "feat(cli): add view command to generate and open HTML viewer"
```

---

### Task 16: MCP — Server + Read Tools

**Files:**
- Create: `packages/mcp/src/server.ts`
- Create: `packages/mcp/src/tools/read.ts`
- Create: `packages/mcp/src/__tests__/read.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/mcp/src/__tests__/read.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createReadTools } from '../tools/read.js';
import { loadProject } from '@eventgraph/core';

const TMP = join(tmpdir(), 'eventgraph-mcp-test-' + Date.now());

function setupTestProject() {
  const egDir = join(TMP, 'eventgraph');
  mkdirSync(join(egDir, 'contexts', 'payments'), { recursive: true });
  writeFileSync(join(egDir, 'eventgraph.yaml'), `
name: test
version: 1
preset: event-modeling
agent:
  write: prompt
contexts:
  - payments
`);
  writeFileSync(join(egDir, 'contexts', 'payments', 'model.yaml'), `
context: payments
nodes:
  - id: place-order
    type: command
    label: Place Order
  - id: order-placed
    type: event
    label: Order Placed
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
`);
  return egDir;
}

describe('MCP read tools', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = setupTestProject();
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('eventgraph_query returns matching nodes', async () => {
    const { config, graph } = loadProject(projectDir);
    const tools = createReadTools(graph, config, projectDir);

    const result = await tools.eventgraph_query({ expr: 'type:event' });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe('order-placed');
  });

  it('eventgraph_impact returns impact analysis', async () => {
    const { config, graph } = loadProject(projectDir);
    const tools = createReadTools(graph, config, projectDir);

    const result = await tools.eventgraph_impact({ nodeId: 'order-placed' });
    expect(result.totalAffected).toBe(1);
    expect(result.risk).toBe('low');
  });

  it('eventgraph_get_node returns a single node', async () => {
    const { config, graph } = loadProject(projectDir);
    const tools = createReadTools(graph, config, projectDir);

    const result = await tools.eventgraph_get_node({ nodeId: 'payments.place-order' });
    expect(result.node?.label).toBe('Place Order');
  });

  it('eventgraph_list_contexts returns all contexts', async () => {
    const { config, graph } = loadProject(projectDir);
    const tools = createReadTools(graph, config, projectDir);

    const result = await tools.eventgraph_list_contexts({});
    expect(result.contexts).toEqual(['payments']);
  });

  it('eventgraph_validate returns validation result', async () => {
    const { config, graph } = loadProject(projectDir);
    const tools = createReadTools(graph, config, projectDir);

    const result = await tools.eventgraph_validate({});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Write read tools implementation**

`packages/mcp/src/tools/read.ts`:
```typescript
import {
  type EventGraph,
  type ProjectConfig,
  type GraphNode,
  QueryEngine,
  analyzeImpact,
  validateGraph,
  loadPreset,
} from '@eventgraph/core';

export interface ReadToolsApi {
  eventgraph_query(input: { expr: string }): Promise<{ nodes: GraphNode[] }>;
  eventgraph_impact(input: { nodeId: string; depth?: number }): Promise<{
    direct: GraphNode[];
    transitive: GraphNode[];
    affectedContexts: string[];
    crossContext: boolean;
    totalAffected: number;
    risk: string;
  }>;
  eventgraph_get_node(input: { nodeId: string }): Promise<{ node: GraphNode | null }>;
  eventgraph_list_contexts(input: Record<string, never>): Promise<{ contexts: string[] }>;
  eventgraph_validate(input: Record<string, never>): Promise<{ valid: boolean; errors: Array<{ type: string; message: string }> }>;
}

export function createReadTools(graph: EventGraph, config: ProjectConfig, projectDir: string): ReadToolsApi {
  const queryEngine = new QueryEngine(graph);

  return {
    async eventgraph_query({ expr }) {
      const nodes = queryEngine.query(expr);
      return { nodes };
    },

    async eventgraph_impact({ nodeId, depth }) {
      let qualifiedId = nodeId;
      if (!nodeId.includes('.')) {
        const match = graph.getAllNodes().find(n => n.id === nodeId);
        if (!match) return { direct: [], transitive: [], affectedContexts: [], crossContext: false, totalAffected: 0, risk: 'low' };
        qualifiedId = `${match.context}.${match.id}`;
      }

      const result = analyzeImpact(graph, qualifiedId, { maxDepth: depth });
      return {
        direct: result.direct,
        transitive: result.transitive,
        affectedContexts: result.affectedContexts,
        crossContext: result.crossContext,
        totalAffected: result.totalAffected,
        risk: result.risk,
      };
    },

    async eventgraph_get_node({ nodeId }) {
      const node = graph.getNode(nodeId) ?? null;
      return { node };
    },

    async eventgraph_list_contexts() {
      return { contexts: graph.getContexts() };
    },

    async eventgraph_validate() {
      let presetsDir: string;
      try {
        presetsDir = new URL('../../../../presets', import.meta.url).pathname;
      } catch {
        presetsDir = projectDir + '/../presets';
      }
      const preset = loadPreset(config.preset, presetsDir);
      const errors = validateGraph(graph, preset);
      return {
        valid: errors.length === 0,
        errors: errors.map(e => ({ type: e.type, message: e.message })),
      };
    },
  };
}
```

- [ ] **Step 3: Write MCP server entrypoint**

`packages/mcp/src/server.ts`:
```typescript
#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { findProjectDir, loadProject } from '@eventgraph/core';
import { createReadTools } from './tools/read.js';

const projectDir = findProjectDir();
if (!projectDir) {
  console.error('Error: No eventgraph project found.');
  process.exit(1);
}

const { config, graph } = loadProject(projectDir);
const readTools = createReadTools(graph, config, projectDir);

const server = new McpServer({
  name: 'eventgraph',
  version: '0.1.0',
});

server.tool(
  'eventgraph_query',
  'Query the architecture graph. Examples: "type:event", "context:payments", "downstream:order-placed"',
  { expr: z.string().describe('Query expression') },
  async ({ expr }) => {
    const result = await readTools.eventgraph_query({ expr });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_impact',
  'Analyze impact: what is affected if this node changes?',
  {
    nodeId: z.string().describe('Node ID (e.g., order-placed or payments.order-placed)'),
    depth: z.number().optional().describe('Max traversal depth'),
  },
  async ({ nodeId, depth }) => {
    const result = await readTools.eventgraph_impact({ nodeId, depth });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_get_node',
  'Get details for a single node',
  { nodeId: z.string().describe('Qualified node ID (e.g., payments.order-placed)') },
  async ({ nodeId }) => {
    const result = await readTools.eventgraph_get_node({ nodeId });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_list_contexts',
  'List all bounded contexts in the project',
  {},
  async () => {
    const result = await readTools.eventgraph_list_contexts({});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_validate',
  'Validate the model against preset rules',
  {},
  async () => {
    const result = await readTools.eventgraph_validate({});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/server.ts packages/mcp/src/tools/read.ts packages/mcp/src/__tests__/read.test.ts
git commit -m "feat(mcp): add MCP server with read tools"
```

---

### Task 17: MCP — Write + Meta Tools

**Files:**
- Create: `packages/mcp/src/tools/write.ts`
- Create: `packages/mcp/src/tools/meta.ts`
- Create: `packages/mcp/src/__tests__/write.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/mcp/src/__tests__/write.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWriteTools } from '../tools/write.js';
import { loadProject } from '@eventgraph/core';
import { parse as parseYaml } from 'yaml';

const TMP = join(tmpdir(), 'eventgraph-write-test-' + Date.now());

function setupTestProject() {
  const egDir = join(TMP, 'eventgraph');
  mkdirSync(join(egDir, 'contexts', 'payments'), { recursive: true });
  writeFileSync(join(egDir, 'eventgraph.yaml'), `
name: test
version: 1
preset: event-modeling
agent:
  write: auto
contexts:
  - payments
`);
  writeFileSync(join(egDir, 'contexts', 'payments', 'model.yaml'), `
context: payments
nodes:
  - id: place-order
    type: command
    label: Place Order
edges: []
`);
  return egDir;
}

describe('MCP write tools', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = setupTestProject();
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('adds a node in auto mode', async () => {
    const { config, graph } = loadProject(projectDir);
    const tools = createWriteTools(graph, config, projectDir);

    const result = await tools.eventgraph_add_node({
      context: 'payments',
      id: 'order-placed',
      type: 'event',
      label: 'Order Placed',
    });
    expect(result.success).toBe(true);

    const content = readFileSync(join(projectDir, 'contexts', 'payments', 'model.yaml'), 'utf-8');
    const model = parseYaml(content);
    expect(model.nodes).toHaveLength(2);
  });

  it('returns diff in prompt mode', async () => {
    const egDir = join(TMP, 'eventgraph');
    writeFileSync(join(egDir, 'eventgraph.yaml'), `
name: test
version: 1
preset: event-modeling
agent:
  write: prompt
contexts:
  - payments
`);
    const { config, graph } = loadProject(egDir);
    const tools = createWriteTools(graph, config, egDir);

    const result = await tools.eventgraph_add_node({
      context: 'payments',
      id: 'order-placed',
      type: 'event',
      label: 'Order Placed',
    });
    expect(result.success).toBe(false);
    expect(result.pendingDiff).toBeDefined();
    expect(result.pendingDiff).toContain('order-placed');
  });

  it('rejects writes in locked mode', async () => {
    const egDir = join(TMP, 'eventgraph');
    writeFileSync(join(egDir, 'eventgraph.yaml'), `
name: test
version: 1
preset: event-modeling
agent:
  write: locked
contexts:
  - payments
`);
    const { config, graph } = loadProject(egDir);
    const tools = createWriteTools(graph, config, egDir);

    const result = await tools.eventgraph_add_node({
      context: 'payments',
      id: 'order-placed',
      type: 'event',
      label: 'Order Placed',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('locked');
  });
});
```

- [ ] **Step 2: Write write tools**

`packages/mcp/src/tools/write.ts`:
```typescript
import {
  type EventGraph,
  type ProjectConfig,
  addNodeToContext,
  addEdgeToContext,
  removeNodeFromContext,
  generateYamlDiff,
  analyzeImpact,
} from '@eventgraph/core';

interface WriteResult {
  success: boolean;
  error?: string;
  pendingDiff?: string;
}

export interface WriteToolsApi {
  eventgraph_add_node(input: { context: string; id: string; type: string; label: string; data?: Record<string, unknown> }): Promise<WriteResult>;
  eventgraph_add_edge(input: { context: string; from: string; to: string; type: string }): Promise<WriteResult>;
  eventgraph_update_node(input: { nodeId: string; label?: string; data?: Record<string, unknown> }): Promise<WriteResult>;
  eventgraph_remove_node(input: { nodeId: string }): Promise<WriteResult>;
}

export function createWriteTools(graph: EventGraph, config: ProjectConfig, projectDir: string): WriteToolsApi {
  const mode = config.agent.write;

  return {
    async eventgraph_add_node({ context, id, type, label, data }) {
      if (mode === 'locked') {
        return { success: false, error: 'Write mode is locked. Agent cannot modify the model.' };
      }

      const node = { id, type, label, ...(data ? { data } : {}) };

      if (mode === 'prompt') {
        const diff = generateYamlDiff(projectDir, context, { addNodes: [node] });
        return { success: false, pendingDiff: diff };
      }

      addNodeToContext(projectDir, context, node);
      return { success: true };
    },

    async eventgraph_add_edge({ context, from, to, type }) {
      if (mode === 'locked') {
        return { success: false, error: 'Write mode is locked. Agent cannot modify the model.' };
      }

      const edge = { from, to, type };

      if (mode === 'prompt') {
        const diff = generateYamlDiff(projectDir, context, { addEdges: [edge] });
        return { success: false, pendingDiff: diff };
      }

      addEdgeToContext(projectDir, context, edge);
      return { success: true };
    },

    async eventgraph_update_node({ nodeId }) {
      if (mode === 'locked') {
        return { success: false, error: 'Write mode is locked. Agent cannot modify the model.' };
      }
      return { success: false, error: 'Update not yet implemented in MVP' };
    },

    async eventgraph_remove_node({ nodeId }) {
      if (mode === 'locked') {
        return { success: false, error: 'Write mode is locked. Agent cannot modify the model.' };
      }

      const node = graph.getNode(nodeId);
      if (!node) {
        return { success: false, error: `Node not found: ${nodeId}` };
      }

      const impact = analyzeImpact(graph, nodeId);
      const warning = `Removing ${nodeId} affects ${impact.totalAffected} downstream nodes (risk: ${impact.risk})`;

      if (mode === 'prompt') {
        const diff = generateYamlDiff(projectDir, node.context, { removeNodes: [node.id] });
        return { success: false, pendingDiff: `${warning}\n\n${diff}` };
      }

      removeNodeFromContext(projectDir, node.context, node.id);
      return { success: true };
    },
  };
}
```

- [ ] **Step 3: Write meta tools**

`packages/mcp/src/tools/meta.ts`:
```typescript
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import {
  type EventGraph,
  type ProjectConfig,
  loadConfig,
} from '@eventgraph/core';
import { generateViewerHtml } from '@eventgraph/viewer';

export interface MetaToolsApi {
  eventgraph_view(input: Record<string, never>): Promise<{ path: string }>;
  eventgraph_init_context(input: { name: string }): Promise<{ success: boolean }>;
}

export function createMetaTools(graph: EventGraph, config: ProjectConfig, projectDir: string): MetaToolsApi {
  return {
    async eventgraph_view() {
      const html = generateViewerHtml(graph, config.name);
      const outputPath = join(projectDir, '..', 'eventgraph-viewer.html');
      writeFileSync(outputPath, html);
      return { path: outputPath };
    },

    async eventgraph_init_context({ name }) {
      mkdirSync(join(projectDir, 'contexts', name), { recursive: true });
      const model = { context: name, nodes: [], edges: [] };
      writeFileSync(
        join(projectDir, 'contexts', name, 'model.yaml'),
        stringifyYaml(model, { lineWidth: 120 }),
      );

      const currentConfig = loadConfig(projectDir);
      if (!currentConfig.contexts.includes(name)) {
        currentConfig.contexts.push(name);
        writeFileSync(
          join(projectDir, 'eventgraph.yaml'),
          stringifyYaml(currentConfig, { lineWidth: 120 }),
        );
      }

      return { success: true };
    },
  };
}
```

- [ ] **Step 4: Register write and meta tools in server.ts**

Add to `packages/mcp/src/server.ts` after the read tool registrations:

```typescript
import { createWriteTools } from './tools/write.js';
import { createMetaTools } from './tools/meta.js';

const writeTools = createWriteTools(graph, config, projectDir);
const metaTools = createMetaTools(graph, config, projectDir);

server.tool(
  'eventgraph_add_node',
  'Add a node to the architecture graph',
  {
    context: z.string().describe('Bounded context name'),
    id: z.string().describe('Node ID (kebab-case)'),
    type: z.string().describe('Node type (command, event, read-model, etc.)'),
    label: z.string().describe('Human-readable label'),
  },
  async (input) => {
    const result = await writeTools.eventgraph_add_node(input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_add_edge',
  'Create an edge between two nodes',
  {
    context: z.string().describe('Context to add the edge to'),
    from: z.string().describe('Source node ID'),
    to: z.string().describe('Target node ID'),
    type: z.string().describe('Edge type (produces, projects-to, triggers, reads, depends-on)'),
  },
  async (input) => {
    const result = await writeTools.eventgraph_add_edge(input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_remove_node',
  'Remove a node (shows impact warning first)',
  { nodeId: z.string().describe('Qualified node ID to remove') },
  async (input) => {
    const result = await writeTools.eventgraph_remove_node(input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'eventgraph_view',
  'Generate the HTML viewer',
  {},
  async () => {
    const result = await metaTools.eventgraph_view({});
    return { content: [{ type: 'text', text: `Viewer generated at: ${result.path}` }] };
  },
);

server.tool(
  'eventgraph_init_context',
  'Create a new bounded context',
  { name: z.string().describe('Context name') },
  async (input) => {
    const result = await metaTools.eventgraph_init_context(input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);
```

- [ ] **Step 5: Run all tests**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/src/tools/write.ts packages/mcp/src/tools/meta.ts packages/mcp/src/__tests__/write.test.ts packages/mcp/src/server.ts
git commit -m "feat(mcp): add write and meta tools with configurable agent autonomy"
```

---

### Task 18: Integration — End-to-End Smoke Test

**Files:**
- Create: `packages/cli/src/__tests__/e2e.test.ts`

- [ ] **Step 1: Write end-to-end test**

`packages/cli/src/__tests__/e2e.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

const TMP = join(tmpdir(), 'eventgraph-e2e-' + Date.now());
const CLI = join(__dirname, '..', '..', '..', '..', 'packages', 'cli', 'src', 'index.ts');

function run(args: string): string {
  return execSync(`npx tsx ${CLI} ${args}`, { cwd: TMP, encoding: 'utf-8' });
}

function setupProject() {
  const egDir = join(TMP, 'eventgraph');
  mkdirSync(join(egDir, 'contexts', 'payments'), { recursive: true });
  mkdirSync(join(egDir, 'contexts', 'shipping'), { recursive: true });

  writeFileSync(join(egDir, 'eventgraph.yaml'), `
name: e2e-test
version: 1
preset: event-modeling
agent:
  write: prompt
contexts:
  - payments
  - shipping
`);

  writeFileSync(join(egDir, 'contexts', 'payments', 'model.yaml'), `
context: payments
nodes:
  - id: place-order
    type: command
    label: Place Order
    data:
      fields: [orderId, customerId, items, total]
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
`);

  writeFileSync(join(egDir, 'contexts', 'shipping', 'model.yaml'), `
context: shipping
nodes:
  - id: start-fulfillment
    type: policy
    label: Start Fulfillment
  - id: shipment-started
    type: event
    label: Shipment Started
edges:
  - from: start-fulfillment
    to: shipment-started
    type: produces
`);
}

describe('E2E', () => {
  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('full workflow: list → query → impact → validate → view', () => {
    setupProject();

    const list = run('list');
    expect(list).toContain('place-order');
    expect(list).toContain('start-fulfillment');
    expect(list).toContain('5 node(s)');

    const query = run('query "type:event"');
    expect(query).toContain('order-placed');
    expect(query).toContain('shipment-started');

    const impact = run('impact order-placed');
    expect(impact).toContain('order-summary');
    expect(impact).toContain('start-fulfillment');
    expect(impact).toContain('Cross-context: yes');

    const validate = run('validate');
    expect(validate).toContain('valid');

    const view = run(`view --no-open -o ${join(TMP, 'test-viewer.html')}`);
    expect(view).toContain('Viewer generated');
    expect(existsSync(join(TMP, 'test-viewer.html'))).toBe(true);

    const html = readFileSync(join(TMP, 'test-viewer.html'), 'utf-8');
    expect(html).toContain('Place Order');
    expect(html).toContain('data-context="payments"');
    expect(html).toContain('data-context="shipping"');
  });
});
```

- [ ] **Step 2: Run the full test suite**

Run: `cd /Users/igor/Private/research/eventgraph && pnpm test`
Expected: All tests PASS across all packages

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/__tests__/e2e.test.ts
git commit -m "test: add end-to-end smoke test for full CLI workflow"
```

---

## Self-Review

**Spec coverage check:**
- Graph schema & data model → Task 2 (schema types)
- In-memory graph → Task 3
- YAML parser → Task 4
- Query engine → Task 5
- Impact analysis → Task 6
- Preset validation → Task 7
- Writer (mutations) → Task 8
- Public API → Task 9
- CLI init → Task 11
- CLI query/list/validate → Task 12
- CLI impact/add/connect → Task 13
- Viewer → Task 14
- CLI view → Task 15
- MCP read tools → Task 16
- MCP write/meta tools → Task 17
- E2E test → Task 18
- Presets → Task 7 (created alongside validation)
- JSON Schema → Task 9

All spec requirements covered.

**Placeholder scan:** No TBDs, TODOs, or "fill in later" found.

**Type consistency check:**
- `GraphNode` used consistently with `id`, `type`, `label`, `context`, `data` fields
- `qualifiedId()` and dot-notation used consistently for cross-context references
- `loadProject()` returns `{ config, graph }` — used consistently in CLI and MCP
- `EventGraph` methods (`getDownstream`, `getUpstream`, `findPath`, `getAllNodes`, etc.) match between definition (Task 3) and usage (Tasks 5, 6, 14, 16)
- `createReadTools`, `createWriteTools`, `createMetaTools` signatures match between definition and server.ts registration
