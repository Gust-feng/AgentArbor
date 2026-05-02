import type { DirectionHandoffPackage } from "./contracts.js";
import type { AddDirectionHandoffPackageIssue } from "./validation-issues.js";

const CONVERGENCE_OUTCOMES = new Set(["approved", "awaiting_user", "stopped"]);

export function validateConvergenceReviewConsistency(
  pkg: DirectionHandoffPackage,
  addIssue: AddDirectionHandoffPackageIssue
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
  addIssue: AddDirectionHandoffPackageIssue
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
  addIssue: AddDirectionHandoffPackageIssue
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
  addIssue: AddDirectionHandoffPackageIssue
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
