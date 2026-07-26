import type {
  ArborMessage,
  ArborMessageType,
  ArtifactRef,
} from "../common.js";
import type { DirectionHandoffPackage } from "../agentarbor/direction-handoff-package/contracts.js";
import type { GrowthPlan, TaskSpec, WorkflowIR } from "../aboveground/contracts.js";
import type { ExperienceCandidate, FruitCandidate, PathBias } from "../fruits/contracts.js";
import type { VerificationReport } from "../governance/contracts.js";
import type { CandidateComparison } from "../underground/candidate-comparison-contracts.js";
import type {
  CandidateConvergenceDecision,
  CandidatePoolCounts,
  RejectedCandidateRefWithReason,
} from "../underground/candidate-convergence-contracts.js";
import type { UndergroundAgentClusterRun, UndergroundAgentInvocationStatus } from "../underground/agent-cluster.js";
import type { AgentRunTree } from "../underground/agent-fabric.js";
import type { UndergroundAutonomyAction, UndergroundAutonomyStopReason } from "../underground/autonomy.js";
import type {
  UserClarificationQuestion,
  UserClarificationReason,
  UserClarificationRequest,
  UserClarificationResponse,
  UserClarificationStatus,
} from "../underground/clarification.js";
import type { UndergroundEvidenceKind } from "../underground/evidence-ledger.js";
import type {
  ExplorationBudget,
  RootletClusterKind,
  RootletOutput,
} from "../underground/rootlet-contracts.js";
import type {
  RootletClusterStatus,
  UndergroundCenterRole,
  UndergroundConvergenceOutcome,
  UndergroundExplorationReport,
} from "../underground/radial-growth.js";

export type RunPhase =
  | "not_started"
  | "agent"
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
  | "model_requested"
  | "model_completed"
  | "model_failed"
  | "context_compaction_completed"
  | "context_compaction_failed"
  | "tool_requested"
  | "tool_completed"
  | "tool_failed"
  | "tool_cancelled"
  | "skill_triggered"
  | "agent_delegation_planned"
  | "agent_child_started"
  | "agent_child_completed"
  | "agent_child_interrupted"
  | "agent_child_resumed"
  | "agent_child_waiting"
  | "agent_parent_synthesis_completed"
  | "deep_goal_received"
  | "deep_manager_decided"
  | "deep_child_started"
  | "deep_child_waiting"
  | "deep_child_instruction_queued"
  | "deep_child_completed"
  | "deep_child_blocked"
  | "deep_child_interrupted"
  | "deep_child_failed"
  | "deep_parent_synthesis_completed"
  | "deep_failed"
  | "deep_interrupted"
  | "deep_corrected"
  | "deep_stopped"
  | "deep_conclusion_produced"
  | "autonomy_review_completed"
  | "convergence_review_requested"
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
  | "cancelled"
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
    | "autonomy_decision"
    | "convergence_review"
    | "model_call"
    | "tool_call"
    | "agent_spec"
    | "agent_run"
    | "agent_delegation"
    | "parent_synthesis"
    | "user_clarification"
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
  readonly agentCluster?: {
    readonly runId: string;
    readonly terminalStatus: UndergroundAgentClusterRun["terminalStatus"];
    readonly candidateRefs: readonly string[];
    readonly packageRef?: UndergroundAgentClusterRun["packageRef"];
    readonly plan: {
      readonly planId: string;
      readonly goalId: string;
      readonly rootletKinds: readonly string[];
      readonly schedulingReasons: readonly string[];
      readonly agents: readonly {
        readonly agentId: string;
        readonly role: string;
        readonly rootletKind?: string;
        readonly inputRefs: readonly string[];
        readonly schedulingReason: string;
      }[];
    };
    readonly invocations: readonly {
      readonly invocationId: string;
      readonly agentId: string;
      readonly role: string;
      readonly inputRefs: readonly string[];
      readonly outputRefs: readonly string[];
      readonly status: UndergroundAgentInvocationStatus;
      readonly startedAt: string;
      readonly completedAt?: string;
      readonly failureReason?: string;
    }[];
  };
  readonly agentRunTree?: {
    readonly treeId: string;
    readonly rootRunId: string;
    readonly rootAgentId: string;
    readonly status: AgentRunTree["status"];
    readonly rootSpec: {
      readonly specId: string;
      readonly agentId: string;
      readonly displayName: string;
      readonly agentKind: string;
      readonly role: string;
      readonly promptRef: string;
      readonly outputContractRef: string;
      readonly allowedTools: readonly string[];
      readonly allowModel: boolean;
      readonly budget: {
        readonly maxModelRounds?: number;
        readonly maxToolRounds?: number;
        readonly maxChildRuns?: number;
        readonly maxOutputRefs?: number;
      };
    };
    readonly childRuns: readonly {
      readonly childRunId: string;
      readonly parentAgentId: string;
      readonly status: string;
      readonly specId: string;
      readonly agentId: string;
      readonly displayName: string;
      readonly agentKind: string;
      readonly role: string;
      readonly rootletKind?: RootletClusterKind;
      readonly promptRef: string;
      readonly outputContractRef: string;
      readonly allowModel: boolean;
      readonly allowedTools: readonly string[];
      readonly budget: {
        readonly maxModelRounds?: number;
        readonly maxToolRounds?: number;
        readonly maxChildRuns?: number;
        readonly maxOutputRefs?: number;
      };
      readonly inputRefs: readonly string[];
      readonly outputRefs: readonly string[];
      readonly evidenceRefs: readonly string[];
      readonly uncertainty?: string;
      readonly confidence?: number;
      readonly execution?: {
        readonly modelRounds: number;
        readonly toolRounds: number;
        readonly modelRequestId?: string;
        readonly modelResponseId?: string;
        readonly toolCalls: readonly {
          readonly callId: string;
          readonly toolName: string;
          readonly status: "completed" | "failed" | "approval_required" | "cancelled";
        }[];
      };
      readonly executionHistory?: readonly {
        readonly modelRounds: number;
        readonly toolRounds: number;
        readonly modelRequestId?: string;
        readonly modelResponseId?: string;
        readonly toolCalls: readonly {
          readonly callId: string;
          readonly toolName: string;
          readonly status: "completed" | "failed" | "approval_required" | "cancelled";
        }[];
        readonly outcome: "completed" | "blocked" | "failed" | "interrupted";
        readonly recordedAt: string;
      }[];
      readonly parentInstructions?: readonly {
        readonly instructionId: string;
        readonly messageRef?: string;
        readonly source: "manager" | "control_api";
        readonly status: "queued" | "executed" | "cancelled";
        readonly instructionSummary: string;
        readonly review?: {
          readonly decision: "accepted" | "rejected" | "needs_followup";
          readonly reason: string;
          readonly evidenceRefs: readonly string[];
          readonly confidence?: number;
        };
        readonly requestedAt: string;
        readonly queuedAt?: string;
        readonly executedAt?: string;
        readonly cancelledAt?: string;
      }[];
      readonly pendingApproval?: {
        readonly confirmationId: string;
        readonly toolCallId: string;
        readonly toolName: string;
        readonly title: string;
        readonly actionSummary: string;
        readonly affectedResources: readonly string[];
        readonly riskLevel: "low" | "medium" | "high";
        readonly resumeAvailability?: "live" | "lost_after_restart";
        readonly requestedAt: string;
        readonly expiresAt?: string;
        readonly sourceRefs: readonly string[];
      };
      readonly startedAt: string;
      readonly completedAt?: string;
      readonly failureReason?: string;
    }[];
    readonly delegationDecisions: readonly {
      readonly decisionId: string;
      readonly parentAgentId: string;
      readonly action: string;
      readonly childSpecIds: readonly string[];
      readonly childRunIds: readonly string[];
      readonly rationale: string;
      readonly uncertainty: string;
      readonly source: string;
      readonly confidence: number;
      readonly reasoningTraceRefs: readonly string[];
      readonly createdAt: string;
    }[];
    readonly parentSyntheses: readonly {
      readonly synthesisId: string;
      readonly parentAgentId: string;
      readonly childRunIds: readonly string[];
      readonly retainedMaterialRefs: readonly string[];
      readonly rejectedMaterialRefs: readonly string[];
      readonly conflictRefs: readonly string[];
      readonly childReviews?: readonly {
        readonly childRunId: string;
        readonly decision: "accepted" | "rejected" | "needs_followup";
        readonly reason: string;
        readonly evidenceRefs: readonly string[];
        readonly sourceCandidateId?: string;
        readonly confidence?: number;
      }[];
      readonly outputRefs: readonly string[];
      readonly nextAction: string;
      readonly decisionSummary: string;
      readonly uncertainty: string;
      readonly source: string;
      readonly confidence: number;
      readonly reasoningTraceRefs: readonly string[];
      readonly createdAt: string;
    }[];
  };
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
    readonly agentId?: string;
    readonly invocationId?: string;
    readonly invocationStatus?: UndergroundAgentInvocationStatus;
    readonly invocationOutputRefs: readonly string[];
    readonly outputRef?: string;
    readonly outputRefs: readonly string[];
  }[];
  readonly rootletOutputs: readonly {
    readonly outputId: string;
    readonly invocationId: string;
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
      readonly summary?: string;
      readonly sourceRefs: readonly string[];
      readonly status: string;
    }[];
    readonly candidatesByKind: Readonly<
      Record<
        RootletClusterKind,
        readonly {
          readonly id: string;
          readonly kind: string;
          readonly producedByAgentId: string;
          readonly clusterId: string;
          readonly summary?: string;
          readonly sourceRefs: readonly string[];
          readonly status: string;
        }[]
      >
    >;
  };
  readonly autonomy: {
    readonly enabled: boolean;
    readonly stopReason?: UndergroundAutonomyStopReason;
    readonly cycles: readonly {
      readonly explorationCycleId: string;
      readonly cycleIndex: number;
      readonly rootletKinds: readonly RootletClusterKind[];
      readonly candidatePoolId?: string;
      readonly autonomyDecisionId?: string;
      readonly action?: UndergroundAutonomyAction;
      readonly spawnedRootletCount: number;
      readonly stopReason?: UndergroundAutonomyStopReason;
      readonly status: "running" | "completed" | "stopped" | "failed";
    }[];
    readonly latestDecision?: {
      readonly decisionId: string;
      readonly cycleId: string;
      readonly action: UndergroundAutonomyAction;
      readonly status: "completed" | "failed";
      readonly completionAssessment: string;
      readonly informationGaps: readonly string[];
      readonly spawnedRootletCount: number;
      readonly rationale: string;
      readonly sourceRefs: readonly string[];
      readonly modelCallRefs: readonly string[];
      readonly stopReason?: UndergroundAutonomyStopReason;
    };
  };
  readonly evidenceLedger: {
    readonly ledgerId?: string;
    readonly status: ObservationStatus;
    readonly totalEntries: number;
    readonly countsByKind: Readonly<Record<UndergroundEvidenceKind, number>>;
    readonly recommendedEvidenceRefs: readonly string[];
    readonly conflictEvidenceRefs: readonly string[];
    readonly insufficientEvidenceRefs: readonly string[];
    readonly hasConflicts: boolean;
    readonly hasInsufficientEvidence: boolean;
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
    readonly candidateComparisons: readonly CandidateComparison[];
    readonly recommendedOptionId?: string;
    readonly rejectedCandidateRefsWithReasons: readonly RejectedCandidateRefWithReason[];
    readonly userDecisionRequired: readonly string[];
    readonly abovegroundReferenceOptionIds: readonly string[];
    readonly budgetExhausted: boolean;
    readonly stopReason?: string;
    readonly handoffCandidateRefs: readonly string[];
    readonly openQuestions: readonly {
      readonly candidateId: string;
      readonly reason: UserClarificationReason;
      readonly question: string;
      readonly blockingLevel: "blocking" | "non_blocking";
      readonly disposition: "request_user_clarification" | "remain_open";
      readonly evidenceRefs: readonly string[];
    }[];
  };
  readonly userEscalationRequired: boolean;
  readonly userEscalation: {
    readonly required: boolean;
    readonly reason?: UserClarificationReason;
    readonly blockingLevel?: UserClarificationRequest["blockingLevel"];
    readonly requestId?: string;
    readonly status?: UserClarificationStatus;
    readonly relatedCandidateRefs: readonly string[];
    readonly questions: readonly UserClarificationQuestion[];
    readonly request?: UserClarificationRequest;
  };
  readonly clarificationResponses: readonly UserClarificationResponse[];
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
  readonly lineage: DirectionHandoffPackage["lineage"];
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
  readonly pathMemoryId?: string;
  readonly experienceCandidateId?: string;
  readonly pathBiasId?: string;
};

export type RunObservationSoilReturnStubView = {
  readonly status: ObservationStatus;
  readonly summary: string;
  readonly pathMemoryId?: string;
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
  /** Deferred Multi-Agent observation may reference a captured PathMemory by id only. */
  pathMemoryId?: string;
  experienceCandidate?: ExperienceCandidate;
  pathBias?: PathBias;
};
