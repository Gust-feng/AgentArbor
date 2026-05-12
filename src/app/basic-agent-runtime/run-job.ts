import type { BasicAgentCapabilitySnapshot, SanitizedInformationAccessConfig, SanitizedModelProviderConfig } from "../../domain/config/index.js";
import type { ConfirmationDecision } from "../../domain/basic-agent/index.js";
import type { AgentRunTree } from "../../domain/underground/index.js";
import type { ModelRuntimeMode } from "../model-runtime/index.js";
import type { DesktopIntentDecision } from "../desktop-intent-router.js";
import type { MinimalRuntime } from "../runtime.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import type { UndergroundDemoSummary } from "../underground-demo-summary.js";
import type {
  BasicAgentCompatRunStatus,
  BasicAgentRunProjectionInput,
  BasicAgentRunStreamEventProjectionInput,
} from "./run-projection.js";

export type BasicAgentRunKind = "desktop" | "underground";

export type BasicAgentRunMode = "agent" | "deep";

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
  readonly summary?: UndergroundDemoSummary;
  readonly observation?: unknown;
  readonly agentRunTree?: AgentRunTree;
  readonly canvas?: BasicAgentCanvasProjection;
};

export type BasicAgentRunFailedPayload = {
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
  readonly summary?: {
    readonly ai: UndergroundDemoSummary["ai"];
  };
};

export type BasicAgentRunTerminalPayload = {
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly reason: {
    readonly code: string;
    readonly message: string;
  };
};

export type BasicAgentRunConfirmationDecisionRecord = ConfirmationDecision;

export type BasicAgentRunJob = Omit<BasicAgentRunProjectionInput, "confirmationDecisions"> & {
  readonly runKind: BasicAgentRunKind;
  readonly aiMode: ModelRuntimeMode;
  readonly assistantTurnId?: string;
  readonly runAfterRunId?: string;
  routeDecision?: DesktopIntentDecision;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  config: SanitizedModelProviderConfig;
  informationAccess: SanitizedInformationAccessConfig;
  capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  runtime?: MinimalRuntime;
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
  readonly routeDecision?: DesktopIntentDecision;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
};

export type BasicAgentRunJobStore = {
  create(input: BasicAgentRunJobCreateInput): BasicAgentRunJob;
  get(runId: string): BasicAgentRunJob | undefined;
  markRunning(runId: string): void;
  markResuming(runId: string): void;
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
