import type { BasicAgentCapabilitySnapshot, ModelCapabilities, RunCapabilityResolution } from "../domain/config/index.js";
import type { IntelligenceChannel, ModelOutputDelta } from "../domain/intelligence/index.js";
import type { TaskSoil } from "../domain/soil/index.js";
import type { ToolConfirmationPolicy, ToolExecutionBroker, ToolResultEnvelope } from "../domain/tools/index.js";
import type { SubAgentRootInput } from "./sub-agents/sub-agent-loader.js";
import type { AgentDefinition } from "./agent-prompts/contracts.js";
import type { BasicAgentConversationSummary } from "./basic-agent-runtime/conversation-compaction-contracts.js";
import type { BasicAgentContextPack } from "./basic-agent-runtime/context-pack.js";
import type {
  DesktopAgentConversationMessage,
  DesktopAgentInterruptedRunContext,
  DesktopAgentSkillContext,
} from "./desktop-agent-contracts.js";
import type {
  ModelRuntimeContextWindowExceededEvent,
  ModelRuntimeEnvironment,
  ModelRuntimeMode,
  ModelRuntimeProviderFetch,
} from "./model-runtime/index.js";
import type { MinimalRuntime } from "./runtime.js";
import type { DesktopTaskSoilInput } from "./task-soil-workspace.js";

export type DesktopAgentSessionStatus = "completed" | "confirmation_needed" | "stopped" | "failed" | "paused";

export type DesktopAgentStopReason = "out_of_fuel" | "context_overflow";

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
  readonly affectedResources: readonly string[];
  readonly riskLevel: "low" | "medium" | "high";
  readonly resumeAvailability?: "live" | "lost_after_restart";
  readonly requestedAt: string;
  readonly expiresAt?: string;
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
  readonly stopReason?: DesktopAgentStopReason;
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly taskSoil: TaskSoil;
  readonly capabilityResolution?: RunCapabilityResolution;
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
  resumeWithDecision(input: {
    readonly decision: "deny" | "guidance";
    readonly guidance?: string;
    readonly abortSignal?: AbortSignal;
  }): Promise<DesktopAgentSessionResult>;
};

export type DesktopAgentSessionRuntimeContext = {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
};

export type DesktopAgentSkillResolverContext = DesktopAgentSessionRuntimeContext & {
  readonly goal: string;
  readonly conversationHistory: readonly DesktopAgentConversationMessage[];
  readonly intelligenceChannel: IntelligenceChannel;
  readonly abortSignal?: AbortSignal;
};

export type DesktopAgentToolCenterContext = DesktopAgentSessionRuntimeContext & {
  readonly skillContexts: readonly DesktopAgentSkillContext[];
  readonly taskSoil: TaskSoil;
};

export type DesktopAgentToolCenterFactory =
  ((runtime: MinimalRuntime, context?: DesktopAgentToolCenterContext) => ToolExecutionBroker) |
  ((runtime: MinimalRuntime) => ToolExecutionBroker);

export type RunDesktopAgentSessionOptions = {
  readonly aiMode?: ModelRuntimeMode;
  readonly agentDefinition?: AgentDefinition;
  readonly aiEnvironment?: ModelRuntimeEnvironment;
  readonly providerFetch?: ModelRuntimeProviderFetch;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly conversationHistory?: readonly DesktopAgentConversationMessage[];
  readonly conversationSummary?: BasicAgentConversationSummary;
  readonly interruptedRunContexts?: readonly DesktopAgentInterruptedRunContext[];
  readonly skillContexts?: readonly DesktopAgentSkillContext[];
  readonly toolEvidence?: readonly ToolResultEnvelope[];
  readonly resolveSkillContexts?: (context: DesktopAgentSkillResolverContext) => Promise<readonly DesktopAgentSkillContext[]>;
  readonly modelCapabilities?: ModelCapabilities;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly workspaceRoot?: string;
  readonly toolConfirmationPolicy?: ToolConfirmationPolicy;
  readonly platform?: NodeJS.Platform;
  readonly abortSignal?: AbortSignal;
  readonly runtime?: MinimalRuntime;
  readonly createIntelligenceChannel?: (runtime: MinimalRuntime) => IntelligenceChannel;
  readonly createToolCenter?: DesktopAgentToolCenterFactory;
  readonly subAgentRoots?: readonly SubAgentRootInput[];
  readonly onRuntimeReady?: (context: DesktopAgentSessionRuntimeContext) => void;
  readonly onModelOutputDelta?: (delta: ModelOutputDelta) => void;
  readonly onContextWindowExceeded?: (event: ModelRuntimeContextWindowExceededEvent) => void | Promise<void>;
};

export type { DesktopAgentConversationMessage, DesktopAgentSkillContext } from "./desktop-agent-contracts.js";
export type { DesktopAgentInterruptedRunContext } from "./desktop-agent-contracts.js";
