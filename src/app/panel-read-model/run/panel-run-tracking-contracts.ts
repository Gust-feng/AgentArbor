import type { SanitizedInformationAccessConfig, SanitizedModelProviderConfig } from "../../../domain/config/index.js";
import type { RunObservationEventView, RunObservationSnapshot } from "../../../domain/observation/index.js";
import type { CandidatePoolCounts, RootletClusterKind } from "../../../domain/underground/index.js";
import type { ModelRuntimeMode } from "../../model-runtime/index.js";
import type { PanelRunSummary } from "../../panel-run-summary.js";
import type { PanelRunStatus } from "./panel-run-status.js";

export type PanelObservationReadModel = Pick<
  RunObservationSnapshot,
  "traceId" | "goalId" | "currentPhase" | "currentStage" | "eventCursor" | "events" | "underground" | "handoff" | "aboveground"
>;

export type PanelRunTraceReadModel = {
  readonly status: PanelRunStatus;
  readonly currentPhase: RunObservationSnapshot["currentPhase"];
  readonly currentStage: RunObservationSnapshot["currentStage"];
  readonly eventCursor: RunObservationSnapshot["eventCursor"];
  readonly waitingPoint: string;
  readonly events: readonly RunObservationEventView[];
};

export type PanelRunTrackingReadModel = {
  readonly run: {
    readonly status: PanelRunStatus;
    readonly phase: RunObservationSnapshot["currentPhase"];
    readonly stage: RunObservationSnapshot["currentStage"];
    readonly eventCount: number;
    readonly lastEventType?: string;
    readonly waitingPoint: string;
    readonly abovegroundStatus: RunObservationSnapshot["aboveground"]["status"];
  };
  readonly provider: {
    readonly requestedMode: ModelRuntimeMode;
    readonly defaultAiMode: SanitizedModelProviderConfig["defaultAiMode"];
    readonly providerKind: SanitizedModelProviderConfig["providerKind"];
    readonly protocolKind: SanitizedModelProviderConfig["protocolKind"];
    readonly baseUrl: string;
    readonly model?: string;
    readonly secretConfigured: boolean;
    readonly status:
      | "network_disabled"
      | "fake_provider"
      | "ready"
      | "missing_model"
      | "missing_secret"
      | "missing_model_and_secret";
  };
  readonly informationSources: {
    readonly sourcePreference: SanitizedInformationAccessConfig["sourcePreference"];
    readonly web: {
      readonly provider: SanitizedInformationAccessConfig["web"]["provider"];
      readonly providerKind: SanitizedInformationAccessConfig["web"]["providerKind"];
      readonly maxResults: number;
      readonly secretConfigured: boolean;
      readonly status: "ready" | "no-provider" | "disabled";
    };
    readonly stubs: SanitizedInformationAccessConfig["stubs"];
  };
  readonly rootletsByKind: Readonly<Record<RootletClusterKind, PanelRootletTrackingReadModel>>;
  readonly modelTotals: {
    readonly requested: number;
    readonly completed: number;
    readonly failed: number;
  };
  readonly toolTotals: {
    readonly requested: number;
    readonly completed: number;
    readonly failed: number;
  };
  readonly context: {
    readonly compaction: {
      readonly completed: number;
      readonly failed: number;
      readonly latest?: {
        readonly status: "completed" | "failed";
        readonly tokenCount?: number;
        readonly threshold?: number;
        readonly coveredRefCount?: number;
        readonly summary?: string;
      };
    };
  };
  readonly candidates: {
    readonly total: CandidatePoolCounts;
    readonly byKind: Readonly<Record<RootletClusterKind, CandidatePoolCounts>>;
  };
  readonly aiCandidates: {
    readonly total: number;
    readonly fallbackTotal: number;
    readonly fallbackUsed: boolean;
  };
  readonly autonomy: {
    readonly enabled: boolean;
    readonly cycleCount: number;
    readonly latestAction?: string;
    readonly latestDecisionStatus?: "completed" | "failed";
    readonly spawnedRootletCount: number;
    readonly stopReason?: string;
    readonly sourceRefs: readonly string[];
    readonly modelCallRefs: readonly string[];
  };
  readonly agentRunTree?: NonNullable<PanelObservationReadModel["underground"]["agentRunTree"]>;
  readonly convergence?: PanelRunSummary["underground"]["convergence"];
  readonly package?: {
    readonly id: string;
    readonly version: number;
    readonly status: string;
    readonly validationPassed: boolean;
    readonly validationErrorCount: number;
    readonly validationWarningCount: number;
  };
};

export type PanelRootletTrackingReadModel = {
  readonly kind: RootletClusterKind;
  readonly clusterStatus: string;
  readonly invocationStatus?: string;
  readonly outputCount: number;
  readonly model: {
    readonly status: "not_requested" | "requested" | "completed" | "failed";
    readonly requested: number;
    readonly completed: number;
    readonly failed: number;
  };
  readonly candidates: CandidatePoolCounts;
  readonly aiCandidateCount: number;
  readonly fallbackCount: number;
  readonly aiFallbackUsed: boolean;
};
