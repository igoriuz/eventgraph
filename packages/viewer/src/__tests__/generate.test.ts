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
