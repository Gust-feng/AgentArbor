import { assertDirectionHandoffConverged } from "../direction-handoff.js";
import {
  DirectionHandoffPackage,
  DirectionHandoffPackageValidationIssue,
  DirectionHandoffPackageValidationResult,
} from "./contracts.js";
import { DirectionHandoffPackageValidationError } from "./errors.js";
import { validateCandidateReferenceIndex } from "./candidate-index-validation.js";
import { validateConvergenceReviewConsistency } from "./convergence-validation.js";
import {
  validateDirectionEvidenceBoundary,
  validateFileContract,
  validateSoilReferences,
} from "./file-boundary-validation.js";
import { validateHardConstraintTextBoundary } from "./hard-constraint-boundary.js";
import { validateLineage } from "./lineage-validation.js";
import { validateGoalRelevanceAndFileContent } from "./content-integrity-validation.js";
import { DIRECTION_HANDOFF_PACKAGE_SCHEMA_VERSION } from "./schema.js";
import { nowIso } from "./utils.js";

export function validateDirectionHandoffPackage(
  pkg: DirectionHandoffPackage
): DirectionHandoffPackageValidationResult {
  const errors: DirectionHandoffPackageValidationIssue[] = [];
  const warnings: DirectionHandoffPackageValidationIssue[] = [];
  const addError = (code: string, path: string, message: string): void => {
    errors.push({ code, path, message, severity: "error" });
  };

  if (pkg.manifest.schemaVersion !== DIRECTION_HANDOFF_PACKAGE_SCHEMA_VERSION) {
    addError(
      "INVALID_SCHEMA_VERSION",
      "manifest.schemaVersion",
      "DirectionHandoffPackage must use the V0.2 schema version."
    );
  }

  if (pkg.manifest.directionId !== pkg.directionHandoff.id) {
    addError("MANIFEST_DIRECTION_ID_MISMATCH", "manifest.directionId", "Manifest directionId must match handoff id.");
  }

  if (pkg.manifest.directionVersion !== pkg.directionHandoff.version) {
    addError(
      "MANIFEST_DIRECTION_VERSION_MISMATCH",
      "manifest.directionVersion",
      "Manifest directionVersion must match handoff version."
    );
  }

  if (pkg.manifest.status !== pkg.directionHandoff.status) {
    addError("MANIFEST_STATUS_MISMATCH", "manifest.status", "Manifest status must match handoff status.");
  }

  if (pkg.manifest.sourceGoalId !== pkg.directionHandoff.sourceGoalId) {
    addError(
      "MANIFEST_SOURCE_GOAL_MISMATCH",
      "manifest.sourceGoalId",
      "Manifest sourceGoalId must match handoff sourceGoalId."
    );
  }

  if (pkg.directionHandoff.status !== "approved") {
    addError(
      "DIRECTION_HANDOFF_NOT_APPROVED",
      "directionHandoff.status",
      "Aboveground planning requires an approved DirectionHandoffPackage."
    );
  }

  if (
    typeof pkg.directionHandoff.convergenceReviewRef !== "string" ||
    pkg.directionHandoff.convergenceReviewRef.trim() === ""
  ) {
    addError(
      "MISSING_CONVERGENCE_REVIEW_REF",
      "directionHandoff.convergenceReviewRef",
      "DirectionHandoffPackage must reference a convergence review."
    );
  }

  if (!Array.isArray(pkg.directionHandoff.sourceCandidateRefs) || pkg.directionHandoff.sourceCandidateRefs.length === 0) {
    addError(
      "MISSING_SOURCE_CANDIDATE_REFS",
      "directionHandoff.sourceCandidateRefs",
      "DirectionHandoffPackage must include source candidate references."
    );
  }

  if (pkg.directionHandoff.convergenceReviewRef !== pkg.convergenceReview.reviewId) {
    addError(
      "CONVERGENCE_REVIEW_REF_MISMATCH",
      "convergenceReview.reviewId",
      "Package convergence review must match DirectionHandoff.convergenceReviewRef."
    );
  }

  try {
    assertDirectionHandoffConverged(pkg.directionHandoff, pkg.convergenceReview);
  } catch (error) {
    addError(
      "UNCONVERGED_SOURCE_CANDIDATES",
      "directionHandoff.sourceCandidateRefs",
      error instanceof Error ? error.message : "DirectionHandoff contains unconverged candidates."
    );
  }

  validateConvergenceReviewConsistency(pkg, addError);
  validateLineage(pkg, addError);
  validateCandidateReferenceIndex(pkg, addError);
  validateFileContract(pkg, addError);
  validateSoilReferences(pkg, addError);
  validateDirectionEvidenceBoundary(pkg, addError);
  validateHardConstraintTextBoundary(pkg, addError);
  validateGoalRelevanceAndFileContent(pkg, addError);

  return {
    passed: errors.length === 0,
    checkedAt: nowIso(),
    errors,
    warnings,
  };
}

export function assertDirectionHandoffPackageValidForPlanning(pkg: DirectionHandoffPackage): void {
  const validation = validateDirectionHandoffPackage(pkg);
  if (!validation.passed) {
    throw new DirectionHandoffPackageValidationError(validation);
  }
}
