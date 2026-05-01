import {
  createApprovedDirectionHandoff,
} from "./direction-handoff.js";
import { createDirectionHandoffPackage } from "./direction-handoff-package.js";
import type {
  ConvergenceReview,
  DirectionHandoff,
  ExplorationCandidateRef,
} from "../underground/contracts.js";
import type { DirectionHandoffPackage } from "./direction-handoff-package/contracts.js";

export function createDirectionHandoffPackageFixture(): {
  candidate: ExplorationCandidateRef;
  convergenceReview: ConvergenceReview;
  directionHandoff: DirectionHandoff;
  directionHandoffPackage: DirectionHandoffPackage;
} {
  const candidate: ExplorationCandidateRef = {
    id: "candidate-test",
    kind: "claim_candidate",
    producedByAgentId: "underground-analyzer",
    clusterId: "cluster-test",
    sourceRefs: ["goal.received"],
    status: "accepted",
  };
  const convergenceReview: ConvergenceReview = {
    reviewId: "review-test",
    reviewedByAgentIds: ["underground-analyzer"],
    leadAgentId: "underground-analyzer",
    crossCheckedCandidateRefs: [candidate.id],
    deduplicatedCandidateRefs: [candidate.id],
    acceptedCandidateRefs: [candidate.id],
    mergedCandidateRefs: [],
    rejectedCandidateRefs: [],
    unknownCandidateRefs: [],
    conflictResolutionRefs: [],
    provenanceRefs: ["goal.received"],
    outcome: "approved",
    userEscalationRequired: false,
    openQuestions: [],
    budgetExhausted: false,
    handoffCandidateRefs: [candidate.id],
  };
  const directionHandoff = createApprovedDirectionHandoff(
    minimalDirectionHandoff(candidate, convergenceReview.reviewId),
    convergenceReview
  );
  const directionHandoffPackage = createDirectionHandoffPackage({ directionHandoff, convergenceReview });

  return { candidate, convergenceReview, directionHandoff, directionHandoffPackage };
}

export function createAwaitingUserDirectionHandoffPackageFixture(): {
  candidate: ExplorationCandidateRef;
  unknownCandidate: ExplorationCandidateRef;
  convergenceReview: ConvergenceReview;
  directionHandoff: DirectionHandoff;
  directionHandoffPackage: DirectionHandoffPackage;
} {
  const candidate: ExplorationCandidateRef = {
    id: "candidate-awaiting-accepted",
    kind: "claim_candidate",
    producedByAgentId: "underground-analyzer",
    clusterId: "cluster-test",
    sourceRefs: ["goal.received"],
    status: "accepted",
  };
  const unknownCandidate: ExplorationCandidateRef = {
    id: "candidate-awaiting-unknown",
    kind: "claim_candidate",
    producedByAgentId: "underground-analyzer",
    clusterId: "cluster-risk",
    sourceRefs: ["goal.received"],
    status: "unknown",
  };
  const convergenceReview: ConvergenceReview = {
    reviewId: "review-awaiting-user",
    reviewedByAgentIds: ["underground-analyzer"],
    leadAgentId: "underground-analyzer",
    crossCheckedCandidateRefs: [candidate.id, unknownCandidate.id],
    deduplicatedCandidateRefs: [candidate.id],
    acceptedCandidateRefs: [candidate.id],
    mergedCandidateRefs: [],
    rejectedCandidateRefs: [],
    unknownCandidateRefs: [unknownCandidate.id],
    conflictResolutionRefs: [],
    provenanceRefs: ["goal.received"],
    outcome: "awaiting_user",
    userEscalationRequired: true,
    userClarificationRequest: {
      requestId: "clarification-awaiting-user",
      goalId: "goal-test",
      relatedCandidateRefs: [unknownCandidate.id],
      primaryReason: "hard_constraint_unclear",
      questions: [
        {
          questionId: "clarification-awaiting-user:question-1",
          prompt: "Clarify the hard constraint before this direction can be approved.",
          reason: "hard_constraint_unclear",
          relatedCandidateRefs: [unknownCandidate.id],
          blocking: true,
        },
      ],
      blockingLevel: "blocking",
      createdAt: "2026-05-01T00:00:01.000Z",
      status: "requested",
    },
    openQuestions: [
      {
        candidateId: unknownCandidate.id,
        reason: "hard_constraint_unclear",
        question: "Clarify the hard constraint before this direction can be approved.",
        blockingLevel: "blocking",
        disposition: "request_user_clarification",
        evidenceRefs: [],
      },
    ],
    budgetExhausted: true,
    stopReason: "requires_user_clarification",
    handoffCandidateRefs: [candidate.id],
  };
  const baseHandoff = minimalDirectionHandoff(candidate, convergenceReview.reviewId);
  const clarificationPrompt = "Clarify the hard constraint before this direction can be approved.";
  const clarificationQuestionId = "clarification-awaiting-user:question-1";
  const directionHandoff: DirectionHandoff = {
    ...baseHandoff,
    missingInformation: ["Clarify the hard constraint before this direction can be approved."],
    decisionRecord: {
      ...baseHandoff.decisionRecord,
      userDecisionRequired: [clarificationQuestionId],
    },
    options: baseHandoff.options.map((option) => ({
      ...option,
      unknowns: [clarificationPrompt],
      doNotChooseWhen: [
        ...option.doNotChooseWhen,
        "The blocking user clarification request remains unanswered.",
      ],
    })),
    riskRegister: [
      {
        riskId: "risk-clarification-awaiting-user",
        name: "Blocking user clarification required.",
        source: "clarification-awaiting-user",
        impactScope: ["underground_center", "agentarbor_handoff", "aboveground_center"],
        blockingLevel: "ask_user",
        evidenceRefs: [unknownCandidate.id],
        mitigation: [clarificationPrompt],
      },
    ],
    growthEntry: {
      ...baseHandoff.growthEntry,
      escalationRules: [
        ...baseHandoff.growthEntry.escalationRules,
        "Resolve user clarification request clarification-awaiting-user before planning.",
      ],
    },
    status: "awaiting_user",
  };
  const directionHandoffPackage = createDirectionHandoffPackage({ directionHandoff, convergenceReview });

  return { candidate, unknownCandidate, convergenceReview, directionHandoff, directionHandoffPackage };
}

export function minimalDirectionHandoff(
  candidate: ExplorationCandidateRef,
  convergenceReviewRef: string
): Omit<DirectionHandoff, "status"> {
  return {
    id: "direction-test",
    version: 1,
    sourceGoalId: "goal-test",
    rawUserInputRef: "goal.received",
    clarifiedGoal: "test goal",
    nonGoals: [],
    assumptions: [],
    missingInformation: [],
    soilRefs: [],
    evidenceRefs: [],
    constraintRefs: [],
    candidateConstraintRefs: [],
    risks: [],
    options: [
      {
        optionId: "option-test",
        directionSummary: "test option",
        supportingEvidenceRefs: [],
        soilAssetFitRefs: [],
        constraintImpact: [],
        riskProfile: [],
        costProfile: [],
        unknowns: [],
        whyNot: [],
        doNotChooseWhen: [],
      },
    ],
    decisionRecord: {
      retainedOptionId: "option-test",
      mergedOptionIds: [],
      rejectedOptionIds: [],
      userDecisionRequired: [],
      abovegroundReferenceOptionIds: ["option-test"],
      rationaleEvidenceRefs: [],
      rationaleConstraintRefs: [],
      rationaleRiskRefs: [],
    },
    riskRegister: [],
    sourceCandidateRefs: [candidate],
    convergenceReviewRef,
    recommendedOptionId: "option-test",
    growthEntry: {
      allowedRuntimeShapes: ["single_agent"],
      suggestedFirstWorkflowNodes: ["generate"],
      escalationRules: [],
    },
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

export function clonePackage(pkg: DirectionHandoffPackage): DirectionHandoffPackage {
  return JSON.parse(JSON.stringify(pkg)) as DirectionHandoffPackage;
}

export function tamperAwaitingUserPackageToApprovedShape(pkg: DirectionHandoffPackage): DirectionHandoffPackage {
  const tamperedPackage = clonePackage(pkg);
  tamperedPackage.directionHandoff.status = "approved";
  tamperedPackage.manifest.status = "approved";
  tamperedPackage.directionHandoff.missingInformation = [];
  tamperedPackage.directionHandoff.decisionRecord.userDecisionRequired = [];
  tamperedPackage.directionHandoff.options = tamperedPackage.directionHandoff.options.map((option) => ({
    ...option,
    unknowns: [],
    doNotChooseWhen: [],
  }));
  tamperedPackage.directionHandoff.risks = [];
  tamperedPackage.directionHandoff.riskRegister = [];
  tamperedPackage.directionHandoff.growthEntry.escalationRules = [];
  tamperedPackage.convergenceReview.outcome = "approved";
  tamperedPackage.convergenceReview.userEscalationRequired = false;
  delete tamperedPackage.convergenceReview.userClarificationRequest;
  tamperedPackage.validation = {
    passed: true,
    checkedAt: "2026-05-01T00:00:02.000Z",
    errors: [],
    warnings: [],
  };
  return tamperedPackage;
}
