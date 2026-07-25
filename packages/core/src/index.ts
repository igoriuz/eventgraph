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
export {
  checkGraph,
  resolveRules,
  unknownRuleIds,
  ruleCatalog,
  allRules,
  getRule,
  type CheckOptions,
  type Finding,
  type Lane,
  type Rule,
  type Severity,
} from './rules/index.js';
export { addNodeToContext, addEdgeToContext, removeNodeFromContext, generateYamlDiff, type DiffChanges } from './writer.js';
