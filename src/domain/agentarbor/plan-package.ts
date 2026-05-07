import type {
  DirectionHandoffPackage,
  DirectionHandoffPackageCandidateReference,
  DirectionHandoffPackageFile,
  DirectionHandoffPackageFilePath,
  DirectionHandoffPackageFileRole,
  DirectionHandoffPackageLineage,
  DirectionHandoffPackageManifest,
  DirectionHandoffPackageRef,
  DirectionHandoffPackageRevisionReason,
  DirectionHandoffPackageStore,
  DirectionHandoffPackageValidationIssue,
  DirectionHandoffPackageValidationResult,
} from "./direction-handoff-package.js";

export type PlanPackage = DirectionHandoffPackage;
export type PlanPackageCandidateReference = DirectionHandoffPackageCandidateReference;
export type PlanPackageFile = DirectionHandoffPackageFile;
export type PlanPackageFilePath = DirectionHandoffPackageFilePath;
export type PlanPackageFileRole = DirectionHandoffPackageFileRole;
export type PlanPackageLineage = DirectionHandoffPackageLineage;
export type PlanPackageManifest = DirectionHandoffPackageManifest;
export type PlanPackageRef = DirectionHandoffPackageRef;
export type PlanPackageRevisionReason = DirectionHandoffPackageRevisionReason;
export type PlanPackageStore = DirectionHandoffPackageStore;
export type PlanPackageValidationIssue = DirectionHandoffPackageValidationIssue;
export type PlanPackageValidationResult = DirectionHandoffPackageValidationResult;

export {
  DIRECTION_HANDOFF_PACKAGE_FILES as PLAN_PACKAGE_FILES,
  DIRECTION_HANDOFF_PACKAGE_SCHEMA_VERSION as PLAN_PACKAGE_SCHEMA_VERSION,
} from "./direction-handoff-package.js";
export {
  DirectionHandoffPackageStoreError as PlanPackageStoreError,
  DirectionHandoffPackageValidationError as PlanPackageValidationError,
} from "./direction-handoff-package.js";
export {
  FileSystemDirectionHandoffPackageStore as FileSystemPlanPackageStore,
  InMemoryDirectionHandoffPackageStore as InMemoryPlanPackageStore,
  resolveDirectionHandoffPackageDirectory as resolvePlanPackageDirectory,
  resolveDirectionHandoffPackageMetaPath as resolvePlanPackageMetaPath,
} from "./direction-handoff-package.js";
export {
  assertDirectionHandoffPackageValidForPlanning as assertPlanPackageValidForPlanning,
  validateDirectionHandoffPackage as validatePlanPackage,
} from "./direction-handoff-package.js";
