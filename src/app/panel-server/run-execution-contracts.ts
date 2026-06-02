import type { BasicAgentCapabilitySnapshot, ModelRunReasoningEffort, ToolStateSettings } from "../../domain/config/index.js";
import type { ModelOutputDelta } from "../../domain/intelligence/index.js";
import type { AgentRunTree } from "../../domain/underground/index.js";
import type { EventLogEntry } from "../../kernel/events/in-memory-event-log.js";
import type { BasicAgentPendingToolContinuation } from "../basic-agent-runtime/index.js";
import type { DesktopAgentConversationMessage, DesktopAgentSessionRuntimeContext } from "../desktop-agent-session-contracts.js";
import type { PanelRunCanvasReadModel } from "../panel-canvas-read-model.js";
import type { PanelObservationReadModel } from "../panel-run-read-model.js";
import type { ModelRuntimeConfig } from "../model-runtime/index.js";
import type { UndergroundDemoSummary } from "../underground-demo-summary.js";
import type { UndergroundDirectionSessionRuntimeContext } from "../underground-direction-session.js";
import type { PanelRuntime } from "./runtime.js";

export type PanelRunExecutionResult = {
  readonly summary?: UndergroundDemoSummary;
  readonly observation?: PanelObservationReadModel;
  readonly eventEntries: readonly EventLogEntry[];
  readonly agentRunTree?: AgentRunTree;
  readonly canvas?: PanelRunCanvasReadModel;
  readonly blocked?: {
    readonly code: string;
    readonly message: string;
  };
  readonly pendingApproval?: BasicAgentPendingToolContinuation;
};

export type PanelRunExecutionOptions = {
  readonly conversationHistory?: readonly DesktopAgentConversationMessage[];
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
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
  readonly aiEnvironment: Awaited<ReturnType<PanelRuntime["configCenter"]["createUndergroundAiEnvironment"]>>;
  readonly aiConfig: Extract<ModelRuntimeConfig, { readonly enabled: true }>;
  readonly workspaceRoot: string;
  readonly toolStates: readonly ToolStateSettings[];
  readonly playwrightAvailable: boolean;
};
