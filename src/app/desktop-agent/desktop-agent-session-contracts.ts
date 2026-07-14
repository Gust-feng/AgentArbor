import type { BasicAgentCapabilitySnapshot, ModelCapabilities, RunCapabilityResolution } from "../../domain/config/index.js";
import type { IntelligenceChannel, ModelMessage, ModelOutputDelta } from "../../domain/intelligence/index.js";
import type { RuntimeOrdinaryModelContextRecord } from "../../domain/runtime-database/index.js";
import type { TaskSoil } from "../../domain/soil/index.js";
import type { ToolConfirmationPolicy, ToolExecutionBroker } from "../../domain/tools/index.js";
import type { SubAgentRootInput } from "../sub-agents/sub-agent-loader.js";
import type { AgentDefinition } from "../agent-prompts/contracts.js";
import type {
  DesktopAgentConversationMessage,
  DesktopAgentSkillContext,
} from "./desktop-agent-contracts.js";
import type {
  ModelRuntimeContextWindowExceededEvent,
  ModelRuntimeEnvironment,
  ModelRuntimeMode,
  ModelRuntimeProviderFetch,
} from "../model-runtime/index.js";
import type { BasicAgentRuntimeContext } from "../basic-agent-runtime/runtime-context.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";

export type DesktopAgentSessionStatus = "completed" | "confirmation_needed" | "stopped" | "failed" | "paused";

export type DesktopAgentStopReason = "out_of_fuel" | "context_overflow";

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
};

export type DesktopAgentSessionResult = {
  readonly status: DesktopAgentSessionStatus;
  readonly stopReason?: DesktopAgentStopReason;
  readonly runtime: BasicAgentRuntimeContext;
  readonly traceId: string;
  readonly goalId: string;
  readonly taskSoil: TaskSoil;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly answer?: DesktopAgentAnswer;
  readonly pendingConfirmation?: DesktopAgentPendingConfirmation;
  readonly modelContext?: RuntimeOrdinaryModelContextRecord;
  readonly failureMessage?: string;
  readonly modelCallRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
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
  readonly runtime: BasicAgentRuntimeContext;
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
  ((runtime: BasicAgentRuntimeContext, context?: DesktopAgentToolCenterContext) => ToolExecutionBroker) |
  ((runtime: BasicAgentRuntimeContext) => ToolExecutionBroker);

export type RunDesktopAgentSessionOptions = {
  readonly runId?: string;
  readonly aiMode?: ModelRuntimeMode;
  readonly agentDefinition?: AgentDefinition;
  readonly aiEnvironment?: ModelRuntimeEnvironment;
  readonly providerFetch?: ModelRuntimeProviderFetch;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly skillRoutingHistory?: readonly DesktopAgentConversationMessage[];
  readonly priorModelContext?: readonly ModelMessage[];
  readonly skillContexts?: readonly DesktopAgentSkillContext[];
  readonly resolveSkillContexts?: (context: DesktopAgentSkillResolverContext) => Promise<readonly DesktopAgentSkillContext[]>;
  readonly modelCapabilities?: ModelCapabilities;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly workspaceRoot?: string;
  readonly toolConfirmationPolicy?: ToolConfirmationPolicy;
  readonly platform?: NodeJS.Platform;
  readonly abortSignal?: AbortSignal;
  readonly runtime?: BasicAgentRuntimeContext;
  readonly createIntelligenceChannel?: (runtime: BasicAgentRuntimeContext) => IntelligenceChannel;
  readonly createToolCenter?: DesktopAgentToolCenterFactory;
  readonly subAgentRoots?: readonly SubAgentRootInput[];
  readonly onRuntimeReady?: (context: DesktopAgentSessionRuntimeContext) => void;
  readonly onModelOutputDelta?: (delta: ModelOutputDelta) => void;
  readonly onContextWindowExceeded?: (event: ModelRuntimeContextWindowExceededEvent) => void | Promise<void>;
};

export type { DesktopAgentConversationMessage, DesktopAgentSkillContext } from "./desktop-agent-contracts.js";
