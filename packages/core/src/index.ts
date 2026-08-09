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
export {
  loadProject,
  loadContext,
  loadConfig,
  loadContextIntoGraph,
  readContextModel,
  findProjectDir,
} from './parser.js';
export {
  scaffold,
  collectSources,
  EXTRACTORS,
  type Extractor,
  type ScaffoldSource,
  type ScaffoldOptions,
  type ScaffoldReport,
} from './scaffold/index.js';
export {
  parseContextModel,
  stringifyContextModel,
  isCompactModel,
  nodeToCompact,
  editContextDocument,
  setNodeInDocument,
  addEdgeToDocument,
  removeNodeFromDocument,
} from './model-file.js';
export { QueryEngine } from './query.js';
export {
  slice,
  lifecycle,
  subgraph,
  sliceGraph,
  neighbourhood,
  resolveId,
  type Slice,
} from './projections.js';
export { analyzeImpact, type ImpactResult, type ImpactOptions } from './impact.js';
export { validateGraph, loadPreset, type ValidationError } from './validate.js';
export {
  verifyImplementations,
  pointersOf,
  pointerPath,
  type VerifyIssue,
  type VerifyReport,
} from './verify.js';
export {
  verifyRejectionHandling,
  type ContractIssue,
  type ContractReport,
} from './contract.js';
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
export {
  addNodeToContext,
  addEdgeToContext,
  removeNodeFromContext,
  rewriteContextCompact,
  generateYamlDiff,
  type DiffChanges,
} from './writer.js';
