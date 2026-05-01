import { assertDirectionHandoffConverged } from "../direction-handoff.js";
import {
  DirectionHandoffPackage,
  DirectionHandoffPackageFilePath,
  DirectionHandoffPackageValidationIssue,
  DirectionHandoffPackageValidationResult,
} from "./contracts.js";
import { DirectionHandoffPackageValidationError } from "./errors.js";
import { DIRECTION_HANDOFF_PACKAGE_FILES, DIRECTION_HANDOFF_PACKAGE_SCHEMA_VERSION } from "./schema.js";
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

  validateCandidateReferenceIndex(pkg, addError);
  validateFileContract(pkg, addError);
  validateSoilReferences(pkg, addError);
  validateDirectionEvidenceBoundary(pkg, addError);

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

function validateCandidateReferenceIndex(
  pkg: DirectionHandoffPackage,
  addIssue: (code: string, path: string, message: string) => void
): void {
  const sourceCandidateIds = new Set(pkg.directionHandoff.sourceCandidateRefs.map((candidate) => candidate.id));
  const indexedCandidateIds = new Set(pkg.candidateReferenceIndex.map((candidate) => candidate.candidateId));

  for (const candidateId of sourceCandidateIds) {
    if (!indexedCandidateIds.has(candidateId)) {
      addIssue(
        "CANDIDATE_INDEX_MISSING_SOURCE_REF",
        "candidateReferenceIndex",
        `Candidate reference index is missing source candidate ${candidateId}.`
      );
    }
  }

  for (const candidateId of indexedCandidateIds) {
    if (!sourceCandidateIds.has(candidateId)) {
      addIssue(
        "CANDIDATE_INDEX_HAS_NON_SOURCE_REF",
        "candidateReferenceIndex",
        `Candidate reference index contains non-source candidate ${candidateId}.`
      );
    }
  }
}

function validateFileContract(
  pkg: DirectionHandoffPackage,
  addIssue: (code: string, path: string, message: string) => void
): void {
  const manifestFilePaths = new Set(pkg.manifest.files.map((file) => file.path));
  const packageFilePaths = new Set(pkg.files.map((file) => file.path));

  for (const expectedFile of DIRECTION_HANDOFF_PACKAGE_FILES) {
    if (!manifestFilePaths.has(expectedFile.path)) {
      addIssue("MISSING_MANIFEST_FILE", "manifest.files", `Manifest is missing ${expectedFile.path}.`);
    }
    if (!packageFilePaths.has(expectedFile.path)) {
      addIssue("MISSING_PACKAGE_FILE", "files", `Package file list is missing ${expectedFile.path}.`);
    }
  }

  const evidenceOnlyFiles: DirectionHandoffPackageFilePath[] = [
    "options.json",
    "decision-record.md",
    "risk-register.md",
  ];
  for (const filePath of evidenceOnlyFiles) {
    const file = pkg.files.find((entry) => entry.path === filePath);
    if (file !== undefined && file.role !== "direction_evidence") {
      addIssue(
        "DIRECTION_EVIDENCE_FILE_ROLE_INVALID",
        `files.${filePath}`,
        `${filePath} must remain direction evidence and must not become GrowthPlan material.`
      );
    }
  }
}

function validateSoilReferences(
  pkg: DirectionHandoffPackage,
  addIssue: (code: string, path: string, message: string) => void
): void {
  const soilRefs = pkg.directionHandoff.soilRefs as unknown[];
  if (!Array.isArray(soilRefs)) {
    addIssue("SOIL_REFS_NOT_ARRAY", "directionHandoff.soilRefs", "Soil references must be an array of refs.");
    return;
  }

  for (const [index, soilRef] of soilRefs.entries()) {
    if (typeof soilRef !== "string" || soilRef.trim() === "") {
      addIssue(
        "INLINE_SOIL_ASSET_CONTENT",
        `directionHandoff.soilRefs.${index}`,
        "DirectionHandoffPackage may include only Soil refs, not inline Soil asset content, body, or copies."
      );
    }
  }

  const packageRecord = pkg as unknown as Record<string, unknown>;
  if (hasInlineSoilContent(packageRecord.soilReferenceIndex)) {
    addIssue(
      "INLINE_SOIL_ASSET_CONTENT",
      "soilReferenceIndex",
      "Soil reference indexes may include refs only, not inline Soil asset content, body, or copies."
    );
  }
}

function validateDirectionEvidenceBoundary(
  pkg: DirectionHandoffPackage,
  addIssue: (code: string, path: string, message: string) => void
): void {
  const packageRecord = pkg as unknown as Record<string, unknown>;
  if ("growthPlan" in packageRecord) {
    addIssue(
      "GROWTH_PLAN_INLINE_IN_HANDOFF_PACKAGE",
      "growthPlan",
      "DirectionHandoffPackage must not embed GrowthPlan; Aboveground Center creates it after validation."
    );
  }
}

function hasInlineSoilContent(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasInlineSoilContent(entry));
  }
  if (typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const disallowedKeys = new Set(["content", "body", "copy", "assetContent", "assetBody", "soilAssetContent"]);
  return Object.entries(record).some(
    ([key, nestedValue]) => disallowedKeys.has(key) || hasInlineSoilContent(nestedValue)
  );
}
