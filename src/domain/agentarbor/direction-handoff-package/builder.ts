import type { ConvergenceReview, DirectionHandoff } from "../../underground/contracts.js";
import type {
  DirectionHandoffPackage,
  DirectionHandoffPackageCandidateReference,
} from "./contracts.js";
import { DIRECTION_HANDOFF_PACKAGE_FILES, DIRECTION_HANDOFF_PACKAGE_SCHEMA_VERSION } from "./schema.js";
import { cloneFiles, nowIso } from "./utils.js";
import { withValidation } from "./validated-package.js";

export function createDirectionHandoffPackage(input: {
  directionHandoff: DirectionHandoff;
  convergenceReview: ConvergenceReview;
  createdAt?: string;
  updatedAt?: string;
}): DirectionHandoffPackage {
  const files = cloneFiles(DIRECTION_HANDOFF_PACKAGE_FILES);
  const createdAt = input.createdAt ?? input.directionHandoff.createdAt;
  const updatedAt = input.updatedAt ?? input.directionHandoff.updatedAt;
  const candidateReferenceIndex = createCandidateReferenceIndex(
    input.directionHandoff,
    input.convergenceReview
  );
  const basePackage: DirectionHandoffPackage = {
    manifest: {
      packageId: `${input.directionHandoff.id}@v${input.directionHandoff.version}`,
      schemaVersion: DIRECTION_HANDOFF_PACKAGE_SCHEMA_VERSION,
      directionId: input.directionHandoff.id,
      directionVersion: input.directionHandoff.version,
      status: input.directionHandoff.status,
      sourceGoalId: input.directionHandoff.sourceGoalId,
      createdAt,
      updatedAt,
      files,
    },
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
