import type { ContextModelNode } from '../schema.js';
import { screen } from './surfaces.js';
import { blank, IdSet, kebab, type ScaffoldSource } from './sources.js';

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
 * `remote` subcommand comes out as `add`, and a second `add` in the same file
 * as `add-cli-2`.
 *
 * Comments are not read, and neither is a registration that is only text
 * inside a string. The import may be a type-only one: a registration function
 * typed against `Command` imports nothing else, and its `.command()` is real.
 */

const SCRIPT = /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/;

// Matched against source whose string contents are blanked, so each ends on
// the opening quote of a literal first argument.
const SUBCOMMAND = /\.\s*command\s*\(\s*['"`]/g;
const PROGRAM_NAME = /\.\s*name\s*\(\s*['"`]/g;
const MCP_TOOL = /\.\s*(?:tool|registerTool)\s*\(\s*['"`]/g;

// Matched against source with only its comments blanked.
const imports = (pkg: string) =>
  new RegExp(`\\bfrom\\s+['"]${pkg}(?:/[^'"]*)?['"]|\\b(?:require|import)\\s*\\(\\s*['"]${pkg}(?:/[^'"]*)?['"]\\s*\\)`);
const COMMANDER = imports('(?:commander|@commander-js/extra-typings)');
const MCP_SDK = imports('@modelcontextprotocol/sdk');

export interface HeadlessResult {
  nodes: ContextModelNode[];
  notes: string[];
}

/** File name without directory or extension, to tell same-named surfaces apart. */
const stem = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(SCRIPT, '');

/** One script, read once in the three forms the patterns need. */
interface Script {
  path: string;
  content: string;
  /** Comments blanked: what the file imports. */
  code: string;
  /** Comments and string contents blanked: where it calls what. */
  calls: string;
}

/** The literal first arguments of every call `pattern` finds, in source order. */
function literalArguments(pattern: RegExp, script: Script): string[] {
  pattern.lastIndex = 0;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(script.calls)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = script.calls.indexOf(script.calls[open]!, open + 1);
    if (close === -1) continue;
    const value = script.content.slice(open + 1, close).trim();
    // A computed name (`${prefix}-run`) is skipped rather than guessed.
    if (value && !value.includes('$')) found.push(value);
  }
  return found;
}

/**
 * The program's own name, when the commander files agree on exactly one.
 * It only makes the labels read like the invocation; a CLI split across
 * several programs keeps the bare subcommand rather than a guessed prefix.
 */
function programName(scripts: Script[]): string | undefined {
  const names = new Set(scripts.filter(s => COMMANDER.test(s.code)).flatMap(s => literalArguments(PROGRAM_NAME, s)));
  return names.size === 1 ? [...names][0] : undefined;
}

interface Registration {
  path: string;
  kind: 'cli' | 'tool';
  name: string;
  label: string;
}

export function extractHeadless(sources: ScaffoldSource[], ids: IdSet): HeadlessResult {
  const scripts: Script[] = sources
    .filter(s => SCRIPT.test(s.path))
    .map(s => ({ ...s, code: blank(s.content, 'comments'), calls: blank(s.content, 'comments-and-strings') }));
  const program = programName(scripts);
  const registrations: Registration[] = [];
  let unclaimed = 0;

  for (const script of scripts) {
    const declared = literalArguments(SUBCOMMAND, script);
    if (!COMMANDER.test(script.code)) unclaimed += declared.length;
    else {
      for (const usage of declared) {
        // `add <type> [id]` — the first word is the subcommand, the rest its usage.
        const name = usage.split(/\s+/)[0]!;
        registrations.push({ path: script.path, kind: 'cli', name, label: program ? `${program} ${usage}` : usage });
      }
    }

    const tools = literalArguments(MCP_TOOL, script);
    if (!MCP_SDK.test(script.code)) unclaimed += tools.length;
    else for (const name of tools) registrations.push({ path: script.path, kind: 'tool', name, label: name });
  }

  // Which files register each name, known before the first id is handed out.
  // Deciding file by file gave the bare id to whichever sorted first, and a
  // file added later could take it over from under the edges drawn to it.
  const filesByName = new Map<string, Set<string>>();
  const nameKey = (r: Registration) => `${r.kind}|${kebab(r.name)}`;
  for (const r of registrations) {
    if (!filesByName.has(nameKey(r))) filesByName.set(nameKey(r), new Set());
    filesByName.get(nameKey(r))!.add(r.path);
  }

  const nodes: ContextModelNode[] = [];
  const seenInFile = new Set<string>();
  const repeated = new Set<string>();
  for (const r of registrations.filter(r => kebab(r.name))) {
    // Suffixed even when the bare name is free: a `place-order` subcommand
    // must not take the id its domain command will want.
    const bare = `${r.name}-${r.kind}`;
    const stemmed = `${stem(r.path)}-${bare}`;
    const fileKey = `${r.path}|${nameKey(r)}`;

    let id: string;
    if (seenInFile.has(fileKey)) {
      // The same name again in the same file — nested under another parent.
      // The file name cannot tell the two apart, so it is numbered.
      repeated.add(fileKey);
      id = ids.claim(filesByName.get(nameKey(r))!.size > 1 ? stemmed : bare);
    } else if (filesByName.get(nameKey(r))!.size > 1) {
      id = ids.claim(stemmed);
    } else {
      id = ids.claim(bare, stemmed);
    }
    seenInFile.add(fileKey);
    nodes.push(screen(id, r.label, r.path, r.kind));
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
  if (repeated.size > 0) {
    notes.push(
      `${repeated.size} name(s) registered more than once in one file — nesting is not resolved, so the later ones are numbered in source order`
    );
  }
  if (unclaimed > 0) {
    notes.push(`${unclaimed} .command() or .tool() call(s) left alone, their file not importing commander or the MCP SDK respectively`);
  }

  return { nodes, notes };
}
