import type {
  ArborMessage,
  ArborMessageType,
  ArtifactRef,
  DirectionHandoffPackage,
  ExperienceCandidate,
  FruitCandidate,
  GrowthPlan,
  PathBias,
  RunMemory,
  TaskSpec,
  VerificationReport,
  WorkflowIR,
} from "../contracts.js";
import type {
  CandidateConvergenceDecision,
  CandidatePoolCounts,
  ExplorationBudget,
  RootletClusterKind,
  RootletClusterStatus,
  RootletOutput,
  UndergroundCenterRole,
  UndergroundConvergenceOutcome,
  UndergroundExplorationReport,
} from "../underground/index.js";

export type RunPhase =
  | "not_started"
  | "underground"
  | "handoff"
  | "aboveground"
  | "verification"
  | "fruits"
  | "governance"
  | "soil_return"
  | "completed";

export type RunStage =
  | "not_started"
  | "goal_received"
  | "underground_exploration_planned"
  | "rootlet_clusters_started"
  | "exploration_candidates_produced"
  | "candidate_pool_updated"
  | "convergence_review_completed"
  | "direction_handoff_requested"
  | "direction_handoff_completed"
  | "direction_handoff_revision_requested"
  | "user_approval_requested"
  | "user_approval_received"
  | "nutrient_request_requested"
  | "nutrient_patch_supplied"
  | "growth_plan_requested"
  | "growth_plan_completed"
  | "growth_plan_revision_requested"
  | "growth_plan_revised"
  | "workflow_created"
  | "task_created"
  | "task_assigned"
  | "task_started"
  | "task_progress"
  | "task_blocked"
  | "task_completed"
  | "task_failed"
  | "artifact_produced"
  | "artifact_updated"
  | "verification_requested"
  | "verification_completed"
  | "verification_failed"
  | "acceptance_requested"
  | "acceptance_completed"
  | "acceptance_rejected"
  | "fruit_proposed"
  | "run_memory_captured"
  | "experience_candidate_proposed"
  | "path_bias_suggested"
  | "governance_review_requested"
  | "governance_review_completed"
  | "error_raised"
  | "running";

export type ObservationScope =
  | "runtime"
  | "soil"
  | "underground"
  | "handoff"
  | "aboveground"
  | "verification"
  | "fruits"
  | "governance";

export type ObservationSeverity = "info" | "warning" | "error" | "critical";

export type ObservationStatus =
  | "not_started"
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked"
  | "failed"
  | "skipped";

export type ObservationProgress = {
  readonly status: ObservationStatus;
  readonly step?: number;
  readonly total?: number;
  readonly label: string;
};

export type ObservationRef = {
  readonly kind:
    | "trace"
    | "goal"
    | "event"
    | "task"
    | "artifact"
    | "direction_handoff"
    | "direction_package"
    | "growth_plan"
    | "workflow"
    | "rootlet"
    | "candidate"
    | "candidate_pool"
    | "convergence_review"
    | "verification"
    | "fruit"
    | "run_memory"
    | "experience_candidate"
    | "path_bias";
  readonly id: string;
  readonly label?: string;
  readonly version?: string | number;
};

export type RunObservationEventEntry = {
  readonly sequence: number;
  readonly type: ArborMessageType;
  readonly message: ArborMessage;
  readonly recordedAt: string;
};

export type RunObservationEventView = {
  readonly sequence: number;
  readonly type: ArborMessageType;
  readonly summary: string;
  readonly scope: ObservationScope;
  readonly severity: ObservationSeverity;
  readonly progress: ObservationProgress;
  readonly refs: readonly ObservationRef[];
  readonly traceId: string;
  readonly taskId?: string;
  readonly intent: string;
  readonly from: Readonly<ArborMessage["from"]>;
  readonly to?: Readonly<NonNullable<ArborMessage["to"]>>;
  readonly createdAt: string;
  readonly recordedAt: string;
};

export type RunObservationSnapshot = {
  readonly traceId: string;
  readonly goalId: string;
  readonly currentPhase: RunPhase;
  readonly currentStage: RunStage;
  readonly eventCursor: {
    readonly eventCount: number;
    readonly lastSequence: number;
    readonly lastEventType?: ArborMessageType;
  };
  readonly events: readonly RunObservationEventView[];
  readonly underground: RunObservationUndergroundView;
  readonly handoff: RunObservationHandoffView;
  readonly aboveground: RunObservationAbovegroundView;
  readonly fruits: RunObservationFruitsView;
  readonly governance: RunObservationGovernanceView;
  readonly soilReturnStub: RunObservationSoilReturnStubView;
  // Compatibility view for V0.3 callers. Prefer `handoff` for new code.
  readonly directionPackageRef: {
    readonly packageId: string;
    readonly directionId: string;
    readonly version: number;
    readonly status: DirectionHandoffPackage["manifest"]["status"];
    readonly validationPassed: boolean;
  };
  // Compatibility view for V0.3 callers. Prefer `fruits.artifactRefs`.
  readonly artifactRefs: readonly ArtifactRef[];
  // Compatibility view for V0.3 callers. Prefer `fruits.verification`.
  readonly verification: {
    readonly reportId?: string;
    readonly status?: VerificationReport["status"];
    readonly passedChecks: number;
    readonly totalChecks: number;
  };
};

export type RunObservationUndergroundView = {
  readonly planId: string;
  readonly status: ObservationStatus;
  readonly budget: ExplorationBudget;
  readonly rootletClusters: readonly {
    readonly clusterId: string;
    readonly kind: RootletClusterKind;
    readonly stewardRole: UndergroundCenterRole;
    readonly status: RootletClusterStatus;
    readonly objective: string;
    readonly inputRefs: readonly string[];
    readonly exitCriteria: readonly string[];
    readonly budget: Pick<ExplorationBudget, "maxCandidateOutputs">;
    readonly outputRef?: string;
  }[];
  readonly rootletOutputs: readonly {
    readonly outputId: string;
    readonly clusterId: string;
    readonly kind: RootletOutput["kind"];
    readonly producedByAgentId: string;
    readonly summary: string;
    readonly sourceRefs: readonly string[];
    readonly evidenceRefs: readonly string[];
    readonly soilAssetFitRefs: readonly string[];
    readonly constraintRefs: readonly RootletOutput["constraintRefs"][number][];
    readonly riskRefs: readonly string[];
    readonly status: RootletOutput["status"];
  }[];
  readonly candidatePool: {
    readonly poolId: string;
    readonly updatedAt: string;
    readonly counts: CandidatePoolCounts;
    readonly total: number;
    readonly candidate: number;
    readonly accepted: number;
    readonly merged: number;
    readonly rejected: number;
    readonly unknown: number;
    readonly sourceRootletOutputRefs: readonly string[];
    readonly candidates: readonly {
      readonly id: string;
      readonly kind: string;
      readonly producedByAgentId: string;
      readonly clusterId: string;
      readonly sourceRefs: readonly string[];
      readonly status: string;
    }[];
  };
  readonly convergence: {
    readonly reviewId: string;
    readonly outcome: UndergroundConvergenceOutcome;
    readonly summary: string;
    readonly reviewedByAgentIds: readonly string[];
    readonly leadAgentId: string;
    readonly crossCheckedCandidateRefs: readonly string[];
    readonly deduplicatedCandidateRefs: readonly string[];
    readonly acceptedCandidateRefs: readonly string[];
    readonly mergedCandidateRefs: readonly string[];
    readonly rejectedCandidateRefs: readonly string[];
    readonly unknownCandidateRefs: readonly string[];
    readonly conflictResolutionRefs: readonly string[];
    readonly provenanceRefs: readonly string[];
    readonly decisions: readonly CandidateConvergenceDecision[];
    readonly budgetExhausted: boolean;
    readonly stopReason?: string;
    readonly handoffCandidateRefs: readonly string[];
  };
  readonly userEscalationRequired: boolean;
  readonly userEscalation: {
    readonly required: boolean;
    readonly reason?: string;
  };
};

export type RunObservationHandoffView = {
  readonly status: ObservationStatus;
  readonly packageId: string;
  readonly directionId: string;
  readonly version: number;
  readonly directionStatus: DirectionHandoffPackage["manifest"]["status"];
  readonly validationPassed: boolean;
  readonly sourceCandidateRefs: readonly string[];
  readonly convergenceReviewRef: string;
};

export type RunObservationAbovegroundView = {
  readonly status: ObservationStatus;
  readonly growthPlanId?: string;
  readonly workflowId?: string;
  readonly taskId?: string;
  readonly taskStatus?: TaskSpec["status"];
  readonly verificationGates: readonly string[];
  readonly runtimeShape?: GrowthPlan["runtimeShape"];
  readonly pathBiasDecision?: GrowthPlan["pathBiasDecision"];
  readonly taskCount: number;
};

export type RunObservationFruitsView = {
  readonly status: ObservationStatus;
  readonly artifactRefs: readonly ArtifactRef[];
  readonly verification: {
    readonly reportId?: string;
    readonly status?: VerificationReport["status"];
    readonly passedChecks: number;
    readonly totalChecks: number;
  };
  readonly fruitId?: string;
  readonly fruitStatus?: FruitCandidate["governanceStatus"];
};

export type RunObservationGovernanceView = {
  readonly status: ObservationStatus;
  readonly fruitId?: string;
  readonly fruitStatus?: FruitCandidate["governanceStatus"];
  readonly runMemoryId?: string;
  readonly experienceCandidateId?: string;
  readonly pathBiasId?: string;
};

export type RunObservationSoilReturnStubView = {
  readonly status: ObservationStatus;
  readonly summary: string;
  readonly runMemoryId?: string;
  readonly experienceCandidateId?: string;
  readonly pathBiasId?: string;
  readonly persistedSoilAssetRefs: readonly string[];
};

export type RunObservationSnapshotInput = {
  traceId: string;
  goalId: string;
  eventEntries: readonly RunObservationEventEntry[];
  undergroundReport: UndergroundExplorationReport;
  directionHandoffPackage: DirectionHandoffPackage;
  growthPlan?: GrowthPlan;
  workflow?: WorkflowIR;
  task?: TaskSpec;
  artifactRefs?: readonly ArtifactRef[];
  verification?: VerificationReport;
  fruit?: FruitCandidate;
  runMemory?: RunMemory;
  experienceCandidate?: ExperienceCandidate;
  pathBias?: PathBias;
};
