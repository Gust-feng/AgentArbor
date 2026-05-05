import type { RuntimeShape } from "../common.js";
import type { ConstraintRef } from "../constraints.js";
import type { CandidateComparison } from "./candidate-comparison.js";
import type { OpenQuestionDisposition, UserClarificationRequest } from "./clarification.js";

export type DirectionOption = {
  optionId: string;
  directionSummary: string;
  supportingEvidenceRefs: string[];
  soilAssetFitRefs: string[];
  constraintImpact: string[];
  riskProfile: string[];
  costProfile: string[];
  unknowns: string[];
  whyNot: string[];
  recommendationScore?: number;
  doNotChooseWhen: string[];
};

export type DirectionDecisionRecord = {
  retainedOptionId: string;
  mergedOptionIds: string[];
  rejectedOptionIds: string[];
  userDecisionRequired: string[];
  abovegroundReferenceOptionIds: string[];
  rationaleEvidenceRefs: string[];
  rationaleConstraintRefs: string[];
  rationaleRiskRefs: string[];
};

export type DirectionRiskRecord = {
  riskId: string;
  name: string;
  source: string;
  impactScope: string[];
  blockingLevel: "none" | "watch" | "block" | "ask_user" | "governance_review";
  evidenceRefs: string[];
  mitigation: string[];
};

export type ExplorationCandidateRef = {
  id: string;
  kind: "observation" | "evidence_candidate" | "claim_candidate";
  producedByAgentId: string;
  clusterId: string;
  summary?: string;
  sourceRefs: string[];
  status: "candidate" | "accepted" | "merged" | "rejected" | "unknown";
};

export type ConvergenceReviewOutcome = "approved" | "awaiting_user" | "stopped";

export type ConvergenceStopReason =
  | "budget_exhausted_without_converged_candidates"
  | "no_converged_candidates"
  | "requires_user_clarification"
  | "ai_required_for_autonomy"
  | "autonomy_decision_failed"
  | "autonomy_stopped"
  | "autonomy_cycle_guard_exceeded";

export type ConvergenceReview = {
  reviewId: string;
  reviewedByAgentIds: string[];
  leadAgentId: string;
  crossCheckedCandidateRefs: string[];
  deduplicatedCandidateRefs: string[];
  acceptedCandidateRefs: string[];
  mergedCandidateRefs?: string[];
  rejectedCandidateRefs: string[];
  rejectedCandidateRefsWithReasons?: {
    candidateId: string;
    reason: string;
    provenanceRefs: string[];
  }[];
  unknownCandidateRefs?: string[];
  conflictResolutionRefs: string[];
  provenanceRefs: string[];
  candidateComparisons?: CandidateComparison[];
  recommendedOptionId?: string;
  userDecisionRequired?: string[];
  abovegroundReferenceOptionIds?: string[];
  outcome?: ConvergenceReviewOutcome;
  userEscalationRequired?: boolean;
  userClarificationRequest?: UserClarificationRequest;
  openQuestions?: OpenQuestionDisposition[];
  budgetExhausted?: boolean;
  stopReason?: ConvergenceStopReason;
  handoffCandidateRefs?: string[];
};

export type DirectionHandoff = {
  id: string;
  version: number;
  sourceGoalId: string;
  rawUserInputRef: string;
  clarifiedGoal: string;
  nonGoals: string[];
  assumptions: string[];
  missingInformation: string[];
  soilRefs: string[];
  evidenceRefs: string[];
  constraintRefs: ConstraintRef[];
  candidateConstraintRefs: ConstraintRef[];
  risks: string[];
  options: DirectionOption[];
  decisionRecord: DirectionDecisionRecord;
  riskRegister: DirectionRiskRecord[];
  sourceCandidateRefs: ExplorationCandidateRef[];
  convergenceReviewRef: string;
  recommendedOptionId?: string;
  growthEntry: {
    allowedRuntimeShapes: RuntimeShape[];
    suggestedFirstWorkflowNodes: string[];
    escalationRules: string[];
  };
  status: "draft" | "awaiting_user" | "approved" | "superseded";
  createdAt: string;
  updatedAt: string;
};

export type NutrientRequest = {
  id: string;
  goalId: string;
  requestedBy: {
    agentId: string;
    layer: "aboveground_center" | "aboveground_growth" | "verification" | "governance";
  };
  needType:
    | "evidence"
    | "soil_asset"
    | "external_fact"
    | "constraint_detail"
    | "context"
    | "capability_hint";
  reason:
    | "nutrient_gap"
    | "verification_failed"
    | "path_bias_invalid"
    | "goal_changed"
    | "assumption_invalid"
    | "permission_or_cost_invalid"
    | "governance_evidence_missing";
  neededFor: string;
  blockingLevel: "blocking" | "helpful" | "optional";
  currentAssumption?: string;
  evidenceGap?: string;
  acceptedFallback?: "continue" | "degrade" | "rollback" | "stop";
  status: "requested" | "accepted" | "supplied" | "rejected" | "superseded";
  createdAt: string;
  completedAt?: string;
};

export type NutrientPatch = {
  id: string;
  goalId: string;
  requestId: string;
  sourceDirectionHandoffId: string;
  sourceDirectionHandoffVersion: number;
  newDirectionHandoffId?: string;
  newDirectionHandoffVersion?: number;
  suppliedEvidenceRefs: string[];
  soilAssetRefs: string[];
  constraintRefs: ConstraintRef[];
  externalFactRefs: string[];
  contextSupplementRefs: string[];
  capabilityHints: string[];
  sourceCandidateRefs: ExplorationCandidateRef[];
  convergenceReviewRef: string;
  assumptionVerdict: "supported" | "weakened" | "rejected" | "unknown";
  growthPlanImpact: "none" | "continue" | "revise" | "branch" | "rollback" | "stop";
  status: "supplied" | "no_patch_needed" | "requires_user" | "requires_governance";
  createdAt: string;
};
