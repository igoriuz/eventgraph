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
    const preset = loadPreset('event-modeling', new URL('../../../../presets', import.meta.url).pathname);
    expect(preset.name).toBe('event-modeling');
    expect(preset.nodeTypes).toContain('command');
    expect(preset.edgeRules.length).toBeGreaterThan(0);
  });

  it('loads generic preset from YAML', () => {
    const preset = loadPreset('generic', new URL('../../../../presets', import.meta.url).pathname);
    expect(preset.name).toBe('generic');
    expect(preset.nodeTypes).toHaveLength(0);
  });
});
