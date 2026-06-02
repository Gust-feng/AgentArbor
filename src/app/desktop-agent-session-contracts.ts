import type { BasicAgentCapabilitySnapshot, ModelCapabilities } from "../domain/config/index.js";
import type { IntelligenceChannel, ModelOutputDelta } from "../domain/intelligence/index.js";
import type { TaskSoil } from "../domain/soil/index.js";
import type { ToolExecutionBroker } from "../domain/tools/index.js";
import type { BasicAgentContextPack } from "./basic-agent-runtime/context-pack.js";
import type { DesktopAgentConversationMessage, DesktopAgentSkillContext } from "./desktop-agent-contracts.js";
import type {
  ModelRuntimeEnvironment,
  ModelRuntimeMode,
  ModelRuntimeProviderFetch,
} from "./model-runtime/index.js";
import type { MinimalRuntime } from "./runtime.js";
import type { DesktopTaskSoilInput } from "./task-soil-workspace.js";

export type DesktopAgentSessionStatus = "completed" | "confirmation_needed" | "stopped" | "failed" | "paused";

export type DesktopAgentActivity = {
  readonly activityId: string;
  readonly type:
    | "task_received"
    | "model_requested"
    | "model_completed"
    | "model_failed"
    | "tool_requested"
    | "tool_completed"
    | "tool_failed"
    | "confirmation_needed"
    | "completed"
    | "stopped"
    | "failed";
  readonly title: string;
  readonly summary: string;
  readonly status: "pending" | "running" | "completed" | "failed";
  readonly createdAt: string;
  readonly action?: string;
  readonly path?: string;
  readonly truncated?: boolean;
  readonly error?: string;
  readonly toolName?: string;
  readonly sourceRefs: readonly string[];
  readonly modelCallRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
};

export type DesktopAgentResultBlock = {
  readonly blockId: string;
  readonly kind: "answer" | "tool_summary" | "pending_confirmation" | "failure";
  readonly title: string;
  readonly summary: string;
  readonly evidenceRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
};

export type DesktopAgentPendingConfirmation = {
  readonly confirmationId: string;
  readonly title: string;
  readonly question: string;
  readonly consequence: string;
  readonly riskLevel: "low" | "medium" | "high";
  readonly requestedAt: string;
  readonly modelCallRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
  readonly sourceRefs: readonly string[];
};

export type DesktopAgentAnswer = {
  readonly answer: string;
  readonly modelCallRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly resultBlocks: readonly DesktopAgentResultBlock[];
};

export type DesktopAgentSessionResult = {
  readonly status: DesktopAgentSessionStatus;
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly taskSoil: TaskSoil;
  readonly answer?: DesktopAgentAnswer;
  readonly pendingConfirmation?: DesktopAgentPendingConfirmation;
  readonly contextPack?: Pick<BasicAgentContextPack, "usageSummary" | "items" | "budget" | "truncationReport" | "truncated">;
  readonly failureMessage?: string;
  readonly modelCallRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
  readonly activity: readonly DesktopAgentActivity[];
  readonly eventTypes: readonly string[];
  readonly pendingApproval?: DesktopAgentPendingApprovalContinuation;
};

export type DesktopAgentPendingApprovalContinuation = {
  readonly confirmationId: string;
  resume(input: {
    readonly approvedConfirmationIds: readonly string[];
    readonly abortSignal?: AbortSignal;
  }): Promise<DesktopAgentSessionResult>;
};

export type DesktopAgentSessionRuntimeContext = {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
};

export type RunDesktopAgentSessionOptions = {
  readonly aiMode?: ModelRuntimeMode;
  readonly aiEnvironment?: ModelRuntimeEnvironment;
  readonly providerFetch?: ModelRuntimeProviderFetch;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly conversationHistory?: readonly DesktopAgentConversationMessage[];
  readonly skillContexts?: readonly DesktopAgentSkillContext[];
  readonly modelCapabilities?: ModelCapabilities;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly allowedTools?: readonly string[];
  readonly platform?: NodeJS.Platform;
  readonly abortSignal?: AbortSignal;
  readonly runtime?: MinimalRuntime;
  readonly createIntelligenceChannel?: (runtime: MinimalRuntime) => IntelligenceChannel;
  readonly createToolCenter?: (runtime: MinimalRuntime) => ToolExecutionBroker;
  readonly onRuntimeReady?: (context: DesktopAgentSessionRuntimeContext) => void;
  readonly onModelOutputDelta?: (delta: ModelOutputDelta) => void;
  /**
   * Legacy compatibility only. Ordinary Desktop Agent no longer requests a
   * work-session upgrade; explicit deep mode owns Underground organization.
   */
  readonly allowWorkSessionUpgrade?: boolean;
};

export type { DesktopAgentConversationMessage, DesktopAgentSkillContext } from "./desktop-agent-contracts.js";
