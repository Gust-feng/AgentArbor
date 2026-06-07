import type {
  BasicAgentCapabilitySnapshot,
  ModelRunReasoningEffort,
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
  ToolStateSettings,
} from "../../domain/config/index.js";
import type { ModelOutputDelta } from "../../domain/intelligence/index.js";
import type { EventLogEntry } from "../../kernel/events/in-memory-event-log.js";
import type { AgentRunTreeAttachment } from "../agent-run-tree-attachment.js";
import type { AgentDefinition } from "../agent-prompts/contracts.js";
import type { BasicAgentPendingToolContinuation } from "../basic-agent-runtime/index.js";
import type { DesktopAgentConversationMessage, DesktopAgentSessionRuntimeContext } from "../desktop-agent-session-contracts.js";
import type { PanelRunCanvasReadModel } from "../panel-canvas-read-model.js";
import type { PanelObservationReadModel } from "../panel-run-read-model.js";
import type { PanelRunSummary } from "../panel-run-summary.js";
import type { ModelRuntimeConfig } from "../model-runtime/index.js";
import type { UndergroundDirectionSessionRuntimeContext } from "../underground-direction-session.js";
import type { PanelRuntime } from "./runtime.js";

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
  readonly pendingApproval?: BasicAgentPendingToolContinuation;
};

export type PanelRunExecutionOptions = {
  readonly conversationHistory?: readonly DesktopAgentConversationMessage[];
  readonly agentDefinition?: AgentDefinition;
  readonly agentDefinitionRef?: RunAgentDefinitionRef;
  readonly config?: SanitizedModelProviderConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly informationAccess?: SanitizedInformationAccessConfig;
  readonly reasoningEffort?: ModelRunReasoningEffort;
  readonly abortSignal?: AbortSignal;
  readonly onRuntimeReady?: (context: PanelRuntimeReadyContext) => void;
  readonly onModelOutputDelta?: (delta: ModelOutputDelta) => void;
};

export type PanelRuntimeReadyContext =
  | UndergroundDirectionSessionRuntimeContext
  | DesktopAgentSessionRuntimeContext;

export type DesktopRunResources = {
  readonly capabilitySnapshot: Awaited<ReturnType<PanelRuntime["capabilityCenter"]["snapshot"]>>;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly aiEnvironment: Awaited<ReturnType<PanelRuntime["configCenter"]["createModelRuntimeEnvironment"]>>;
  readonly aiConfig: Extract<ModelRuntimeConfig, { readonly enabled: true }>;
  readonly workspaceRoot: string;
  readonly toolStates: readonly ToolStateSettings[];
  readonly toolCatalogNames: readonly string[];
  readonly playwrightAvailable: boolean;
};
