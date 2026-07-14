import type {
  BasicAgentCapabilitySnapshot,
  ModelRunReasoningEffort,
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type { ConfirmationDecision } from "../../domain/basic-agent/index.js";
import type { RuntimeOrdinaryModelContextRecord } from "../../domain/runtime-database/index.js";
import type { AgentRunTreeAttachment } from "../run-read-model/agent-run-tree-attachment.js";
import type { ToolConfirmationPolicy } from "../../domain/tools/index.js";
import type { ModelRuntimeMode } from "../model-runtime/index.js";
import type { RunConfigurationFailureSummary, RunSummary } from "../run-read-model/run-summary.js";
import type { BasicAgentRuntimeContext } from "./runtime-context.js";
import { resolveRunModeForKind } from "../run-runtime-core/run-mode-policy.js";
import type { AgentArborRunKind, AgentArborRunMode } from "../run-runtime-core/run-mode-policy.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import type {
  BasicAgentCompatRunStatus,
  BasicAgentRunProjectionInput,
  BasicAgentRunStreamEventProjectionInput,
} from "./run-projection.js";

export type BasicAgentOrdinaryRunFacts = {
  readonly answer?: {
    readonly content: string;
    readonly modelCallRefs: readonly string[];
    readonly toolCallRefs: readonly string[];
    readonly evidenceRefs: readonly string[];
  };
  readonly pendingConfirmation?: {
    readonly confirmationId: string;
    readonly title: string;
    readonly actionSummary: string;
    readonly consequence?: string;
    readonly affectedResources: readonly string[];
    readonly riskLevel: "low" | "medium" | "high";
    readonly resumeAvailability?: "live" | "lost_after_restart";
    readonly requestedAt: string;
    readonly expiresAt?: string;
    readonly sourceRefs: readonly string[];
  };
};

export type BasicAgentRunKind = AgentArborRunKind;

export type BasicAgentRunMode = AgentArborRunMode;

export type BasicAgentRunStatus = BasicAgentCompatRunStatus;

export type BasicAgentRunStreamEvent = BasicAgentRunStreamEventProjectionInput;

export type BasicAgentCanvasProjection = {
  readonly kind?: string;
  readonly agent?: {
    readonly pendingConfirmation?: unknown;
  };
};

export type BasicAgentRunCompletedPayload = {
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly summary?: RunSummary;
  readonly observation?: unknown;
  readonly agentRunTree?: AgentRunTreeAttachment;
  readonly canvas?: BasicAgentCanvasProjection;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly ordinary?: BasicAgentOrdinaryRunFacts;
  readonly ordinaryModelContext?: RuntimeOrdinaryModelContextRecord;
};

export type BasicAgentRunFailedPayload = {
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly canvas?: BasicAgentCanvasProjection;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
  readonly summary?: RunConfigurationFailureSummary;
  readonly ordinary?: BasicAgentOrdinaryRunFacts;
  readonly ordinaryModelContext?: RuntimeOrdinaryModelContextRecord;
};

export type BasicAgentRunTerminalPayload = {
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly reason: {
    readonly code: string;
    readonly message: string;
  };
  readonly summary?: RunSummary;
  readonly observation?: unknown;
  readonly agentRunTree?: AgentRunTreeAttachment;
  readonly canvas?: BasicAgentCanvasProjection;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly ordinary?: BasicAgentOrdinaryRunFacts;
  readonly ordinaryModelContext?: RuntimeOrdinaryModelContextRecord;
};

export type BasicAgentRunConfirmationDecisionRecord = ConfirmationDecision;

export type BasicAgentRunJob = BasicAgentRunProjectionInput & {
  readonly runKind: BasicAgentRunKind;
  readonly aiMode: ModelRuntimeMode;
  readonly assistantTurnId?: string;
  readonly runAfterRunId?: string;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly reasoningEffort?: ModelRunReasoningEffort;
  readonly toolConfirmationPolicy?: ToolConfirmationPolicy;
  readonly agentDefinitionRef?: RunAgentDefinitionRef;
  config: SanitizedModelProviderConfig;
  informationAccess: SanitizedInformationAccessConfig;
  capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  capabilityResolution?: RunCapabilityResolution;
  runtime?: BasicAgentRuntimeContext;
  traceId?: string;
  goalId?: string;
  completed?: BasicAgentRunCompletedPayload;
  failed?: BasicAgentRunFailedPayload;
  cancelled?: BasicAgentRunTerminalPayload;
  blocked?: BasicAgentRunTerminalPayload;
  confirmationDecisions: readonly BasicAgentRunConfirmationDecisionRecord[];
};

export type BasicAgentRunJobCreateInput = {
  readonly runKind: BasicAgentRunKind;
  readonly runMode?: BasicAgentRunMode;
  readonly goal: string;
  readonly aiMode: ModelRuntimeMode;
  readonly conversationId?: string;
  readonly assistantTurnId?: string;
  readonly runAfterRunId?: string;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly reasoningEffort?: ModelRunReasoningEffort;
  readonly toolConfirmationPolicy?: ToolConfirmationPolicy;
  readonly agentDefinitionRef?: RunAgentDefinitionRef;
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
};

export type BasicAgentRunJobStore = {
  create(input: BasicAgentRunJobCreateInput): BasicAgentRunJob;
  get(runId: string): BasicAgentRunJob | undefined;
  markRunning(runId: string): void;
  markResuming(runId: string): void;
  awaitApproval(runId: string, completed: BasicAgentRunCompletedPayload): void;
  markNeedsInput(runId: string): void;
  complete(runId: string, completed: BasicAgentRunCompletedPayload): void;
  fail(runId: string, failed: BasicAgentRunFailedPayload): void;
  cancel(runId: string, cancelled: BasicAgentRunTerminalPayload): void;
  block(runId: string, blocked: BasicAgentRunTerminalPayload): void;
  recordConfirmationDecision(decision: BasicAgentRunConfirmationDecisionRecord): void;
  recordRunResumed(runId: string, input: {
    readonly confirmationId: string;
    readonly resumedAt: string;
  }): void;
};

export function resolveBasicAgentRunMode(
  runKind: BasicAgentRunKind,
  runMode: BasicAgentRunMode | undefined
): BasicAgentRunMode {
  return resolveRunModeForKind(runKind, runMode);
}
