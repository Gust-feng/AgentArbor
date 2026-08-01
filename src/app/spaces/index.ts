export {
  SPACE_TREE_SCHEMA_VERSION,
  SpaceFeatureError,
  type Space,
  type SpaceEvent,
  type SpaceFeature,
  type SpaceFeatureErrorCode,
  type SpaceMovableTarget,
  type SpaceReference,
  type SpaceReferenceItem,
  type SpaceRepository,
  type SpaceSummary,
  type SpaceConversationOwner,
  type SpaceTarget,
  type SpaceTree,
  type SpaceTreeEntry,
  type SpaceTreeSnapshot,
} from "./contracts.js";
export { createFileSystemSpaceRepository, validateSpaceTreeSnapshot } from "./file-system-repository.js";
export { createSqliteSpaceRepository } from "./sqlite-repository.js";
export { createSpaceFeature, type CreateSpaceFeatureInput } from "./space-feature.js";
export { validateSpaceReference } from "./space-validation.js";
export {
  createSpaceAddReferenceTool,
  createSpaceCreateTool,
  createSpaceListTool,
  createSpaceMoveTool,
  createSpaceRemoveReferenceTool,
  createSpaceRenameTool,
  createSpaceWriteTool,
  createSpaceEditTool,
  createSpaceToolRegistryContribution,
  createSpaceTools,
  type SpaceToolOptions,
} from "./space-tools.js";
export {
  isSpaceReferenceWritePermission,
  spaceReferenceAttachmentId,
  spaceReferenceIdFromAttachmentId,
  spaceReferenceWritePermission,
} from "./space-file-access.js";
