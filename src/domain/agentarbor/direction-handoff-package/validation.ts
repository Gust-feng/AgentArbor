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

const CONVERGENCE_OUTCOMES = new Set(["approved", "awaiting_user", "stopped"]);

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

  return {
    passed: errors.length === 0,
    checkedAt: nowIso(),
    errors,
    warnings,
  };
}

function validateLineage(
  pkg: DirectionHandoffPackage,
  addIssue: (code: string, path: string, message: string) => void
): void {
  const lineage = pkg.lineage;
  if (lineage === undefined) {
    addIssue("MISSING_PACKAGE_LINEAGE", "lineage", "DirectionHandoffPackage must carry lineage metadata.");
    return;
  }

  if (lineage.current.packageId !== pkg.manifest.packageId) {
    addIssue("LINEAGE_CURRENT_PACKAGE_MISMATCH", "lineage.current.packageId", "Lineage current packageId must match manifest.");
  }
  if (lineage.current.directionId !== pkg.manifest.directionId) {
    addIssue("LINEAGE_CURRENT_DIRECTION_MISMATCH", "lineage.current.directionId", "Lineage current directionId must match manifest.");
  }
  if (lineage.current.version !== pkg.manifest.directionVersion) {
    addIssue("LINEAGE_CURRENT_VERSION_MISMATCH", "lineage.current.version", "Lineage current version must match manifest.");
  }
  if (lineage.current.status !== pkg.manifest.status) {
    addIssue("LINEAGE_CURRENT_STATUS_MISMATCH", "lineage.current.status", "Lineage current status must match manifest.");
  }
  if (lineage.current.schemaVersion !== pkg.manifest.schemaVersion) {
    addIssue(
      "LINEAGE_CURRENT_SCHEMA_VERSION_MISMATCH",
      "lineage.current.schemaVersion",
      "Lineage current schemaVersion must match manifest."
    );
  }

  if (lineage.revisionReason === "initial" && lineage.previous !== undefined) {
    addIssue("INITIAL_LINEAGE_HAS_PREVIOUS", "lineage.previous", "Initial DirectionHandoffPackage lineage must not point to a previous package.");
  }
  if (lineage.revisionReason !== "initial" && lineage.previous === undefined) {
    addIssue("REVISION_LINEAGE_MISSING_PREVIOUS", "lineage.previous", "Revised DirectionHandoffPackage lineage must point to the previous package.");
  }
  if (lineage.previous !== undefined) {
    if (lineage.previous.directionId !== pkg.manifest.directionId) {
      addIssue("LINEAGE_PREVIOUS_DIRECTION_MISMATCH", "lineage.previous.directionId", "Revised package lineage must stay on the same direction id.");
    }
    if (lineage.previous.version >= pkg.manifest.directionVersion) {
      addIssue("LINEAGE_PREVIOUS_VERSION_INVALID", "lineage.previous.version", "Lineage previous version must be lower than the current package version.");
    }
  }

  if (!Array.isArray(lineage.sourceRefs) || lineage.sourceRefs.length === 0) {
    addIssue("LINEAGE_SOURCE_REFS_EMPTY", "lineage.sourceRefs", "Package lineage must record source refs for the revision.");
  }
  if (typeof lineage.createdAt !== "string" || lineage.createdAt.trim() === "") {
    addIssue("LINEAGE_CREATED_AT_MISSING", "lineage.createdAt", "Package lineage must record createdAt.");
  }
}

export function assertDirectionHandoffPackageValidForPlanning(pkg: DirectionHandoffPackage): void {
  const validation = validateDirectionHandoffPackage(pkg);
  if (!validation.passed) {
    throw new DirectionHandoffPackageValidationError(validation);
  }
}

function validateConvergenceReviewConsistency(
  pkg: DirectionHandoffPackage,
  addIssue: (code: string, path: string, message: string) => void
): void {
  const { convergenceReview, directionHandoff } = pkg;
  const outcome = convergenceReview.outcome;
  if (outcome === undefined) {
    addIssue(
      "MISSING_CONVERGENCE_OUTCOME",
      "convergenceReview.outcome",
      "DirectionHandoffPackage validation requires the convergence review outcome."
    );
  } else if (!CONVERGENCE_OUTCOMES.has(outcome)) {
    addIssue(
      "INVALID_CONVERGENCE_OUTCOME",
      "convergenceReview.outcome",
      "DirectionHandoffPackage convergence outcome must be approved, awaiting_user, or stopped."
    );
  }

  if (typeof convergenceReview.userEscalationRequired !== "boolean") {
    addIssue(
      "MISSING_USER_ESCALATION_STATE",
      "convergenceReview.userEscalationRequired",
      "DirectionHandoffPackage validation requires an explicit user escalation state."
    );
  }

  if (outcome === "approved" && directionHandoff.status !== "approved") {
    addIssue(
      "HANDOFF_STATUS_CONVERGENCE_OUTCOME_MISMATCH",
      "directionHandoff.status",
      "An approved convergence review must produce an approved DirectionHandoff."
    );
  }

  if (outcome === "awaiting_user" && directionHandoff.status !== "awaiting_user") {
    addIssue(
      "HANDOFF_STATUS_CONVERGENCE_OUTCOME_MISMATCH",
      "directionHandoff.status",
      "An awaiting_user convergence review must not be promoted to an approved DirectionHandoff."
    );
  }

  if (outcome === "stopped" && directionHandoff.status === "approved") {
    addIssue(
      "HANDOFF_STATUS_CONVERGENCE_OUTCOME_MISMATCH",
      "directionHandoff.status",
      "A stopped convergence review cannot produce an approved DirectionHandoff."
    );
  }

  if (outcome === "approved") {
    if (convergenceReview.userEscalationRequired === true) {
      addIssue(
        "APPROVED_HANDOFF_HAS_USER_ESCALATION",
        "convergenceReview.userEscalationRequired",
        "Approved DirectionHandoffPackages must not require user escalation."
      );
    }
    if (convergenceReview.userClarificationRequest !== undefined) {
      addIssue(
        "APPROVED_HANDOFF_HAS_CLARIFICATION_REQUEST",
        "convergenceReview.userClarificationRequest",
        "Approved DirectionHandoffPackages must not carry an unresolved user clarification request."
      );
    }
    validateApprovedHandoffHasNoUnresolvedUserDecisionSignals(pkg, addIssue);
    validateApprovedConvergenceHasNoUnresolvedClarificationEvidence(pkg, addIssue);
  }

  if (outcome === "awaiting_user") {
    if (convergenceReview.userEscalationRequired !== true) {
      addIssue(
        "AWAITING_USER_REQUIRES_ESCALATION",
        "convergenceReview.userEscalationRequired",
        "awaiting_user convergence must explicitly require user escalation."
      );
    }
    const request = convergenceReview.userClarificationRequest;
    if (request === undefined) {
      addIssue(
        "AWAITING_USER_MISSING_CLARIFICATION_REQUEST",
        "convergenceReview.userClarificationRequest",
        "awaiting_user convergence must include a UserClarificationRequest."
      );
    } else {
      if (request.status !== "requested") {
        addIssue(
          "AWAITING_USER_REQUEST_NOT_REQUESTED",
          "convergenceReview.userClarificationRequest.status",
          "awaiting_user convergence must reference a requested clarification."
        );
      }
      if (request.relatedCandidateRefs.length === 0 || request.questions.length === 0) {
        addIssue(
          "AWAITING_USER_REQUEST_INCOMPLETE",
          "convergenceReview.userClarificationRequest",
          "UserClarificationRequest must reference blocking candidates and questions."
        );
      }
    }
  } else if (convergenceReview.userClarificationRequest !== undefined) {
    addIssue(
      "CLARIFICATION_REQUEST_REQUIRES_AWAITING_USER",
      "convergenceReview.userClarificationRequest",
      "Only awaiting_user convergence may carry a UserClarificationRequest."
    );
  }

  validateSourceCandidatesMatchConvergenceReview(pkg, addIssue);
}

function validateApprovedHandoffHasNoUnresolvedUserDecisionSignals(
  pkg: DirectionHandoffPackage,
  addIssue: (code: string, path: string, message: string) => void
): void {
  const { directionHandoff } = pkg;

  if (directionHandoff.missingInformation.length > 0) {
    addIssue(
      "APPROVED_HANDOFF_HAS_MISSING_INFORMATION",
      "directionHandoff.missingInformation",
      "Approved DirectionHandoffPackages must not retain unresolved missing information."
    );
  }

  if (directionHandoff.decisionRecord.userDecisionRequired.length > 0) {
    addIssue(
      "APPROVED_HANDOFF_REQUIRES_USER_DECISION",
      "directionHandoff.decisionRecord.userDecisionRequired",
      "Approved DirectionHandoffPackages must not retain required user decisions."
    );
  }

  directionHandoff.options.forEach((option, index) => {
    if (option.unknowns.length > 0) {
      addIssue(
        "APPROVED_HANDOFF_OPTION_HAS_UNKNOWNS",
        `directionHandoff.options.${index}.unknowns`,
        `Approved DirectionHandoff option ${option.optionId} must not retain unresolved unknowns.`
      );
    }

    if (option.doNotChooseWhen.some(isUserClarificationBlockerText)) {
      addIssue(
        "APPROVED_HANDOFF_OPTION_HAS_CLARIFICATION_BLOCKER",
        `directionHandoff.options.${index}.doNotChooseWhen`,
        `Approved DirectionHandoff option ${option.optionId} must not retain user clarification blockers.`
      );
    }
  });

  directionHandoff.riskRegister.forEach((risk, index) => {
    if (risk.blockingLevel === "ask_user") {
      addIssue(
        "APPROVED_HANDOFF_HAS_USER_DECISION_RISK",
        `directionHandoff.riskRegister.${index}.blockingLevel`,
        `Approved DirectionHandoff risk ${risk.riskId} must not require unresolved user input.`
      );
    }
  });

  directionHandoff.growthEntry.escalationRules.forEach((rule, index) => {
    if (isUserClarificationBlockerText(rule)) {
      addIssue(
        "APPROVED_HANDOFF_HAS_CLARIFICATION_ESCALATION",
        `directionHandoff.growthEntry.escalationRules.${index}`,
        "Approved DirectionHandoffPackages must not retain user clarification escalation rules."
      );
    }
  });
}

function validateApprovedConvergenceHasNoUnresolvedClarificationEvidence(
  pkg: DirectionHandoffPackage,
  addIssue: (code: string, path: string, message: string) => void
): void {
  const { convergenceReview, directionHandoff } = pkg;
  const openQuestions = convergenceReview.openQuestions ?? [];

  openQuestions.forEach((question, index) => {
    if (question.disposition === "request_user_clarification") {
      addIssue(
        "APPROVED_CONVERGENCE_HAS_CLARIFICATION_OPEN_QUESTION",
        `convergenceReview.openQuestions.${index}.disposition`,
        `Approved convergence must not retain user clarification request evidence for candidate ${question.candidateId}.`
      );
    }

    if (question.blockingLevel === "blocking") {
      addIssue(
        "APPROVED_CONVERGENCE_HAS_BLOCKING_OPEN_QUESTION",
        `convergenceReview.openQuestions.${index}.blockingLevel`,
        `Approved convergence must not retain a blocking open question for candidate ${question.candidateId}.`
      );
    }
  });

  if (convergenceReview.stopReason === "requires_user_clarification") {
    addIssue(
      "APPROVED_CONVERGENCE_REQUIRES_USER_CLARIFICATION",
      "convergenceReview.stopReason",
      "Approved convergence must not retain a stop reason that still requires user clarification."
    );
  }

  const sourceCandidateIds = new Set(directionHandoff.sourceCandidateRefs.map((candidate) => candidate.id));
  const handoffCandidateIds = new Set(
    convergenceReview.handoffCandidateRefs ?? directionHandoff.sourceCandidateRefs.map((candidate) => candidate.id)
  );

  for (const candidateId of convergenceReview.unknownCandidateRefs ?? []) {
    if (sourceCandidateIds.has(candidateId)) {
      addIssue(
        "APPROVED_CONVERGENCE_UNKNOWN_SOURCE_CANDIDATE",
        "convergenceReview.unknownCandidateRefs",
        `Approved convergence cannot mark source candidate ${candidateId} as unknown.`
      );
    }

    if (handoffCandidateIds.has(candidateId)) {
      addIssue(
        "APPROVED_CONVERGENCE_UNKNOWN_HANDOFF_CANDIDATE",
        "convergenceReview.unknownCandidateRefs",
        `Approved convergence cannot keep handoff candidate ${candidateId} in unknownCandidateRefs.`
      );
    }
  }
}

function validateSourceCandidatesMatchConvergenceReview(
  pkg: DirectionHandoffPackage,
  addIssue: (code: string, path: string, message: string) => void
): void {
  const sourceCandidateIds = pkg.directionHandoff.sourceCandidateRefs.map((candidate) => candidate.id);
  const sourceCandidateIdSet = new Set(sourceCandidateIds);
  const acceptedOrMerged = new Set([
    ...pkg.convergenceReview.acceptedCandidateRefs,
    ...(pkg.convergenceReview.mergedCandidateRefs ?? []),
  ]);
  const unknownCandidateIds = new Set(pkg.convergenceReview.unknownCandidateRefs ?? []);

  for (const candidate of pkg.directionHandoff.sourceCandidateRefs) {
    if (!acceptedOrMerged.has(candidate.id)) {
      addIssue(
        "SOURCE_CANDIDATE_NOT_ACCEPTED_OR_MERGED",
        "directionHandoff.sourceCandidateRefs",
        `DirectionHandoff source candidate ${candidate.id} is not accepted or merged by the convergence review.`
      );
    }
    if (unknownCandidateIds.has(candidate.id)) {
      addIssue(
        "SOURCE_CANDIDATE_MARKED_UNKNOWN",
        "directionHandoff.sourceCandidateRefs",
        `DirectionHandoff source candidate ${candidate.id} is still marked unknown by the convergence review.`
      );
    }
  }

  if (pkg.convergenceReview.handoffCandidateRefs !== undefined) {
    const reviewHandoffCandidateIds = new Set(pkg.convergenceReview.handoffCandidateRefs);
    if (!setsEqual(sourceCandidateIdSet, reviewHandoffCandidateIds)) {
      addIssue(
        "HANDOFF_SOURCE_CANDIDATES_MISMATCH_REVIEW",
        "directionHandoff.sourceCandidateRefs",
        "DirectionHandoff source candidates must match convergenceReview.handoffCandidateRefs."
      );
    }
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

  const sourceCandidateById = new Map(pkg.directionHandoff.sourceCandidateRefs.map((candidate) => [candidate.id, candidate]));
  for (const indexedCandidate of pkg.candidateReferenceIndex) {
    const sourceCandidate = sourceCandidateById.get(indexedCandidate.candidateId);
    if (sourceCandidate !== undefined && indexedCandidate.status !== sourceCandidate.status) {
      addIssue(
        "CANDIDATE_INDEX_STATUS_MISMATCH",
        "candidateReferenceIndex",
        `Candidate reference index status for ${indexedCandidate.candidateId} must match the DirectionHandoff source candidate status.`
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

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function isUserClarificationBlockerText(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes("user clarification") || normalized.includes("clarification request");
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
