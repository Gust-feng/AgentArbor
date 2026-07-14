import type { ConfirmationDecision } from "../../domain/basic-agent/index.js";
import type { RuntimeOrdinaryModelContextRecord } from "../../domain/runtime-database/index.js";
import type {
  BasicAgentCapabilitySnapshot,
  ModelRunReasoningEffort,
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type { ToolConfirmationPolicy } from "../../domain/tools/index.js";
import { InMemoryBasicAgentRunJobStore } from "../basic-agent-runtime/run-job-store.js";
import type { ModelRuntimeMode } from "../model-runtime/index.js";
import type { PanelRunCanvasReadModel } from "../panel-read-model/canvas/panel-canvas-read-model.js";
import type { PanelRunConfigurationFailureSummary, PanelRunSummary } from "../panel-read-model/run/panel-run-summary.js";
import type { PanelObservationReadModel, PanelRunStatus, PanelRunStreamEvent } from "../panel-read-model/run/index.js";
import type { AgentRunTreeAttachment } from "../run-read-model/agent-run-tree-attachment.js";
import type { BasicAgentRuntimeContext } from "../basic-agent-runtime/runtime-context.js";
import type { BasicAgentOrdinaryRunFacts } from "../basic-agent-runtime/run-job.js";
import type { DesktopTaskSoilInput } from "../task-soil/task-soil-workspace.js";
import { resolveRunModeForKind } from "../run-runtime-core/run-mode-policy.js";
import type { AgentArborRunKind, AgentArborRunMode } from "../run-runtime-core/run-mode-policy.js";

export type PanelRunKind = AgentArborRunKind;
/**
 * "agent" is the ordinary default path; "deep" is an explicit advanced
 * compatibility path. Routes decide which modes they accept.
 */
export type PanelRunMode = AgentArborRunMode;
type PanelRunStreamEventInput = Omit<PanelRunStreamEvent, "sequence">;

export type PanelRunCompletedPayload = {
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly summary?: PanelRunSummary;
  readonly observation?: PanelObservationReadModel;
  readonly agentRunTree?: AgentRunTreeAttachment;
  readonly canvas?: PanelRunCanvasReadModel;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly ordinary?: BasicAgentOrdinaryRunFacts;
  readonly ordinaryModelContext?: RuntimeOrdinaryModelContextRecord;
};

export type PanelRunFailedPayload = {
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly canvas?: PanelRunCanvasReadModel;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
  readonly summary?: PanelRunConfigurationFailureSummary;
  readonly ordinary?: BasicAgentOrdinaryRunFacts;
  readonly ordinaryModelContext?: RuntimeOrdinaryModelContextRecord;
};

export type PanelRunTerminalPayload = {
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly reason: {
    readonly code: string;
    readonly message: string;
  };
  readonly summary?: PanelRunSummary;
  readonly observation?: PanelObservationReadModel;
  readonly agentRunTree?: AgentRunTreeAttachment;
  readonly canvas?: PanelRunCanvasReadModel;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly ordinary?: BasicAgentOrdinaryRunFacts;
  readonly ordinaryModelContext?: RuntimeOrdinaryModelContextRecord;
};

export type PanelRunStatusPayload =
  | PanelRunCompletedPayload
  | PanelRunFailedPayload
  | PanelRunTerminalPayload;

export type PanelRunJob = {
  readonly runId: string;
  readonly runKind: PanelRunKind;
  readonly runMode: PanelRunMode;
  readonly goal: string;
  readonly aiMode: ModelRuntimeMode;
  readonly conversationId?: string;
  readonly assistantTurnId?: string;
  readonly runAfterRunId?: string;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly reasoningEffort?: ModelRunReasoningEffort;
  readonly toolConfirmationPolicy?: ToolConfirmationPolicy;
  readonly agentDefinitionRef?: RunAgentDefinitionRef;
  readonly createdAt: string;
  readonly status: PanelRunStatus;
  readonly updatedAt: string;
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly runtime?: BasicAgentRuntimeContext;
  readonly traceId?: string;
  readonly goalId?: string;
  readonly streamEvents: readonly PanelRunStreamEvent[];
  readonly completed?: PanelRunCompletedPayload;
  readonly failed?: PanelRunFailedPayload;
  readonly cancelled?: PanelRunTerminalPayload;
  readonly blocked?: PanelRunTerminalPayload;
  readonly confirmationDecisions: readonly PanelRunConfirmationDecisionRecord[];
};

export type PanelRunConfirmationDecisionRecord = ConfirmationDecision;

/**
 * Panel-specific type facade over the canonical in-memory RunJobStore.
 *
 * Lifecycle transitions, terminal guards, fact freezing, event de-duplication,
 * and stream sequencing live in one implementation shared with core tests.
 */
export class PanelRunJobStore {
  private readonly core = new InMemoryBasicAgentRunJobStore({ idPrefix: "panel-run" });

  create(input: {
    readonly runKind: PanelRunKind;
    readonly runMode?: PanelRunMode;
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
  }): PanelRunJob {
    return this.core.create(input) as unknown as PanelRunJob;
  }

  get(runId: string): PanelRunJob | undefined {
    return this.core.get(runId) as unknown as PanelRunJob | undefined;
  }

  markRunning(runId: string): void {
    this.core.markRunning(runId);
  }

  markResuming(runId: string): void {
    this.core.markResuming(runId);
  }

  awaitApproval(runId: string, completed: PanelRunCompletedPayload): void {
    this.core.awaitApproval(runId, completed);
  }

  markNeedsInput(runId: string): void {
    this.core.markNeedsInput(runId);
  }

  recordActivity(runId: string): void {
    this.core.recordActivity(runId);
  }

  attachRuntime(input: {
    readonly runId: string;
    readonly runtime: BasicAgentRuntimeContext;
    readonly traceId: string;
    readonly goalId: string;
  }): void {
    this.core.attachRuntime(input);
  }

  complete(runId: string, completed: PanelRunCompletedPayload): void {
    this.core.complete(runId, completed);
  }

  fail(runId: string, failed: PanelRunFailedPayload): void {
    this.core.fail(runId, failed);
  }

  cancel(runId: string, cancelled: PanelRunTerminalPayload): void {
    this.core.cancel(runId, cancelled);
  }

  block(runId: string, blocked: PanelRunTerminalPayload): void {
    this.core.block(runId, blocked);
  }

  recordConfirmationDecision(decision: PanelRunConfirmationDecisionRecord): void {
    this.core.recordConfirmationDecision(decision);
  }

  recordRunResumed(runId: string, input: {
    readonly confirmationId: string;
    readonly resumedAt: string;
  }): void {
    this.core.recordRunResumed(runId, input);
  }

  appendStreamEvent(runId: string, event: PanelRunStreamEventInput): PanelRunStreamEvent {
    return this.core.appendStreamEvent(runId, event) as unknown as PanelRunStreamEvent;
  }

  appendStreamEvents(runId: string, events: readonly PanelRunStreamEventInput[]): readonly PanelRunStreamEvent[] {
    return this.core.appendStreamEvents(runId, events) as unknown as readonly PanelRunStreamEvent[];
  }
}

export function resolvePanelRunMode(
  runKind: PanelRunKind,
  runMode: PanelRunMode | undefined
): PanelRunMode {
  return resolveRunModeForKind(runKind, runMode);
}

export function panelRunPayloadForStatus(job: PanelRunJob): PanelRunStatusPayload | undefined {
  switch (job.status) {
    case "approval_needed":
    case "completed":
      return job.completed;
    case "failed":
      return job.failed;
    case "cancelled":
      return job.cancelled;
    case "blocked":
      return job.blocked;
    case "pending":
    case "running":
    case "needs_input":
      return undefined;
  }
}
