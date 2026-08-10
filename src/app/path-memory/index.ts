/**
 * Historical PathMemory implementation retained as a buildable orphan for
 * schema/repository regression coverage. The production Panel composition
 * root, routes, settings and new path-dependencies feature must not import or
 * construct it; existing runtime records are intentionally neither migrated
 * nor used as new path-dependency input.
 */
export {
  PATH_MEMORY_DELETION_SCHEMA_VERSION,
  PATH_MEMORY_SCHEMA_VERSION,
  PathMemoryFeatureError,
  pathMemoryIdForSource,
  type PathMemory,
  type PathMemoryCaptureInput,
  type PathMemoryCaptureResult,
  type PathMemoryDeletionDocument,
  type PathMemoryDeletionRecord,
  type PathMemoryDocument,
  type PathMemoryEvent,
  type PathMemoryFeature,
  type PathMemoryFeatureErrorCode,
  type PathMemoryListFilter,
  type PathMemoryOutcome,
  type PathMemoryRepository,
  type PathMemorySearchInput,
  type PathMemorySearchMatch,
  type PathMemorySearchMatchedField,
  type PathMemorySource,
  type PathMemoryToolStep,
  type PathMemoryVerification,
} from "./contracts.js";
export { createFileSystemPathMemoryRepository } from "./file-system-repository.js";
export { createPathMemoryFeature } from "./path-memory-feature.js";
export {
  PATH_MEMORY_SEARCH_DEFAULT_LIMIT,
  PATH_MEMORY_SEARCH_MAX_LIMIT,
  searchPathMemories,
} from "./search.js";
