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
import type { AgentRunTreeAttachment } from "../agent-run-tree-attachment.js";
import type { MinimalRuntime } from "../runtime.js";
import type { DesktopAgentConversationMessage } from "../desktop-agent-contracts.js";
import type { ModelRuntimeMode } from "../model-runtime/index.js";
import type { RunSummary } from "../run-summary.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import type { BasicAgentCanvasProjection, BasicAgentRunJob, BasicAgentRunJobStore, BasicAgentRunKind, BasicAgentRunMode } from "./run-job.js";

export type BasicAgentContextSourceKind =
  | "system"
  | "skill"
  | "conversation"
  | "conversation_summary"
  | "conversation_recent_turn"
  | "user_message"
  | "task_soil_ref"
  | "tool_evidence";

export type BasicAgentContextItem = {
  readonly itemId: string;
  readonly sourceKind: BasicAgentContextSourceKind;
  readonly role?: "user" | "assistant";
  readonly summary: string;
  readonly refs: readonly ObservationRef[];
  readonly visibility: "model" | "diagnostic";
  readonly truncated: boolean;
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
  readonly agentDefinitionRef?: RunAgentDefinitionRef;
  readonly summary?: RunSummary;
  readonly observation?: unknown;
  readonly agentRunTree?: AgentRunTreeAttachment;
  readonly canvas?: BasicAgentCanvasProjection;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly failed?: {
    readonly code: string;
    readonly message: string;
  };
  readonly blocked?: {
    readonly code: string;
    readonly message: string;
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
  readonly executionAdapter: BasicAgentExecutionAdapter;
  readonly failRun: (job: BasicAgentRunJob, error: unknown) => Promise<void>;
  readonly onRuntimeReady: (runId: string, context: BasicAgentRuntimeReadyContext) => void;
  readonly onModelOutputDelta: (runId: string, delta: ModelOutputDelta) => void;
  readonly onRunFinished: (job: BasicAgentRunJob) => Promise<void> | void;
};

export type BasicAgentRunStartFacts = {
  readonly aiMode: ModelRuntimeMode;
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly agentDefinitionRef?: RunAgentDefinitionRef;
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
  readonly reasoningEffort?: ModelRunReasoningEffort;
  readonly startImmediately?: boolean;
  readonly deferSchedule?: boolean;
};

export type BasicAgentRunExecutorView = {
  start(input: BasicAgentRunStartInput): Promise<BasicAgentRun>;
  get(runId: string): BasicAgentRun | undefined;
};
