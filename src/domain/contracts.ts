export type RuntimeShape =
  | "single_agent"
  | "sub_agent_tree"
  | "shared_team_cluster"
  | "competitive_team_cluster"
  | "fruit_run";

export type TaskState =
  | "Draft"
  | "DirectionReady"
  | "Planning"
  | "Assigned"
  | "Running"
  | "Blocked"
  | "NutrientRequested"
  | "Revising"
  | "Verifying"
  | "AcceptedForDelivery"
  | "Fruiting"
  | "GovernanceReview"
  | "Delivered"
  | "Archived"
  | "Cancelled"
  | "Failed";

export type AgentLayer =
  | "soil"
  | "underground_center"
  | "agentarbor_handoff"
  | "aboveground_center"
  | "aboveground_growth"
  | "verification"
  | "fruits"
  | "governance";

export type ArborMessageType =
  | "goal.received"
  | "direction_handoff.requested"
  | "direction_handoff.completed"
  | "direction_handoff.revision_requested"
  | "user_approval.requested"
  | "user_approval.received"
  | "nutrient_request.requested"
  | "nutrient_patch.supplied"
  | "growth_plan.requested"
  | "growth_plan.completed"
  | "growth_plan.revision_requested"
  | "growth_plan.revised"
  | "workflow.created"
  | "task.created"
  | "task.assigned"
  | "task.started"
  | "task.progress"
  | "task.blocked"
  | "task.completed"
  | "task.failed"
  | "artifact.produced"
  | "artifact.updated"
  | "verification.requested"
  | "verification.completed"
  | "verification.failed"
  | "acceptance.requested"
  | "acceptance.completed"
  | "acceptance.rejected"
  | "fruit.proposed"
  | "run_memory.captured"
  | "experience_candidate.proposed"
  | "path_bias.suggested"
  | "governance.review.requested"
  | "governance.review.completed"
  | "error.raised";

export type ArtifactRef = {
  id: string;
  taskId?: string;
  producedBy: string;
  type: "document" | "code" | "config" | "report" | "log" | "package";
  path?: string;
  uri?: string;
  version: string;
  createdAt: string;
};

export type ArborMessage<TPayload = unknown> = {
  id: string;
  traceId: string;
  taskId?: string;
  parentTaskId?: string;
  from: { id: string; role?: string; cluster?: string };
  to?: { id: string } | { role: string } | { group: string };
  type: ArborMessageType;
  intent: string;
  payload: TPayload;
  artifacts?: ArtifactRef[];
  requiredCapabilities?: string[];
  priority?: "low" | "normal" | "high" | "critical";
  permissions?: {
    canRead?: string[];
    canWrite?: string[];
    canExecute?: string[];
  };
  createdAt: string;
};

export type Constraint = {
  id: string;
  source:
    | "user"
    | "underground_center"
    | "agentarbor_handoff"
    | "aboveground_center"
    | "aboveground_growth"
    | "verification"
    | "governance"
    | "soil"
    | "external";
  type:
    | "goal"
    | "non_goal"
    | "scope"
    | "permission"
    | "cost"
    | "time"
    | "technical"
    | "data_security"
    | "human_approval"
    | "verification"
    | "asset_governance"
    | "evolution";
  level: "hard" | "soft" | "preference";
  statement: string;
  owner:
    | "user"
    | "underground_center"
    | "aboveground_center"
    | "verification"
    | "governance";
  appliesTo: string[];
  evidenceRefs: string[];
  enforcementGate:
    | "direction_handoff"
    | "growth_plan"
    | "task_assignment"
    | "tool_execution"
    | "verification"
    | "fruit_governance"
    | "soil_promotion";
  conflictPolicy:
    | "block"
    | "ask_user"
    | "aboveground_center_decides"
    | "verification_reviews"
    | "governance_review";
  status:
    | "proposed"
    | "approved"
    | "active"
    | "waived"
    | "violated"
    | "retired";
};

export type ConstraintRef = {
  constraintId: string;
  requiredLevel: "hard" | "soft" | "preference";
  enforcementGate: Constraint["enforcementGate"];
};

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
  sourceRefs: string[];
  status: "candidate" | "accepted" | "merged" | "rejected" | "unknown";
};

export type ConvergenceReview = {
  reviewId: string;
  reviewedByAgentIds: string[];
  leadAgentId: string;
  crossCheckedCandidateRefs: string[];
  deduplicatedCandidateRefs: string[];
  acceptedCandidateRefs: string[];
  rejectedCandidateRefs: string[];
  conflictResolutionRefs: string[];
  provenanceRefs: string[];
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

export type TaskSpec = {
  id: string;
  goalId: string;
  growthPlanId: string;
  title: string;
  description: string;
  requiredCapabilities: string[];
  acceptanceCriteria: string[];
  constraintRefs: ConstraintRef[];
  status: TaskState;
  createdAt: string;
};

export type GrowthPlan = {
  id: string;
  version: number;
  goalId: string;
  directionHandoffId: string;
  directionHandoffVersion: number;
  selectedOptionId: string;
  pathBiasDecision: "adopt" | "adapt" | "reject" | "none";
  pathBiasRationale: string;
  workflowId: string;
  runtimeShape: RuntimeShape;
  tasks: TaskSpec[];
  reuseStrategy: string[];
  sedimentationStrategy: string[];
  constraintRefs: ConstraintRef[];
  constraintDistribution: Array<{
    taskId: string;
    constraintRefs: ConstraintRef[];
  }>;
  verificationGates: string[];
  nutrientRequestTriggers: string[];
  createdAt: string;
};

export type WorkflowIRNodeType =
  | "clarify"
  | "research"
  | "design"
  | "generate"
  | "execute"
  | "verify"
  | "memory"
  | "govern"
  | "nutrient_request";

export type WorkflowIRNode = {
  id: string;
  type: WorkflowIRNodeType;
  taskId?: string;
  dependsOn: string[];
  inputs: string[];
  outputs: string[];
  executionCondition: string;
  requiredPermissions: string[];
  constraintRefs: ConstraintRef[];
  verificationGate?: string;
  failureHandling: "block" | "request_nutrient" | "revise_plan";
  pausePoints: string[];
  resumeHints: string[];
  pathBiasRefs: string[];
  nutrientRequestTriggers: string[];
  harvestOutputs: string[];
};

export type WorkflowIR = {
  id: string;
  goalId: string;
  directionHandoffId: string;
  directionHandoffVersion: number;
  growthPlanId: string;
  growthPlanVersion: number;
  nodes: WorkflowIRNode[];
  dependencies: Array<{ fromNodeId: string; toNodeId: string }>;
  inputs: string[];
  outputs: string[];
  executionConditions: string[];
  permissions: {
    canRead: string[];
    canWrite: string[];
    canExecute: string[];
  };
  constraintRefs: ConstraintRef[];
  verificationGates: string[];
  failureHandling: string[];
  pausePoints: string[];
  resumeState?: string;
  pathBiasInputs: string[];
  nutrientRequestTriggers: string[];
  harvestOutputs: string[];
  createdAt: string;
};

export type GrowthPlanRevision = {
  id: string;
  goalId: string;
  revisesGrowthPlanId: string;
  nextGrowthPlanId: string;
  nutrientRequestId?: string;
  nutrientPatchId?: string;
  directionHandoffId: string;
  directionHandoffVersion: number;
  reason: string;
  impactScope: string[];
  decision: "continue" | "rollback" | "branch" | "stop";
  changedTasks: string[];
  createdAt: string;
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

export type RunMemory = {
  id: string;
  sourceGoalId: string;
  directionHandoffId: string;
  directionHandoffVersion: number;
  growthPlanId: string;
  nutrientRequestIds: string[];
  nutrientPatchIds: string[];
  growthPlanRevisionIds: string[];
  sourceTaskIds: string[];
  sourceAgentIds: string[];
  artifactIds: string[];
  verificationIds: string[];
  actualPath: string[];
  deviations: string[];
  successPatterns: string[];
  failurePatterns: string[];
  reusableSignals: string[];
  riskNotes: string[];
  createdAt: string;
};

export type ExperienceCandidate = {
  id: string;
  sourceRunMemoryId: string;
  appliesToGoalTypes: string[];
  reusablePattern: string;
  preconditions: string[];
  requiredVerificationGates: string[];
  doNotApplyWhen: string[];
  confidence: "low" | "medium" | "high";
  governanceStatus: "captured" | "under_review" | "accepted" | "rejected" | "expired";
};

export type PathBias = {
  id: string;
  sourceExperienceCandidateId: string;
  appliesToGoalTypes: string[];
  preconditions: string[];
  preferredNodes: string[];
  preferredCapabilities: string[];
  requiredVerificationGates: string[];
  knownFailureModes: string[];
  doNotApplyWhen: string[];
  confidence: "low" | "medium" | "high";
};

export type VerificationReport = {
  id: string;
  taskId: string;
  artifactIds: string[];
  status: "passed" | "failed";
  checks: Array<{
    name: string;
    status: "passed" | "failed";
    message?: string;
  }>;
  nutrientRequestSuggestion?: NutrientRequest["reason"];
  createdAt: string;
};

export type AgentManifest = {
  id: string;
  name: string;
  layer: AgentLayer;
  description: string;
  lifecycle: {
    status: "active" | "retired";
    createdReason: string;
    retirementCondition: string;
  };
  capabilities: string[];
  inputEvents: ArborMessageType[];
  outputEvents: ArborMessageType[];
  permissions: {
    read: string[];
    write: string[];
    execute: string[];
  };
};

export type FruitCandidate = {
  id: string;
  sourceGoalId: string;
  artifactIds: string[];
  verificationIds: string[];
  proposedBy: string;
  governanceStatus: "proposed" | "approved_for_soil_review" | "rejected";
  createdAt: string;
};
