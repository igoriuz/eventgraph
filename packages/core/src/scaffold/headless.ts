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
 *     as are tools listed through a raw `ListTools` request handler and tools
 *     registered in a loop over a table, where the name is not a literal.
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

// All matched against source whose comments and string contents are blanked,
// so each ends on the opening quote of a literal argument.
const SUBCOMMAND = /\.\s*command\s*\(\s*['"`]/g;
const PROGRAM_NAME = /\.\s*name\s*\(\s*['"`]/g;
const MCP_TOOL = /\.\s*(?:tool|registerTool)\s*\(\s*['"`]/g;

// Where a module specifier starts: after `from`, or as the argument of
// `require(` or a dynamic `import(`.
const SPECIFIER = /\bfrom\s*['"`]|\b(?:require|import)\s*\(\s*['"`]/g;
const COMMANDER = ['commander', '@commander-js/extra-typings'];
const MCP_SDK = ['@modelcontextprotocol/sdk'];

export interface HeadlessResult {
  nodes: ContextModelNode[];
  notes: string[];
}

/** One script, with the form the patterns run over. */
interface Script {
  path: string;
  content: string;
  /** Comments and string contents blanked: code only, at unchanged offsets. */
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
 * Whether the script imports one of the packages, or a subpath of one. Read
 * from the code, so an import that is only quoted in a string does not count.
 */
function importsAny(script: Script, packages: string[]): boolean {
  return literalArguments(SPECIFIER, script).some(spec => packages.some(pkg => spec === pkg || spec.startsWith(`${pkg}/`)));
}

/**
 * The program's own name, when the commander files agree on exactly one.
 * It only makes the labels read like the invocation; a CLI split across
 * several programs keeps the bare subcommand rather than a guessed prefix.
 */
function programName(scripts: Script[]): string | undefined {
  const names = new Set(scripts.filter(s => importsAny(s, COMMANDER)).flatMap(s => literalArguments(PROGRAM_NAME, s)));
  return names.size === 1 ? [...names][0] : undefined;
}

interface Registration {
  path: string;
  kind: 'cli' | 'tool';
  name: string;
  label: string;
}

/** Every registration in the scripts, in file and source order, and how many calls were left alone. */
function registrationsIn(scripts: Script[], program: string | undefined) {
  const registrations: Registration[] = [];
  let unclaimed = 0;

  for (const script of scripts) {
    const declared = literalArguments(SUBCOMMAND, script);
    if (!importsAny(script, COMMANDER)) unclaimed += declared.length;
    else {
      for (const usage of declared) {
        // `add <type> [id]` — the first word is the subcommand, the rest its usage.
        const name = usage.split(/\s+/)[0]!;
        registrations.push({ path: script.path, kind: 'cli', name, label: program ? `${program} ${usage}` : usage });
      }
    }

    const tools = literalArguments(MCP_TOOL, script);
    if (!importsAny(script, MCP_SDK)) unclaimed += tools.length;
    else for (const name of tools) registrations.push({ path: script.path, kind: 'tool', name, label: name });
  }
  return { registrations, unclaimed };
}

/** `db:migrate` reads as two words, and an id cannot carry the colon. */
const idName = (r: Registration) => kebab(r.name.replace(/:/g, '-'));

/**
 * What tells one file apart from the others registering the same name: its
 * file name, with as many directories in front as it takes. `orders.ts` and
 * `remote.ts` need none; two `index.ts` need the directory each sits in.
 */
function distinctPrefix(path: string, others: Set<string>): string {
  const segments = (p: string) => p.replace(SCRIPT, '').split('/');
  const own = segments(path);
  for (let take = 1; take <= own.length; take++) {
    const prefix = own.slice(-take).join('-');
    const clash = [...others].some(other => other !== path && segments(other).slice(-take).join('-') === prefix);
    if (!clash) return prefix;
  }
  return own.join('-');
}

export function extractHeadless(sources: ScaffoldSource[], ids: IdSet): HeadlessResult {
  const scripts: Script[] = sources
    .filter(s => SCRIPT.test(s.path))
    .map(s => ({ ...s, calls: blank(s.content, 'comments-and-strings') }));
  const { registrations, unclaimed } = registrationsIn(scripts, programName(scripts));

  // Which files register each name, known before the first id is handed out.
  // Deciding file by file gave the bare id to whichever sorted first, and a
  // file added later could take it over from under the edges drawn to it.
  const filesByName = new Map<string, Set<string>>();
  const nameKey = (r: Registration) => `${r.kind}|${idName(r)}`;
  for (const r of registrations) {
    if (!filesByName.has(nameKey(r))) filesByName.set(nameKey(r), new Set());
    filesByName.get(nameKey(r))!.add(r.path);
  }

  const nodes: ContextModelNode[] = [];
  const seenInFile = new Set<string>();
  const repeated = new Set<string>();
  let unnameable = 0;
  for (const r of registrations) {
    if (!idName(r)) {
      unnameable++;
      continue;
    }
    // Suffixed even when the bare name is free: a `place-order` subcommand
    // must not take the id its domain command will want.
    const bare = `${idName(r)}-${r.kind}`;
    const files = filesByName.get(nameKey(r))!;
    const prefixed = `${distinctPrefix(r.path, files)}-${bare}`;
    const fileKey = `${r.path}|${nameKey(r)}`;

    let id: string;
    if (seenInFile.has(fileKey)) {
      // The same name again in the same file — nested under another parent.
      // The file name cannot tell the two apart, so it is numbered.
      repeated.add(fileKey);
      id = ids.claim(files.size > 1 ? prefixed : bare);
    } else if (files.size > 1) {
      id = ids.claim(prefixed);
    } else {
      id = ids.claim(bare, prefixed);
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
  if (unnameable > 0) {
    notes.push(`${unnameable} name(s) left out: an id is built from ASCII letters and digits, and they have none`);
  }
  if (unclaimed > 0) {
    notes.push(`${unclaimed} .command() or .tool() call(s) left alone, their file not importing commander or the MCP SDK respectively`);
  }

  return { nodes, notes };
}
