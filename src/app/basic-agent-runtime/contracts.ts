import type { BasicAgentRun } from "../../domain/basic-agent/index.js";
import type {
  BasicAgentCapabilitySnapshot,
  ModelRunReasoningEffort,
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type { ModelMessage, ModelOutputDelta } from "../../domain/intelligence/index.js";
import type { ObservationRef } from "../../domain/observation/index.js";
import type {
  ContextLedgerSkillFacts,
  ContextLedgerSkillLoadStatus,
  ContextLedgerSkillMarkUsedStatus,
} from "../../domain/basic-agent/index.js";
import type { ToolConfirmationPolicy, ToolErrorDomain } from "../../domain/tools/index.js";
import type { AgentRunTreeAttachment } from "../run-read-model/agent-run-tree-attachment.js";
import type { MinimalRuntime } from "../runtime.js";
import type { DesktopAgentConversationMessage } from "../desktop-agent/desktop-agent-contracts.js";
import type { ModelRuntimeMode } from "../model-runtime/index.js";
import type { RunSummary } from "../run-read-model/run-summary.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import type {
  BasicAgentCanvasProjection,
  BasicAgentRunJob,
  BasicAgentRunJobStore,
  BasicAgentRunKind,
  BasicAgentRunMode,
  BasicAgentRunStreamEvent,
} from "./run-job.js";

export type BasicAgentContextSourceKind =
  | "system"
  | "skill"
  | "conversation"
  | "conversation_summary"
  | "conversation_recent_turn"
  | "run_interruption"
  | "user_message"
  | "task_soil_ref"
  | "tool_evidence";

export type BasicAgentContextSkillFacts = Omit<
  ContextLedgerSkillFacts,
  "injectionStatus" | "loadStatus" | "markUsedStatus"
> & {
  readonly loadStatus: ContextLedgerSkillLoadStatus;
  readonly markUsedStatus?: ContextLedgerSkillMarkUsedStatus;
};

export type BasicAgentContextItem = {
  readonly itemId: string;
  readonly sourceKind: BasicAgentContextSourceKind;
  readonly role?: "user" | "assistant";
  readonly summary: string;
  readonly modelContent?: string;
  readonly refs: readonly ObservationRef[];
  readonly visibility: "model" | "diagnostic";
  readonly truncated: boolean;
  readonly skill?: BasicAgentContextSkillFacts;
};

export type BasicAgentContextBudget = {
  readonly maxMessages: number;
  readonly maxInputTokens: number;
  readonly usedInputTokens: number;
  readonly tokenCountSource: string;
  readonly maxChars: number;
  readonly usedChars: number;
  readonly inputTokenBudget?: number;
  readonly reservedOutputTokens?: number;
  readonly budgetSource: "default" | "model_capabilities" | "override";
};

export type BasicAgentContextTruncationReport = {
  readonly truncated: boolean;
  readonly omittedItemCount: number;
  readonly truncatedItemIds: readonly string[];
};

export type BasicAgentContextPack = {
  readonly messages: readonly ModelMessage[];
  readonly inputRefs: readonly ObservationRef[];
  readonly items: readonly BasicAgentContextItem[];
  readonly budget: BasicAgentContextBudget;
  readonly usageSummary: string;
  readonly truncationReport: BasicAgentContextTruncationReport;
  readonly truncated: boolean;
};

export type BasicAgentRuntimeReadyContext = {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
};

export type BasicAgentErrorDomain = ToolErrorDomain;

export type BasicAgentRunExecutionInput = {
  readonly job: BasicAgentRunJob;
  readonly conversationHistory?: readonly DesktopAgentConversationMessage[];
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
  readonly projectRunEvents?: (job: BasicAgentRunJob) => readonly BasicAgentRunStreamEvent[];
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
