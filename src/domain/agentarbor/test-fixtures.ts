import {
  createApprovedDirectionHandoff,
} from "./direction-handoff.js";
import { createDirectionHandoffPackage } from "./direction-handoff-package.js";
import type {
  ConvergenceReview,
  DirectionHandoff,
  DirectionHandoffPackage,
  ExplorationCandidateRef,
} from "../contracts.js";

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
    rejectedCandidateRefs: [],
    conflictResolutionRefs: [],
    provenanceRefs: ["goal.received"],
  };
  const directionHandoff = createApprovedDirectionHandoff(
    minimalDirectionHandoff(candidate, convergenceReview.reviewId),
    convergenceReview
  );
  const directionHandoffPackage = createDirectionHandoffPackage({ directionHandoff, convergenceReview });

  return { candidate, convergenceReview, directionHandoff, directionHandoffPackage };
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
