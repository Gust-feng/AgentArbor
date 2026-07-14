import type { BasicAgentRun } from "../../domain/basic-agent/index.js";
import type {
  BasicAgentCapabilitySnapshot,
  ModelRunReasoningEffort,
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type { ModelOutputDelta } from "../../domain/intelligence/index.js";
import type { RuntimeOrdinaryModelContextRecord } from "../../domain/runtime-database/index.js";
import type { ToolConfirmationPolicy, ToolErrorDomain } from "../../domain/tools/index.js";
import type { AgentRunTreeAttachment } from "../run-read-model/agent-run-tree-attachment.js";
import type { BasicAgentRuntimeContext } from "./runtime-context.js";
import type { ModelRuntimeMode } from "../model-runtime/index.js";
import type { RunSummary } from "../run-read-model/run-summary.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import type {
  BasicAgentCanvasProjection,
  BasicAgentOrdinaryRunFacts,
  BasicAgentRunJob,
  BasicAgentRunJobStore,
  BasicAgentRunKind,
  BasicAgentRunMode,
  BasicAgentRunStreamEvent,
} from "./run-job.js";

export type BasicAgentRuntimeReadyContext = {
  readonly runtime: BasicAgentRuntimeContext;
  readonly traceId: string;
  readonly goalId: string;
};

export type BasicAgentErrorDomain = ToolErrorDomain;

export type BasicAgentRunExecutionInput = {
  readonly job: BasicAgentRunJob;
  readonly abortSignal: AbortSignal;
  readonly onRuntimeReady: (context: BasicAgentRuntimeReadyContext) => void;
  readonly onModelOutputDelta: (delta: ModelOutputDelta) => void;
};

export type BasicAgentRunExecutionResult = {
  readonly completed?: true;
  readonly config?: SanitizedModelProviderConfig;
  readonly informationAccess?: SanitizedInformationAccessConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly summary?: RunSummary;
  readonly observation?: unknown;
  readonly agentRunTree?: AgentRunTreeAttachment;
  readonly canvas?: BasicAgentCanvasProjection;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly ordinary?: BasicAgentOrdinaryRunFacts;
  readonly ordinaryModelContext?: RuntimeOrdinaryModelContextRecord;
  readonly failed?: {
    readonly code: string;
    readonly message: string;
    readonly errorDomain?: BasicAgentErrorDomain;
  };
  readonly blocked?: {
    readonly code: string;
    readonly message: string;
    readonly errorDomain?: BasicAgentErrorDomain;
  };
  // paused 表示 out_of_fuel / context_overflow 等"可继续"停止语义。
  // BasicAgentRunExecutor 统一将其转为 blocked 终态（reason.code 保留停止原因），
  // 使契约层显式识别 paused，不依赖上游 adapter 自行转 blocked。
  readonly paused?: {
    readonly code: string;
    readonly message: string;
    readonly errorDomain?: BasicAgentErrorDomain;
  };
  readonly pendingApproval?: BasicAgentPendingToolContinuation;
};

export type BasicAgentPendingToolContinuation = {
  readonly confirmationId: string;
  /** Releases the runtime resources retained while approval is pending. Must be idempotent. */
  release(): Promise<void>;
  resume(input: {
    readonly approvedConfirmationIds: readonly string[];
    readonly abortSignal: AbortSignal;
  }): Promise<BasicAgentRunExecutionResult>;
  resumeWithDecision(input: {
    readonly decision: "deny" | "guidance";
    readonly guidance?: string;
    readonly abortSignal: AbortSignal;
  }): Promise<BasicAgentRunExecutionResult>;
};

export interface BasicAgentExecutionAdapter {
  execute(input: BasicAgentRunExecutionInput): Promise<BasicAgentRunExecutionResult>;
}

export type BasicAgentRunExecutorConfig = {
  readonly prepareRunStart: (input: BasicAgentRunStartInput) => Promise<BasicAgentRunStartFacts>;
  readonly runJobs: BasicAgentRunJobStore;
  readonly activeRunJobs: Set<Promise<void>>;
  readonly abortControllers: Map<string, AbortController>;
  readonly persistRun: (job: BasicAgentRunJob) => Promise<void>;
  readonly persistRunInBackground?: (job: BasicAgentRunJob) => void;
  readonly cleanupRunResources?: (runId: string, context?: BasicAgentRunResourceCleanupContext) => Promise<unknown> | unknown;
  readonly inspectRunResources?: (runId: string, context: BasicAgentRunResourceInspectionContext) => Promise<unknown> | unknown;
  readonly executionAdapter: BasicAgentExecutionAdapter;
  /** Projects newly available runtime facts after a write-side state change. */
  readonly projectRunEvents?: (job: BasicAgentRunJob) => void;
  /** Selects the stable transport events exposed through replay and persistence. */
  readonly runEventsForReplay?: (job: BasicAgentRunJob) => readonly BasicAgentRunStreamEvent[];
  readonly failRun: (job: BasicAgentRunJob, error: unknown) => Promise<void>;
  readonly onRuntimeReady: (runId: string, context: BasicAgentRuntimeReadyContext) => void;
  readonly onModelOutputDelta: (runId: string, delta: ModelOutputDelta) => void;
  readonly onRunFinished: (job: BasicAgentRunJob) => Promise<void> | void;
};

export type BasicAgentRunResourceCleanupContext = {
  readonly reason: "cancel";
  readonly terminalStatus: "cancelled";
};

export type BasicAgentRunResourceInspectionContext = {
  readonly terminalStatus: "completed" | "failed" | "blocked" | "cancelled";
};

export type BasicAgentRunStartFacts = {
  readonly aiMode: ModelRuntimeMode;
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly agentDefinitionRef?: RunAgentDefinitionRef;
  readonly toolConfirmationPolicy?: ToolConfirmationPolicy;
};

export type BasicAgentRunStartInput = {
  readonly runKind: BasicAgentRunKind;
  readonly runMode?: BasicAgentRunMode;
  readonly goal: string;
  readonly aiMode?: ModelRuntimeMode;
  readonly conversationId?: string;
  readonly assistantTurnId?: string;
  readonly runAfterRunId?: string;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly workspaceDirectory?: string;
  readonly reasoningEffort?: ModelRunReasoningEffort;
  readonly toolConfirmationPolicy?: ToolConfirmationPolicy;
  readonly modelOverride?: {
    readonly profileId: string;
    readonly model: string;
  };
  readonly startImmediately?: boolean;
  readonly deferSchedule?: boolean;
  /**
   * Lets a caller finish durable run-birth side effects, such as attaching the
   * run to a conversation turn, before the first persistence snapshot is queued.
   */
  readonly deferInitialPersistence?: boolean;
};

/** User/API request shape for the ordinary Desktop Agent run birth path. */
export type DesktopAgentRunSpec = Omit<BasicAgentRunStartInput, "runKind" | "runMode"> & {
  readonly runKind: "desktop";
  readonly runMode?: "agent";
};

/** Facts frozen when an ordinary Desktop Agent run is created. */
export type DesktopAgentRunBirthFacts = BasicAgentRunStartFacts & {
  readonly capabilitySnapshot: BasicAgentCapabilitySnapshot;
  readonly agentDefinitionRef: RunAgentDefinitionRef;
};

/** Execution input for an already-created ordinary Desktop Agent run. */
export type DesktopAgentRunExecutionInput = BasicAgentRunExecutionInput & {
  readonly job: BasicAgentRunJob & {
    readonly runKind: "desktop";
    readonly runMode: "agent";
    readonly capabilitySnapshot: BasicAgentCapabilitySnapshot;
    readonly agentDefinitionRef: RunAgentDefinitionRef;
  };
};

/**
 * Transitional ordinary Desktop Agent execution result. Phase 2 keeps this
 * assignment-compatible with BasicAgentRunExecutionResult until panel
 * projection fields can be split without breaking persisted/read-model code.
 */
export type DesktopAgentRunExecutionResult = BasicAgentRunExecutionResult;

export type BasicAgentRunExecutorView = {
  start(input: BasicAgentRunStartInput): Promise<BasicAgentRun>;
  get(runId: string): BasicAgentRun | undefined;
};
