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
export {
  createFileSystemSpaceReferenceDeletionJournal,
  inspectFileSystemSpaceReferenceDeletionJournal,
  type SpaceReferenceDeletionJournalRecord,
  type SpaceReferenceDeletionJournalStore,
  type SpaceReferenceDeletionPhase,
  type SpaceReferenceDeletionTarget,
} from "./file-system-reference-deletion-journal.js";
export {
  createSpaceReferenceDeletionLifecycle,
  type SpaceReferenceDeletionDiagnostic,
  type SpaceReferenceDeletionFilePort,
  type SpaceReferenceDeletionLeasePort,
  type SpaceReferenceDeletionLifecycle,
  type SpaceReferenceDeletionTargetState,
} from "./space-reference-deletion.js";
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
  createSpaceRevocationOverlay,
  createSpaceToolRegistryContribution,
  createSpaceTools,
  type SpaceRevocationOverlay,
  type SpaceToolOptions,
} from "./space-tools.js";
export {
  isSpaceReferenceWritePermission,
  spaceReferenceAttachmentId,
  spaceReferenceIdFromAttachmentId,
  spaceReferenceWritePermission,
} from "./space-file-access.js";
