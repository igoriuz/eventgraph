import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  addEdgeToDocument,
  editContextDocument,
  isCompactModel,
  parseContextModel,
  removeNodeFromDocument,
  setNodeInDocument,
  stringifyContextModel,
} from '../model-file.js';

const COMPACT = `context: billing

nodes:
  # who pays
  traveller: { type: actor, label: Traveller }
  paywall:   { type: screen, label: Paywall, src: mobile/app/paywall.tsx }
  webhook-rejected:
    type: event
    label: Webhook Rejected
    failure: true
    transient: an unsigned webhook writes nothing

edges:
  # the spine
  issues:
    traveller: [purchase]
  produces:
    purchase: [webhook-rejected]
`;

const LEGACY = `context: billing
nodes:
  - id: paywall
    type: screen
    label: Paywall
    data:
      status: implemented
      implemented_by: [mobile/app/paywall.tsx]
edges:
  - { from: traveller, to: purchase, type: issues }
`;

describe('form detection', () => {
  it('recognises the compact form by its node mapping', () => {
    expect(isCompactModel(parseYaml(COMPACT))).toBe(true);
  });

  it('recognises the legacy list form', () => {
    expect(isCompactModel(parseYaml(LEGACY))).toBe(false);
  });
});

describe('parseContextModel', () => {
  it('turns the node mapping into records keyed by id', () => {
    const model = parseContextModel(parseYaml(COMPACT));
    expect(model.context).toBe('billing');
    expect(model.nodes.map(n => n.id)).toEqual(['traveller', 'paywall', 'webhook-rejected']);
    expect(model.nodes[0]).toMatchObject({ id: 'traveller', type: 'actor', label: 'Traveller' });
  });

  it('maps src onto implemented_by and derives implemented status', () => {
    const paywall = parseContextModel(parseYaml(COMPACT)).nodes.find(n => n.id === 'paywall')!;
    expect(paywall.data).toEqual({
      implemented_by: ['mobile/app/paywall.tsx'],
      status: 'implemented',
    });
  });

  it('keeps unknown keys as semantic flags, so presets need no change here', () => {
    const rejected = parseContextModel(parseYaml(COMPACT)).nodes.find(n => n.id === 'webhook-rejected')!;
    expect(rejected.data).toEqual({
      failure: true,
      transient: 'an unsigned webhook writes nothing',
    });
  });

  it('lets an explicit status win over the derived one', () => {
    const model = parseContextModel({
      context: 'c',
      nodes: { a: { type: 'command', src: 'x.ts', status: 'planned' } },
    });
    expect(model.nodes[0]!.data).toMatchObject({ status: 'planned' });
  });

  it('does not claim implemented for an empty platform map', () => {
    const model = parseContextModel({
      context: 'c',
      nodes: { a: { type: 'command', src: { ios: [], android: [] } } },
    });
    expect(model.nodes[0]!.data?.status).toBeUndefined();
  });

  it('titleises a missing label rather than leaving it blank', () => {
    const model = parseContextModel({ context: 'c', nodes: { 'place-order': { type: 'command' } } });
    expect(model.nodes[0]!.label).toBe('Place Order');
  });

  it('expands grouped edges into triples', () => {
    const model = parseContextModel(parseYaml(COMPACT));
    expect(model.edges).toEqual([
      { from: 'traveller', to: 'purchase', type: 'issues' },
      { from: 'purchase', to: 'webhook-rejected', type: 'produces' },
    ]);
  });

  it('still reads the legacy list form unchanged', () => {
    const model = parseContextModel(parseYaml(LEGACY));
    expect(model.nodes[0]!.data).toMatchObject({ implemented_by: ['mobile/app/paywall.tsx'] });
    expect(model.edges).toEqual([{ from: 'traveller', to: 'purchase', type: 'issues' }]);
  });

  it('names the node when its shape is wrong', () => {
    expect(() => parseContextModel({ context: 'c', nodes: { broken: { label: 'no type' } } })).toThrow(
      /broken.*no type/i
    );
  });

  it('rejects an edge group that is not a list of ids', () => {
    expect(() => parseContextModel({ context: 'c', edges: { produces: ['a'] } })).toThrow(/edges\.produces/);
  });
});

describe('stringifyContextModel', () => {
  it('round-trips a model through the compact form', () => {
    const original = parseContextModel(parseYaml(COMPACT));
    const reparsed = parseContextModel(parseYaml(stringifyContextModel(original)));
    expect(reparsed.nodes).toEqual(original.nodes);
    expect(reparsed.edges).toEqual(original.edges);
  });

  it('converts the legacy form without inventing or dropping anything', () => {
    const legacy = parseContextModel(parseYaml(LEGACY));
    const reparsed = parseContextModel(parseYaml(stringifyContextModel(legacy)));
    expect(reparsed).toEqual(legacy);
  });

  it('does not write back a status that src already implies', () => {
    const out = stringifyContextModel(parseContextModel(parseYaml(LEGACY)));
    expect(out).not.toContain('status');
    expect(out).toContain('src: mobile/app/paywall.tsx');
  });

  it('keeps a short node on one line and lets a long one breathe', () => {
    const out = stringifyContextModel(parseContextModel(parseYaml(COMPACT)));
    expect(out).toMatch(/traveller: \{ type: actor \}/);
    expect(out).toMatch(/webhook-rejected:\n/);
  });
});

describe('document edits', () => {
  it('adds a node without dropping the comments around it', () => {
    const after = editContextDocument(COMPACT, doc =>
      setNodeInDocument(doc, { id: 'refund', type: 'command', label: 'Refund' })
    );
    expect(after).toContain('# who pays');
    expect(after).toContain('# the spine');
    expect(after).toMatch(/refund: \{ type: command \}/);
  });

  it('appends to an existing edge group instead of starting a new one', () => {
    const after = editContextDocument(COMPACT, doc =>
      addEdgeToDocument(doc, { from: 'traveller', to: 'refund', type: 'issues' })
    );
    const model = parseContextModel(parseYaml(after));
    expect(model.edges.filter(e => e.type === 'issues')).toEqual([
      { from: 'traveller', to: 'purchase', type: 'issues' },
      { from: 'traveller', to: 'refund', type: 'issues' },
    ]);
    expect(after.match(/^\s+issues:$/gm)).toHaveLength(1);
  });

  it('creates the group when the edge type is new', () => {
    const after = editContextDocument(COMPACT, doc =>
      addEdgeToDocument(doc, { from: 'paywall', to: 'purchase', type: 'offers' })
    );
    expect(parseContextModel(parseYaml(after)).edges).toContainEqual({
      from: 'paywall',
      to: 'purchase',
      type: 'offers',
    });
  });

  it('does not duplicate an edge that is already there', () => {
    const after = editContextDocument(COMPACT, doc =>
      addEdgeToDocument(doc, { from: 'traveller', to: 'purchase', type: 'issues' })
    );
    expect(parseContextModel(parseYaml(after)).edges).toHaveLength(2);
  });

  it('removes a node together with every edge touching it', () => {
    const after = editContextDocument(COMPACT, doc => removeNodeFromDocument(doc, 'webhook-rejected'));
    const model = parseContextModel(parseYaml(after));
    expect(model.nodes.map(n => n.id)).not.toContain('webhook-rejected');
    expect(model.edges.map(e => e.type)).toEqual(['issues']);
  });

  it('matches a qualified target when removing', () => {
    const source = `context: c\nnodes:\n  a: { type: command }\nedges:\n  produces:\n    a: [other.b, c]\n`;
    const after = editContextDocument(source, doc => removeNodeFromDocument(doc, 'b'));
    expect(parseContextModel(parseYaml(after)).edges).toEqual([
      { from: 'a', to: 'c', type: 'produces' },
    ]);
  });

  it('reports a malformed file rather than writing over it', () => {
    expect(() => editContextDocument('nodes: [oops\n', () => {})).toThrow();
  });
});
