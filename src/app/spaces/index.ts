export {
  SPACE_TREE_SCHEMA_VERSION,
  SpaceFeatureError,
  type Space,
  type SpaceEvent,
  type SpaceFeature,
  type SpaceFeatureErrorCode,
  type SpaceFolder,
  type SpaceMovableTarget,
  type SpaceReference,
  type SpaceReferenceItem,
  type SpaceRepository,
  type SpaceSummary,
  type SpaceTarget,
  type SpaceTree,
  type SpaceTreeEntry,
  type SpaceTreeSnapshot,
} from "./contracts.js";
export { createFileSystemSpaceRepository, validateSpaceTreeSnapshot } from "./file-system-repository.js";
export { createSpaceFeature, type CreateSpaceFeatureInput } from "./space-feature.js";
export { validateSpaceReference } from "./space-validation.js";
export {
  createSpaceAddReferenceTool,
  createSpaceCreateFolderTool,
  createSpaceCreateTool,
  createSpaceListTool,
  createSpaceMoveTool,
  createSpaceRemoveReferenceTool,
  createSpaceRenameTool,
  createSpaceToolRegistryContribution,
  createSpaceTools,
  type SpaceToolOptions,
} from "./space-tools.js";
