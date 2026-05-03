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
