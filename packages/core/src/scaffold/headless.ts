import type { ContextModelNode } from '../schema.js';
import { screen } from './surfaces.js';
import { IdSet, kebab, type ScaffoldSource } from './sources.js';

/**
 * Finds the headless edge of an app: CLI subcommands and agent tools, the
 * surfaces an agent or a test drives instead of the UI.
 *
 * These are surfaces, not commands. `eventgraph check` is a subcommand and
 * changes nothing; `orders place` is one too and does. Telling them apart, and
 * naming the domain command behind the second, is the modelling — so each
 * becomes a `cli` or `tool` surface pointing at its file, and the `offers` and
 * `reads` edges are left for a person to draw.
 *
 * TS and JS only, and only the two registrations that say what they are:
 *
 *   - commander's `.command('name …')`. The method name is common enough —
 *     a chat bot, a job queue, a test harness — that the file must also import
 *     commander, and the name must be a string literal, or it is left alone.
 *     `new Command('name')` is not read: it is just as often the root program
 *     as a subcommand, and the two look identical.
 *   - the MCP TypeScript SDK's `server.tool('name', …)` and
 *     `server.registerTool('name', …)`, in a file importing from that SDK. A
 *     module handed a server without importing anything from the SDK is missed,
 *     as are tools listed through a raw `ListTools` request handler.
 *
 * Nesting is not resolved: `remote add` registered as `.command('add')` on a
 * `remote` subcommand comes out as `add`.
 */

const SCRIPT = /\.(tsx?|jsx?|mjs|cjs)$/;

// A computed name (`${prefix}-run`) is skipped by refusing `$` inside it.
const SUBCOMMAND = /\.\s*command\s*\(\s*(['"`])([^'"`$]+)\1/g;
const COMMANDER = /\bfrom\s+['"](?:commander|@commander-js\/extra-typings)['"]|\brequire\s*\(\s*['"]commander['"]\s*\)/;
const PROGRAM_NAME = /\.\s*name\s*\(\s*(['"`])([^'"`$]+)\1/g;

const MCP_TOOL = /\.\s*(?:tool|registerTool)\s*\(\s*(['"`])([^'"`$]+)\1/g;
const MCP_SDK = /['"]@modelcontextprotocol\/sdk[/'"]/;

export interface HeadlessResult {
  nodes: ContextModelNode[];
  notes: string[];
}

/** File name without directory or extension, to tell same-named surfaces apart. */
const stem = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(SCRIPT, '');

function matches(pattern: RegExp, content: string): string[] {
  pattern.lastIndex = 0;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) found.push(match[2]!.trim());
  return found;
}

/**
 * The program's own name, when the commander files agree on exactly one.
 * It only makes the labels read like the invocation; a CLI split across
 * several programs keeps the bare subcommand rather than a guessed prefix.
 */
function programName(scripts: ScaffoldSource[]): string | undefined {
  const names = new Set(scripts.filter(s => COMMANDER.test(s.content)).flatMap(s => matches(PROGRAM_NAME, s.content)));
  return names.size === 1 ? [...names][0] : undefined;
}

export function extractHeadless(sources: ScaffoldSource[], ids: IdSet): HeadlessResult {
  const scripts = sources.filter(s => SCRIPT.test(s.path));
  const program = programName(scripts);
  const nodes: ContextModelNode[] = [];
  const seen = new Set<string>();
  let unclaimed = 0;

  const add = (source: ScaffoldSource, name: string, label: string, kind: 'cli' | 'tool') => {
    const key = `${source.path}|${kind}|${name}`;
    if (!kebab(name) || seen.has(key)) return;
    seen.add(key);
    // Suffixed even when the bare name is free: a `place-order` subcommand
    // must not take the id its domain command will want.
    const id = ids.claim(`${name}-${kind}`, `${stem(source.path)}-${name}-${kind}`);
    nodes.push(screen(id, label, source.path, kind));
  };

  for (const source of scripts) {
    const commander = COMMANDER.test(source.content);
    for (const declared of matches(SUBCOMMAND, source.content)) {
      if (!commander) {
        unclaimed++;
        continue;
      }
      // `add <type> [id]` — the first word is the subcommand, the rest its usage.
      const name = declared.split(/\s+/)[0]!;
      add(source, name, program ? `${program} ${declared}` : declared, 'cli');
    }

    const mcp = MCP_SDK.test(source.content);
    for (const name of matches(MCP_TOOL, source.content)) {
      if (!mcp) {
        unclaimed++;
        continue;
      }
      add(source, name, name, 'tool');
    }
  }

  const subcommands = nodes.filter(n => n.data?.kind === 'cli').length;
  const tools = nodes.length - subcommands;
  const notes: string[] = [];
  if (subcommands > 0) notes.push(`${subcommands} CLI subcommand(s) via commander`);
  if (tools > 0) notes.push(`${tools} agent tool(s) via the MCP SDK`);
  if (subcommands + tools > 0) {
    notes.push(
      'a subcommand or tool is a surface, not a command — it may only query, so which command it offers and what it reads are left to the modelling'
    );
  }
  if (unclaimed > 0) {
    notes.push(`${unclaimed} .command() or .tool() call(s) left alone, their file not importing commander or the MCP SDK respectively`);
  }

  return { nodes, notes };
}
