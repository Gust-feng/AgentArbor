import type { ConfirmationDecision, ConfirmationRequest } from "../../domain/confirmation/index.js";
import type {
  BasicAgentCapabilitySnapshot,
  ModelRunReasoningEffort,
  RunAgentDefinitionRef,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type { ModelMessage } from "../../domain/intelligence/index.js";
import type { ToolCallResult, ToolConfirmationPolicy } from "../../domain/tools/index.js";
import type { ModelRuntimeMode } from "../model-runtime/contracts.js";

export const ORDINARY_RUN_SCHEMA_VERSION = "ordinary-run/v1" as const;

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
  /** Durable references only. Attachment bytes are resolved again for each model request. */
  readonly taskSoil?: {
    readonly attachmentRefs: readonly {
      readonly ref: string;
      readonly kind: "file" | "project" | "web" | "workspace";
      readonly title: string;
    }[];
  };
};

export type OrdinaryRunTurn = {
  readonly conversationId: string;
  readonly userTurnId: string;
  readonly assistantTurnId: string;
  readonly predecessorRunId?: string;
};

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
  | { readonly type: "run.approval_requested"; readonly confirmationIds: readonly string[]; readonly toolCallIds: readonly string[] }
  | { readonly type: "run.approval_decided"; readonly confirmationId: string; readonly decision: ConfirmationDecision["decision"] }
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
}

export interface OrdinaryExecutionPort {
  execute(input: {
    readonly runId: string;
    readonly birth: OrdinaryRunBirth;
    readonly messages: readonly ModelMessage[];
    readonly abortSignal: AbortSignal;
  }): Promise<OrdinaryExecutionOutcome>;
}

export type StartOrdinaryRunInput = {
  readonly runId: string;
  readonly turn: OrdinaryRunTurn;
  readonly input: OrdinaryRunInput;
  readonly birth: OrdinaryRunBirth;
  readonly priorCanonicalMessages?: readonly ModelMessage[];
};

export interface OrdinaryAgentFeature {
  readonly commands: {
    start(input: StartOrdinaryRunInput): Promise<OrdinaryRunState>;
    cancel(runId: string, reason?: string): Promise<OrdinaryRunState>;
    decideApproval(decision: ConfirmationDecision): Promise<OrdinaryRunState>;
  };
  readonly queries: {
    getRun(runId: string): Promise<OrdinaryRunState | undefined>;
    listRuns(limit?: number): Promise<readonly OrdinaryRunSummary[]>;
  };
  readonly events: {
    subscribe(runId: string, listener: (event: OrdinaryRunEvent) => void): () => void;
  };
  release(): Promise<void>;
}
