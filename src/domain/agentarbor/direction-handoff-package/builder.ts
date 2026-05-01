import type { ConvergenceReview, DirectionHandoff } from "../../underground/contracts.js";
import type {
  DirectionHandoffPackage,
  DirectionHandoffPackageCandidateReference,
  DirectionHandoffPackageLineage,
  DirectionHandoffPackageManifest,
  DirectionHandoffPackageRef,
  DirectionHandoffPackageRevisionReason,
} from "./contracts.js";
import { DIRECTION_HANDOFF_PACKAGE_FILES, DIRECTION_HANDOFF_PACKAGE_SCHEMA_VERSION } from "./schema.js";
import { cloneFiles, nowIso } from "./utils.js";
import { withValidation } from "./validated-package.js";

export function createDirectionHandoffPackage(input: {
  directionHandoff: DirectionHandoff;
  convergenceReview: ConvergenceReview;
  createdAt?: string;
  updatedAt?: string;
  lineage?: {
    previous?: DirectionHandoffPackageRef;
    revisionReason: DirectionHandoffPackageRevisionReason;
    sourceRefs: readonly string[];
    createdAt?: string;
  };
}): DirectionHandoffPackage {
  const files = cloneFiles(DIRECTION_HANDOFF_PACKAGE_FILES);
  const createdAt = input.createdAt ?? input.directionHandoff.createdAt;
  const updatedAt = input.updatedAt ?? input.directionHandoff.updatedAt;
  const candidateReferenceIndex = createCandidateReferenceIndex(
    input.directionHandoff,
    input.convergenceReview
  );
  const manifest: DirectionHandoffPackageManifest = {
    packageId: `${input.directionHandoff.id}@v${input.directionHandoff.version}`,
    schemaVersion: DIRECTION_HANDOFF_PACKAGE_SCHEMA_VERSION,
    directionId: input.directionHandoff.id,
    directionVersion: input.directionHandoff.version,
    status: input.directionHandoff.status,
    sourceGoalId: input.directionHandoff.sourceGoalId,
    createdAt,
    updatedAt,
    files,
  };
  const basePackage: DirectionHandoffPackage = {
    manifest,
    lineage: createLineage({
      manifest,
      convergenceReview: input.convergenceReview,
      lineage: input.lineage,
      createdAt,
    }),
    directionHandoff: input.directionHandoff,
    convergenceReview: input.convergenceReview,
    candidateReferenceIndex,
    files,
    validation: {
      passed: false,
      checkedAt: nowIso(),
      errors: [],
      warnings: [],
    },
  };

  return withValidation(basePackage);
}

export function createDirectionHandoffPackageRef(
  pkgOrManifest: DirectionHandoffPackage | DirectionHandoffPackageManifest
): DirectionHandoffPackageRef {
  const manifest = "manifest" in pkgOrManifest ? pkgOrManifest.manifest : pkgOrManifest;
  return {
    packageId: manifest.packageId,
    directionId: manifest.directionId,
    version: manifest.directionVersion,
    status: manifest.status,
    schemaVersion: manifest.schemaVersion,
  };
}

function createLineage(input: {
  manifest: DirectionHandoffPackageManifest;
  convergenceReview: ConvergenceReview;
  lineage?: {
    previous?: DirectionHandoffPackageRef;
    revisionReason: DirectionHandoffPackageRevisionReason;
    sourceRefs: readonly string[];
    createdAt?: string;
  };
  createdAt: string;
}): DirectionHandoffPackageLineage {
  return {
    current: createDirectionHandoffPackageRef(input.manifest),
    previous: input.lineage?.previous,
    revisionReason: input.lineage?.revisionReason ?? "initial",
    sourceRefs:
      input.lineage?.sourceRefs !== undefined
        ? [...input.lineage.sourceRefs]
        : [input.convergenceReview.reviewId],
    createdAt: input.lineage?.createdAt ?? input.createdAt,
  };
}

function createCandidateReferenceIndex(
  handoff: DirectionHandoff,
  convergenceReview: ConvergenceReview
): DirectionHandoffPackageCandidateReference[] {
  return handoff.sourceCandidateRefs.map((candidate) => ({
    candidateId: candidate.id,
    kind: candidate.kind,
    producedByAgentId: candidate.producedByAgentId,
    clusterId: candidate.clusterId,
    sourceRefs: [...candidate.sourceRefs],
    status: candidate.status,
    convergenceReviewRef: convergenceReview.reviewId,
  }));
}
