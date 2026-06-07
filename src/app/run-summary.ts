import type { ArborMessageType } from "../domain/common.js";
import type {
  DirectionHandoffPackageLineage,
  DirectionHandoffPackageValidationResult,
} from "../domain/agentarbor/direction-handoff-package/contracts.js";
import type { ModelVisibleOutputProjection } from "../domain/intelligence/index.js";
import type { ObservationStatus, RunPhase, RunStage } from "../domain/observation/contracts.js";
import type {
  CandidatePoolCounts,
  ExplorationBudget,
  RootletClusterKind,
  UndergroundAutonomyAction,
  UndergroundAutonomyStopReason,
  UndergroundConvergenceOutcome,
  UserClarificationReason,
} from "../domain/underground/index.js";
import type { ModelRuntimeSummaryInput } from "./model-runtime/index.js";

export type RunTerminalStatus =
  | "approved_package_created"
  | "awaiting_user"
  | "stopped";

export type RunDirectionPackageSummary = {
  readonly id: string;
  readonly directionId: string;
  readonly version: number;
  readonly status: string;
  readonly validation: Pick<DirectionHandoffPackageValidationResult, "passed" | "errors" | "warnings">;
};

export type RunSummary = {
  readonly terminalStatus: RunTerminalStatus;
  readonly directionPackage: RunDirectionPackageSummary;
  readonly recoveredPackage?: RunDirectionPackageSummary;
  readonly lineage: DirectionHandoffPackageLineage;
  readonly versions: readonly number[];
  readonly writtenPackagePath?: string;
  readonly ai: RunSummaryAiSummary;
  readonly tools: RunSummaryToolSummary;
  readonly underground: {
    readonly autonomy: {
      readonly enabled: boolean;
      readonly cycleCount: number;
      readonly latestAction?: UndergroundAutonomyAction;
      readonly latestDecisionStatus?: "completed" | "failed";
      readonly spawnedRootletCount: number;
      readonly stopReason?: UndergroundAutonomyStopReason;
      readonly sourceRefs: readonly string[];
      readonly modelCallRefs: readonly string[];
    };
    readonly rootletKinds: readonly RootletClusterKind[];
    readonly budget: ExplorationBudget;
    readonly candidateCounts: CandidatePoolCounts;
    readonly convergence: {
      readonly reviewId: string;
      readonly outcome: UndergroundConvergenceOutcome;
      readonly accepted: number;
      readonly merged: number;
      readonly rejected: number;
      readonly unknown: number;
      readonly userEscalationRequired: boolean;
      readonly stopReason?: string;
    };
  };
  readonly userEscalation?: {
    readonly requestId: string;
    readonly reason: UserClarificationReason;
    readonly questionCount: number;
    readonly relatedCandidateRefs: readonly string[];
  };
  readonly observationSnapshot: {
    readonly phase: RunPhase;
    readonly stage: RunStage;
    readonly eventCursor: {
      readonly eventCount: number;
      readonly lastSequence: number;
      readonly lastEventType?: ArborMessageType;
    };
    readonly layerStatuses: {
      readonly underground: ObservationStatus;
      readonly handoff: ObservationStatus;
      readonly aboveground: ObservationStatus;
      readonly fruits: ObservationStatus;
      readonly governance: ObservationStatus;
      readonly soilReturnStub: ObservationStatus;
    };
  };
  readonly eventLog: readonly ArborMessageType[];
};

export type RunSummaryAiInput = ModelRuntimeSummaryInput;

export type RunSummaryAiSummary = {
  readonly enabled: boolean;
  readonly mode: RunSummaryAiInput["mode"];
  readonly providerId?: string;
  readonly providerKind?: string;
  readonly protocolKind?: string;
  readonly model?: string;
  readonly status:
    | "disabled"
    | "not_requested"
    | "requested"
    | "completed"
    | "failed"
    | "configuration_failed";
  readonly eventCounts: {
    readonly requested: number;
    readonly completed: number;
    readonly failed: number;
  };
  readonly aiCandidateCount: number;
  readonly fallbackCount: number;
  readonly aiFallbackUsed: boolean;
  readonly rootletKinds: readonly {
    readonly kind: RootletClusterKind;
    readonly status: "requested" | "completed" | "failed";
    readonly requested: number;
    readonly completed: number;
    readonly failed: number;
    readonly aiCandidateCount: number;
    readonly fallbackCount: number;
    readonly aiFallbackUsed: boolean;
  }[];
  readonly modelCallRefs: readonly {
    readonly rootletKind?: RootletClusterKind;
    readonly requestId: string;
    readonly responseId?: string;
    readonly providerId?: string;
    readonly providerKind?: string;
    readonly protocolKind?: string;
    readonly model?: string;
    readonly outputKind?: string;
    readonly validationStatus?: string;
    readonly visibleOutput?: ModelVisibleOutputProjection;
    readonly rootletOutputRefs: readonly string[];
    readonly candidateRefs: readonly string[];
  }[];
  readonly configurationError?: {
    readonly code: string;
    readonly message: string;
  };
};

export type RunSummaryToolSummary = {
  readonly eventCounts: {
    readonly requested: number;
    readonly completed: number;
    readonly failed: number;
  };
  readonly toolCallRefs: readonly {
    readonly callId: string;
    readonly toolName?: string;
    readonly callerAgentId?: string;
    readonly status: "requested" | "completed" | "failed";
    readonly durationMs?: number;
    readonly eventRefs: readonly string[];
  }[];
};

export type RunConfigurationFailureSummary = {
  readonly ai: RunSummary["ai"];
};

export type RunSummaryPayload = RunSummary | RunConfigurationFailureSummary;
