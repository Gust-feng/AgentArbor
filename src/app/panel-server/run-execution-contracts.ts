import type {
  BasicAgentCapabilitySnapshot,
  ModelRunReasoningEffort,
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type { ModelOutputDelta } from "../../domain/intelligence/index.js";
import type { ToolConfirmationPolicy } from "../../domain/tools/index.js";
import type { EventLogEntry } from "../../kernel/events/in-memory-event-log.js";
import type { AgentRunTreeAttachment } from "../run-read-model/agent-run-tree-attachment.js";
import type { AgentDefinition } from "../agent-prompts/contracts.js";
import type { BasicAgentPendingToolContinuation } from "../basic-agent-runtime/index.js";
import type {
  DesktopAgentConversationMessage,
  DesktopAgentInterruptedRunContext,
  DesktopAgentSessionRuntimeContext,
} from "../desktop-agent/desktop-agent-session-contracts.js";
import type { PanelRunCanvasReadModel } from "../panel-read-model/canvas/panel-canvas-read-model.js";
import type { PanelObservationReadModel } from "../panel-run-read-model.js";
import type { PanelRunSummary } from "../panel-read-model/run/panel-run-summary.js";
import type { UndergroundDirectionSessionRuntimeContext } from "../underground/compat/underground-direction-session.js";
import type { AgentRunResources } from "./agent-run-resources.js";

export type PanelRunExecutionResult = {
  readonly completed?: true;
  readonly config?: SanitizedModelProviderConfig;
  readonly informationAccess?: SanitizedInformationAccessConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly agentDefinitionRef?: RunAgentDefinitionRef;
  readonly summary?: PanelRunSummary;
  readonly observation?: PanelObservationReadModel;
  readonly eventEntries: readonly EventLogEntry[];
  readonly agentRunTree?: AgentRunTreeAttachment;
  readonly canvas?: PanelRunCanvasReadModel;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly failed?: {
    readonly code: string;
    readonly message: string;
  };
  readonly blocked?: {
    readonly code: string;
    readonly message: string;
  };
  // paused 表示 out_of_fuel / context_overflow 等"可继续"停止语义，
  // 由 BasicAgentRunExecutor 统一转 blocked 终态。
  readonly paused?: {
    readonly code: string;
    readonly message: string;
  };
  readonly pendingApproval?: BasicAgentPendingToolContinuation;
};

export type PanelRunExecutionOptions = {
  readonly conversationHistory?: readonly DesktopAgentConversationMessage[];
  readonly interruptedRunContexts?: readonly DesktopAgentInterruptedRunContext[];
  readonly agentDefinition?: AgentDefinition;
  readonly agentDefinitionRef?: RunAgentDefinitionRef;
  readonly config?: SanitizedModelProviderConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly informationAccess?: SanitizedInformationAccessConfig;
  readonly reasoningEffort?: ModelRunReasoningEffort;
  readonly toolConfirmationPolicy?: ToolConfirmationPolicy;
  readonly abortSignal?: AbortSignal;
  readonly onRuntimeReady?: (context: PanelRuntimeReadyContext) => void;
  readonly onModelOutputDelta?: (delta: ModelOutputDelta) => void;
};

export type PanelRuntimeReadyContext =
  | UndergroundDirectionSessionRuntimeContext
  | DesktopAgentSessionRuntimeContext;

export type { AgentRunResources } from "./agent-run-resources.js";
