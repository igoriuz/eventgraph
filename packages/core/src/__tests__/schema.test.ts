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
  qualifiedId,
  parseQualifiedId,
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

  it('qualifiedId joins context and node id', () => {
    expect(qualifiedId('payments', 'place-order')).toBe('payments.place-order');
  });

  it('qualifiedId returns as-is if already qualified', () => {
    expect(qualifiedId('payments', 'shipping.start-fulfillment')).toBe('shipping.start-fulfillment');
  });

  it('parseQualifiedId splits context and node id', () => {
    const result = parseQualifiedId('payments.place-order');
    expect(result.context).toBe('payments');
    expect(result.nodeId).toBe('place-order');
  });

  it('parseQualifiedId handles unqualified id', () => {
    const result = parseQualifiedId('place-order');
    expect(result.context).toBe('');
    expect(result.nodeId).toBe('place-order');
  });
});
