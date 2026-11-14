import { describe, it, expect } from 'vitest';
import { collectSources, scaffold } from '../scaffold/index.js';
import type { ScaffoldSource } from '../scaffold/sources.js';

function src(path: string, content: string): ScaffoldSource {
  return { path, content };
}

const PROGRAM = src(
  'src/cli/index.ts',
  `
  import { Command } from 'commander';
  const program = new Command();
  program.name('shop').description('The shop, without the shop window');
  registerOrders(program);
  program.parse();
`
);

const ORDERS = src(
  'src/cli/orders.ts',
  `
  import { Command } from 'commander';
  export function registerOrders(program: Command) {
    program
      .command('place <sku> [qty]')
      .description('Place an order')
      .action(() => {});
    program.command("list").action(() => {});
  }
`
);

// The SDK's two registration styles, written the way real servers spread them
// over lines.
const TOOLS = src(
  'src/mcp/server.ts',
  `
  import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
  const server = new McpServer({ name: 'shop', version: '1' });
  server.tool(
    'place_order',
    'Place an order',
    { sku: z.string() },
    async () => ({ content: [] }),
  );
  server.registerTool('list-orders', { description: 'List orders' }, async () => ({ content: [] }));
`
);

const ids = (sources: ScaffoldSource[]) => scaffold(sources, { only: ['headless'] }).model.nodes.map(n => n.id);

describe('CLI subcommands', () => {
  it('finds commander subcommands as cli surfaces pointing at their file', () => {
    const { model } = scaffold([PROGRAM, ORDERS], { only: ['headless'] });
    const place = model.nodes.find(n => n.id === 'place-cli')!;
    expect(place).toMatchObject({ type: 'screen', label: 'shop place <sku> [qty]' });
    expect(place.data).toMatchObject({ kind: 'cli', implemented_by: ['src/cli/orders.ts'], status: 'implemented' });
    expect(model.nodes.map(n => n.id)).toEqual(['place-cli', 'list-cli']);
  });

  it('labels with the bare subcommand when no single program name is known', () => {
    const { model } = scaffold([ORDERS], { only: ['headless'] });
    expect(model.nodes.map(n => n.label)).toEqual(['place <sku> [qty]', 'list']);
  });

  // A chat bot, a job queue and a test harness all have a .command() method.
  it('leaves .command() alone in a file that does not import commander', () => {
    const bot = src('src/bot.ts', `import { Telegraf } from 'telegraf';\nbot.command('start', ctx => ctx.reply('hi'));`);
    const { model, notes } = scaffold([bot], { only: ['headless'] });
    expect(model.nodes).toEqual([]);
    expect(notes.join(' ')).toMatch(/1 \.command\(\) or \.tool\(\) call\(s\) left alone/);
  });

  it('reads require as well as import', () => {
    expect(ids([src('bin/cli.js', `const { program } = require('commander');\nprogram.command('serve');`)])).toEqual([
      'serve-cli',
    ]);
  });

  it('skips a name computed at runtime rather than guessing it', () => {
    const computed = src('src/cli.ts', "import { Command } from 'commander';\nprogram.command(`${prefix}-run`);\nprogram.command(name);");
    expect(ids([computed])).toEqual([]);
  });
});

describe('what is not a registration', () => {
  const cli = (body: string) => src('src/cli.ts', `import { Command } from 'commander';\n${body}`);

  it('ignores a commented-out subcommand', () => {
    expect(ids([cli("// program.command('old');\n/* program.command('older'); */\nprogram.command('live');")])).toEqual([
      'live-cli',
    ]);
  });

  it('ignores a registration that is only text inside a string', () => {
    expect(ids([cli(`const help = "register with program.command('example')";\nprogram.command('live');`)])).toEqual([
      'live-cli',
    ]);
  });

  it('does not take a commented-out import as importing commander', () => {
    expect(ids([src('src/bot.ts', `// import { Command } from 'commander';\nbot.command('start');`)])).toEqual([]);
  });

  it('does not take a mention of the MCP SDK in a comment or a string as importing it', () => {
    const mention = src(
      'src/agent.ts',
      `// ported from '@modelcontextprotocol/sdk'\nconst docs = "see '@modelcontextprotocol/sdk'";\nagent.tool('search', run);`
    );
    expect(ids([mention])).toEqual([]);
  });

  it('reads a subpath require and a dynamic import of commander', () => {
    expect(ids([src('bin/a.cjs', `const { program } = require('commander/esm');\nprogram.command('one');`)])).toEqual(['one-cli']);
    expect(ids([src('bin/b.mjs', `const { program } = await import('commander');\nprogram.command('two');`)])).toEqual(['two-cli']);
  });

  // A registration function typed against commander imports only the type.
  it('counts a type-only import, since the call on a typed parameter is real', () => {
    const typed = src('src/cli/users.ts', `import type { Command } from 'commander';\nexport const register = (p: Command) => p.command('invite');`);
    expect(ids([typed])).toEqual(['invite-cli']);
  });

  it('reads .mts and .cts files', () => {
    expect(ids([src('src/cli.mts', `import { Command } from 'commander';\nprogram.command('one');`)])).toEqual(['one-cli']);
    expect(ids([src('src/cli.cts', `const { program } = require('commander');\nprogram.command('two');`)])).toEqual(['two-cli']);
  });
});

describe('agent tools', () => {
  it('finds both MCP SDK registration styles as tool surfaces', () => {
    const { model } = scaffold([TOOLS], { only: ['headless'] });
    expect(model.nodes.map(n => [n.id, n.label, n.data?.kind])).toEqual([
      ['place-order-tool', 'place_order', 'tool'],
      ['list-orders-tool', 'list-orders', 'tool'],
    ]);
    expect(model.nodes[0]!.data).toMatchObject({ implemented_by: ['src/mcp/server.ts'] });
  });

  it('leaves .tool() alone in a file that does not import the MCP SDK', () => {
    expect(ids([src('src/agent.ts', `import { Agent } from 'some-agent-kit';\nagent.tool('search', run);`)])).toEqual([]);
  });
});

describe('ids', () => {
  // A subcommand named after an action is exactly the id its domain command
  // will want, and a screen may already hold the bare name.
  it('never takes the bare name, so a screen or a later command keeps it', () => {
    const screen = src('app/place.tsx', 'export default function Place() {}');
    const { model } = scaffold([screen, ORDERS], { only: ['screens', 'headless'] });
    expect(model.nodes.map(n => n.id)).toEqual(['place', 'place-cli', 'list-cli']);
  });

  it('tells apart the same subcommand registered in two files by the file name', () => {
    const remote = src(
      'src/cli/remote.ts',
      `import { Command } from 'commander';\nremote.command('list');`
    );
    expect(ids([ORDERS, remote])).toEqual(['place-cli', 'orders-list-cli', 'remote-list-cli']);
  });

  // Whichever file sorts first used to get the bare id. A file added later
  // that sorts earlier then took it over, and edges drawn to the old node
  // pointed at a different subcommand after the next scaffold.
  it('keeps those ids when a third file with the same subcommand sorts first', () => {
    const remote = src('src/cli/remote.ts', `import { Command } from 'commander';\nremote.command('list');`);
    const archive = src('src/cli/archive.ts', `import { Command } from 'commander';\narchive.command('list');`);
    const before = ids([ORDERS, remote]);
    const after = ids([archive, ORDERS, remote]);
    expect(after).toEqual(['archive-list-cli', ...before]);
  });

  // Nesting is not resolved, so `remote add` and `tag add` are both `add`.
  // Dropping the second lost a surface without a word.
  it('keeps same-named subcommands of one file and says it numbered them', () => {
    const nested = src(
      'src/cli.ts',
      `import { Command } from 'commander';\nremote.command('add <url>');\ntag.command('add <name>');`
    );
    const { model, notes } = scaffold([nested], { only: ['headless'] });
    expect(model.nodes.map(n => [n.id, n.label])).toEqual([
      ['add-cli', 'add <url>'],
      ['add-cli-2', 'add <name>'],
    ]);
    expect(notes.join(' ')).toMatch(/1 name\(s\) registered more than once in one file/);
  });

  it('turns a colon in a subcommand name into a dash', () => {
    expect(ids([src('src/cli.ts', `import { Command } from 'commander';\nprogram.command('db:migrate');`)])).toEqual([
      'db-migrate-cli',
    ]);
  });

  it('produces the same ids on a second run', () => {
    const sources = [PROGRAM, ORDERS, TOOLS];
    expect(scaffold(sources).model).toEqual(scaffold(sources).model);
  });
});

describe('the headless extractor', () => {
  it('never turns a subcommand or tool into a command', () => {
    const { model, notes } = scaffold([PROGRAM, ORDERS, TOOLS]);
    expect([...new Set(model.nodes.map(n => n.type))]).toEqual(['screen']);
    expect(notes.join(' ')).toMatch(/surface, not a command/);
  });

  it('counts what it contributed, and runs only when asked', () => {
    expect(scaffold([PROGRAM, ORDERS, TOOLS]).counts.headless).toBe(4);
    expect(scaffold([PROGRAM, ORDERS, TOOLS], { only: ['endpoints'] }).counts.headless).toBe(0);
  });
});

describe('dogfood: this repository', () => {
  const packages = new URL('../../..', import.meta.url).pathname;

  it("finds the CLI's own subcommands", () => {
    const { model } = scaffold(collectSources(`${packages}cli/src`), { only: ['headless'] });
    expect(model.nodes.every(n => n.data?.kind === 'cli')).toBe(true);
    expect(model.nodes.map(n => n.id)).toEqual(
      expect.arrayContaining(['check-cli', 'rules-cli', 'scaffold-cli', 'slice-cli', 'lifecycle-cli', 'apply-cli'])
    );
    expect(model.nodes.find(n => n.id === 'slice-cli')!.label).toBe('eventgraph slice <event>');
  });

  it("finds the MCP server's own tools", () => {
    const { model } = scaffold(collectSources(`${packages}mcp/src`), { only: ['headless'] });
    expect(model.nodes.every(n => n.data?.kind === 'tool')).toBe(true);
    expect(model.nodes.map(n => n.label)).toEqual(
      expect.arrayContaining(['eventgraph_query', 'eventgraph_check', 'eventgraph_slice', 'eventgraph_add_node'])
    );
  });
});
