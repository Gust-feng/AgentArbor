import type { ConfirmationDecision, ConfirmationRequest } from "../../domain/confirmation/index.js";
import type {
  BasicAgentCapabilitySnapshot,
  ModelRunReasoningEffort,
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type { ModelMessage, ModelUsage } from "../../domain/intelligence/index.js";
import type { ToolCallResult, ToolConfirmationPolicy } from "../../domain/tools/index.js";
import type { ModelRuntimeMode } from "../model-runtime/contracts.js";
import type { DesktopTaskSoilInput } from "../task-soil/task-soil-workspace.js";

export const ORDINARY_RUN_SCHEMA_VERSION = "ordinary-run/v2" as const;
export const ORDINARY_CONVERSATION_SCHEMA_VERSION = "ordinary-conversation/v1" as const;

export type OrdinaryFeatureErrorCode =
  | "ordinary_feature_released"
  | "ordinary_run_not_found"
  | "ordinary_conversation_not_found"
  | "ordinary_conversation_deleted"
  | "ordinary_run_conflict"
  | "ordinary_revision_conflict"
  | "ordinary_run_state_conflict"
  | "ordinary_conversation_busy"
  | "ordinary_rollback_target_not_found"
  | "ordinary_confirmation_not_found"
  | "ordinary_confirmation_in_progress"
  | "ordinary_tool_result_conflict";

/** Expected command/query failures that protocol adapters may map without parsing messages. */
export class OrdinaryFeatureError extends Error {
  readonly name = "OrdinaryFeatureError";

  constructor(
    readonly code: OrdinaryFeatureErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export type OrdinaryRunBirth = {
  readonly instructions: string;
  readonly aiMode: ModelRuntimeMode;
  readonly config: SanitizedModelProviderConfig;
  readonly reasoningEffort?: ModelRunReasoningEffort;
  readonly agentDefinitionRef: RunAgentDefinitionRef;
  readonly capabilitySnapshot: BasicAgentCapabilitySnapshot;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly toolConfirmationPolicy: ToolConfirmationPolicy;
};

export type OrdinaryRunInput = {
  readonly userMessage: string;
  /** JSON-safe Desktop input. Attachment bytes are resolved again for each model request. */
  readonly taskSoil?: DesktopTaskSoilInput;
};

export type OrdinaryRunTurn = {
  readonly conversationId: string;
  readonly lineageId: string;
  readonly ordinal: number;
  readonly userTurnId: string;
  readonly assistantTurnId: string;
  readonly predecessorRunId?: string;
};

export type OrdinaryConversationLineage = {
  readonly lineageId: string;
  readonly parentLineageId?: string;
  readonly forkFromRunId?: string;
  readonly createdAt: string;
};

export type OrdinaryConversationControlState = {
  readonly conversationId: string;
  readonly createdAt: string;
  readonly titleOverride?: string;
  readonly titleEditedAt?: string;
  readonly pinnedAt?: string;
  readonly deletedAt?: string;
  readonly activeLineageId: string;
  readonly lineages: readonly OrdinaryConversationLineage[];
};

export type OrdinaryConversationControlDocument = {
  readonly schemaVersion: typeof ORDINARY_CONVERSATION_SCHEMA_VERSION;
  readonly revision: number;
  readonly savedAt: string;
  readonly state: OrdinaryConversationControlState;
};

export type OrdinaryConversationControlSummary = {
  readonly conversationId: string;
  readonly updatedAt: string;
  readonly deleted: boolean;
};

export interface OrdinaryConversationControlRepository {
  save(state: OrdinaryConversationControlState, expectedRevision: number, savedAt: string): Promise<OrdinaryConversationControlDocument>;
  get(conversationId: string): Promise<OrdinaryConversationControlDocument | undefined>;
  list(limit?: number): Promise<readonly OrdinaryConversationControlSummary[]>;
}

export type OrdinaryRunStatus =
  | { readonly kind: "queued" }
  | { readonly kind: "running" }
  | {
      readonly kind: "awaiting_approval";
      readonly confirmationRequests: readonly ConfirmationRequest[];
      readonly continuationAvailability: "live_only";
    }
  | { readonly kind: "completed"; readonly answer: string }
  | {
      readonly kind: "failed";
      readonly error: { readonly code: string; readonly message: string };
    }
  | { readonly kind: "cancelled"; readonly reason: string }
  | {
      readonly kind: "blocked";
      readonly reason: { readonly code: string; readonly message: string };
      readonly continueBy: "new_turn" | "retry";
    };

type OrdinaryRunEventBase = {
  readonly eventId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly recordedAt: string;
};

export type OrdinaryRunEvent = OrdinaryRunEventBase & (
  | { readonly type: "run.created" | "run.started" }
  | { readonly type: "run.approval_requested"; readonly confirmationRequests: readonly ConfirmationRequest[]; readonly toolCallIds: readonly string[] }
  | { readonly type: "run.approval_decided"; readonly decision: ConfirmationDecision }
  | { readonly type: "run.completed"; readonly toolCallIds: readonly string[] }
  | { readonly type: "run.failed"; readonly code: string; readonly toolCallIds: readonly string[] }
  | { readonly type: "run.cancelled"; readonly reason: string; readonly toolCallIds: readonly string[] }
  | { readonly type: "run.blocked"; readonly code: string }
);

export type OrdinaryRunState = {
  readonly runId: string;
  readonly turn: OrdinaryRunTurn;
  readonly input: OrdinaryRunInput;
  readonly birth: OrdinaryRunBirth;
  readonly status: OrdinaryRunStatus;
  readonly canonicalMessages: readonly ModelMessage[];
  readonly toolCalls: readonly ToolCallResult[];
  /** Durable occurrence time keyed by the stable tool result identity. */
  readonly toolResultRecordedAt: Readonly<Record<string, string>>;
  /** Cumulative provider usage for this run, including every live approval continuation segment. */
  readonly usage: ModelUsage;
  /** Effective capability boundary resolved from the frozen birth snapshot and executable Host tools. */
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly timeline: readonly OrdinaryRunEvent[];
  readonly timestamps: {
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly terminalAt?: string;
  };
};

export type OrdinaryRunSnapshotDocument = {
  readonly schemaVersion: typeof ORDINARY_RUN_SCHEMA_VERSION;
  readonly revision: number;
  readonly savedAt: string;
  readonly state: OrdinaryRunState;
};

export type OrdinaryRunSummary = {
  readonly runId: string;
  readonly conversationId: string;
  readonly userTurnId: string;
  readonly assistantTurnId: string;
  readonly status: OrdinaryRunStatus["kind"];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export interface OrdinaryRunRepository {
  save(state: OrdinaryRunState, expectedRevision: number): Promise<OrdinaryRunSnapshotDocument>;
  get(runId: string): Promise<OrdinaryRunSnapshotDocument | undefined>;
  list(limit?: number): Promise<readonly OrdinaryRunSummary[]>;
  delete(runId: string): Promise<void>;
}

export type OrdinaryExecutionFacts = {
  readonly canonicalMessages: readonly ModelMessage[];
  readonly toolCalls: readonly ToolCallResult[];
  /** Cumulative usage for the whole live execution/continuation chain. */
  readonly usage: ModelUsage;
  readonly capabilityResolution?: RunCapabilityResolution;
};

export type OrdinaryExecutionOutcome =
  | (OrdinaryExecutionFacts & { readonly status: "completed"; readonly answer: string })
  | (OrdinaryExecutionFacts & {
      readonly status: "approval_required";
      readonly confirmationRequests: readonly ConfirmationRequest[];
      readonly continuation: OrdinaryExecutionContinuation;
    })
  | (OrdinaryExecutionFacts & { readonly status: "cancelled"; readonly reason: string })
  | (OrdinaryExecutionFacts & {
      readonly status: "failed";
      readonly error: { readonly code: string; readonly message: string };
    });

export interface OrdinaryExecutionContinuation {
  readonly availability: "live_only";
  decide(input: {
    readonly decision: ConfirmationDecision;
    readonly abortSignal: AbortSignal;
  }): Promise<OrdinaryExecutionOutcome>;
  /** Releases the live-only model/tool continuation without deciding it. */
  release(): Promise<void>;
}

export type OrdinaryExecutionInput = {
  readonly runId: string;
  readonly birth: OrdinaryRunBirth;
  /** Durable user input, including attachment refs that must be resolved per request. */
  readonly runInput: OrdinaryRunInput;
  readonly messages: readonly ModelMessage[];
  readonly abortSignal: AbortSignal;
  readonly onTextDelta?: (delta: string) => void;
  /** Must settle before the executed result is returned to the model. */
  readonly onToolResult?: (result: ToolCallResult) => Promise<void>;
};

export type OrdinaryRunActivityCursor = {
  /** Changes whenever live-only activity memory is recreated, including after restart. */
  readonly streamId: string;
  readonly sequence: number;
};

type OrdinaryRunActivityBase = {
  readonly activityId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly recordedAt: string;
};

export type OrdinaryRunActivity = OrdinaryRunActivityBase & (
  | { readonly type: "run.transition"; readonly durability: "durable"; readonly event: OrdinaryRunEvent }
  | { readonly type: "model.request"; readonly durability: "live_only"; readonly reason: "initial" | "after_tool" | "after_approval" }
  | { readonly type: "model.output.delta"; readonly durability: "live_only"; readonly delta: string }
  | { readonly type: "tool.result"; readonly durability: "live_only" | "durable"; readonly result: ToolCallResult }
);

export type OrdinaryRunActivityReplay = {
  readonly cursor: OrdinaryRunActivityCursor;
  /** True when the supplied cursor belonged to a previous in-memory stream generation. */
  readonly reset: boolean;
  readonly activities: readonly OrdinaryRunActivity[];
};

export interface OrdinaryExecutionPort {
  execute(input: OrdinaryExecutionInput): Promise<OrdinaryExecutionOutcome>;
}

export type StartOrdinaryRunInput = {
  readonly runId: string;
  readonly turn: OrdinaryRunTurn;
  readonly input: OrdinaryRunInput;
  readonly birth: OrdinaryRunBirth;
  readonly priorCanonicalMessages?: readonly ModelMessage[];
};

export type SubmitOrdinaryTurnInput = {
  readonly conversationId?: string;
  readonly input: OrdinaryRunInput;
  readonly birth: OrdinaryRunBirth;
};

/** Ordinary owns the business run; the neutral decision owns only confirmation semantics. */
export type DecideOrdinaryApprovalInput = {
  readonly ownerRunId: string;
  readonly confirmationId: string;
  readonly decision: ConfirmationDecision["decision"];
  readonly guidance?: string;
  readonly decidedAt: string;
};

export type OrdinaryConversationTurnReadModel =
  | {
      readonly role: "user";
      readonly turnId: string;
      readonly runId: string;
      readonly content: string;
      readonly input: OrdinaryRunInput;
      readonly status: "pending" | "completed";
      readonly createdAt: string;
      readonly updatedAt: string;
    }
  | {
      readonly role: "assistant";
      readonly turnId: string;
      readonly runId: string;
      readonly content: string;
      readonly status: OrdinaryRunStatus["kind"];
      readonly model: SanitizedModelProviderConfig;
      readonly createdAt: string;
      readonly updatedAt: string;
    };

export type OrdinaryConversationReadModel = {
  readonly conversationId: string;
  readonly title: string;
  readonly titleEditedAt?: string;
  readonly pinnedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly activeLineage: OrdinaryConversationLineage;
  readonly activeRunId?: string;
  readonly latestRunId?: string;
  readonly queuedRunIds: readonly string[];
  readonly turns: readonly OrdinaryConversationTurnReadModel[];
};

export type SubmitOrdinaryTurnResult = {
  readonly conversation: OrdinaryConversationReadModel;
  readonly run: OrdinaryRunState;
};

export interface OrdinaryAgentFeature {
  readonly commands: {
    start(input: StartOrdinaryRunInput): Promise<OrdinaryRunState>;
    submitTurn(input: SubmitOrdinaryTurnInput): Promise<SubmitOrdinaryTurnResult>;
    renameConversation(conversationId: string, title: string): Promise<OrdinaryConversationReadModel>;
    setConversationPinned(conversationId: string, pinned: boolean): Promise<OrdinaryConversationReadModel>;
    rollbackConversation(input: { readonly conversationId: string; readonly targetRunId?: string; readonly stepsBack?: number }): Promise<OrdinaryConversationReadModel>;
    deleteConversation(conversationId: string): Promise<void>;
    cancel(runId: string, reason?: string): Promise<OrdinaryRunState>;
    decideApproval(input: DecideOrdinaryApprovalInput): Promise<OrdinaryRunState>;
  };
  readonly queries: {
    getRun(runId: string): Promise<OrdinaryRunState | undefined>;
    listRuns(limit?: number): Promise<readonly OrdinaryRunSummary[]>;
    getConversation(conversationId: string): Promise<OrdinaryConversationReadModel | undefined>;
    listConversations(limit?: number): Promise<readonly OrdinaryConversationReadModel[]>;
  };
  readonly events: {
    replay(runId: string, cursor?: OrdinaryRunActivityCursor): Promise<OrdinaryRunActivityReplay | undefined>;
    subscribe(runId: string, listener: (activity: OrdinaryRunActivity) => void): () => void;
  };
  release(): Promise<void>;
}
