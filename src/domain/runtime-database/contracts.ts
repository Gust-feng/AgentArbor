import type { ArborMessageType, ArtifactRef } from "../common.js";
import type {
  BasicAgentCapabilitySnapshot,
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
} from "../config/contracts.js";
import type { ModelMessage, ModelUsage } from "../intelligence/contracts.js";
import type { SubAgentRunTrace } from "../sub-agents/contracts.js";
import type { ToolErrorDomain, ToolErrorFacts } from "../tools/contracts.js";
import type { ToolFactValue } from "../tools/fact-value.js";
import type {
  ObservationProgress,
  ObservationRef,
  ObservationScope,
  ObservationSeverity,
} from "../observation/contracts.js";

export type RuntimeProfile = "lite" | "full";

export type RuntimeRunStatus =
  | "pending"
  | "running"
  | "approval_needed"
  | "needs_input"
  | "completed"
  | "failed"
  | "stopped"
  | "cancelled"
  | "blocked";

export type RuntimeRunContinuationAvailability =
  | "none"
  | "live"
  | "lost_after_restart"
  | "new_turn";

export type RuntimeConversationStatus =
  | "idle"
  | Extract<
      RuntimeRunStatus,
      "pending" | "running" | "approval_needed" | "needs_input" | "completed" | "failed" | "cancelled" | "blocked"
    >;

export type RuntimeWorkspaceRecord = {
  readonly workspaceId: string;
  readonly kind: "local_directory";
  readonly path: string;
  readonly label: string;
  readonly selectedAt: string;
  readonly updatedAt: string;
};

export type RuntimeConversationTurnRecord = {
  readonly turnId: string;
  readonly role: "user" | "assistant";
  readonly title: string;
  readonly content: string;
  readonly status: "pending" | "running" | "completed" | "failed" | "cancelled" | "blocked" | "needs_input";
  readonly runId?: string;
  readonly responseModel?: {
    readonly profileId: string;
    readonly label?: string;
    readonly providerKind?: string;
    readonly protocolKind?: string;
    readonly baseUrl?: string;
    readonly model?: string;
  };
  readonly attachments?: readonly RuntimeConversationTurnAttachmentRecord[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type RuntimeConversationTurnAttachmentRecord = {
  readonly attachmentId: string;
  readonly kind: "workspace" | "file" | "project" | "web";
  readonly title: string;
  readonly summary?: string;
  readonly readonlyPreviewMeta?: {
    readonly available?: boolean;
    readonly title?: string;
    readonly byteLength?: number;
    readonly mimeType?: string;
    readonly truncated?: boolean;
  };
  readonly mediaPreview?: {
    readonly kind: "image";
    readonly url: string;
    readonly mimeType: string;
    readonly byteLength?: number;
  };
};

export type RuntimeConversationRecord = {
  readonly conversationId: string;
  readonly title: string;
  readonly titleEditedAt?: string;
  readonly preview: string;
  readonly currentAction?: string;
  readonly nextStep?: string;
  readonly status: RuntimeConversationStatus;
  readonly activeRunId?: string;
  readonly latestRunId?: string;
  readonly requiresUserAction?: boolean;
  readonly queuedRunIds: readonly string[];
  readonly queuedRunCount: number;
  readonly pinnedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly turns: readonly RuntimeConversationTurnRecord[];
};

export type RuntimeRunRecord = {
  readonly runId: string;
  readonly profile: RuntimeProfile;
  readonly runKind: "desktop" | "underground";
  readonly runMode: "agent" | "deep";
  readonly status: RuntimeRunStatus;
  readonly goalSummary: string;
  readonly aiMode: "none" | "fake" | "openai-compatible" | "openai-responses";
  readonly workspaceId?: string;
  readonly workspacePath?: string;
  readonly conversationId?: string;
  readonly traceId?: string;
  readonly goalId?: string;
  readonly appHome: string;
  readonly runHome: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly resultTitle?: string;
  readonly resultSummary?: string;
  readonly resultAnswer?: string;
  readonly stopReason?: string;
  readonly continuationAvailability?: RuntimeRunContinuationAvailability;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly errorDomain?: ToolErrorDomain;
  };
  readonly agentDefinitionRef?: RunAgentDefinitionRef;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly informationAccess?: SanitizedInformationAccessConfig;
};

export type RuntimeEventRecord = {
  readonly eventId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: ArborMessageType;
  readonly summary: string;
  readonly scope: ObservationScope;
  readonly severity: ObservationSeverity;
  readonly progress: ObservationProgress;
  readonly refs: readonly ObservationRef[];
  readonly traceId: string;
  readonly taskId?: string;
  readonly intent: string;
  /** Bounded canonical payload for durable tool lifecycle facts only. */
  readonly payload?: ToolFactValue;
  readonly createdAt: string;
  readonly recordedAt: string;
};

export type RuntimeModelCallRecord = {
  readonly requestId: string;
  readonly runId: string;
  readonly responseId?: string;
  readonly status: "requested" | "completed" | "failed";
  readonly purpose?: string;
  readonly outputContractId?: string;
  readonly providerKind?: string;
  readonly protocolKind?: string;
  readonly model?: string;
  readonly outputKind?: string;
  readonly validationStatus?: string;
  readonly failureKind?: string;
  readonly retryable?: boolean;
  readonly usage?: ModelUsage;
  readonly eventRefs: readonly string[];
};

export type RuntimeToolCallRecord = {
  readonly callId: string;
  readonly runId: string;
  readonly toolName?: string;
  readonly status: "requested" | "approval_required" | "completed" | "failed" | "cancelled";
  readonly error?: string;
  readonly errorDomain?: ToolErrorDomain;
  readonly errorFacts?: ToolErrorFacts;
  readonly durationMs?: number;
  readonly confirmationId?: string;
  readonly eventRefs: readonly string[];
  readonly createdAt?: string;
  readonly terminalAt?: string;
};

export type RuntimeArtifactRecord = {
  readonly runId: string;
  readonly ref: ArtifactRef;
  readonly summary: string;
};

export type RuntimeConfirmationRecord = {
  readonly confirmationId: string;
  readonly runId: string;
  readonly conversationId?: string;
  readonly status: "pending" | "approved" | "denied" | "guidance";
  readonly title: string;
  readonly actionSummary: string;
  readonly affectedResources: readonly string[];
  readonly riskLevel: "low" | "medium" | "high";
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly resumeAvailability?: "live" | "lost_after_restart";
  readonly sourceRefs?: readonly string[];
  readonly requestedAt: string;
  readonly expiresAt?: string;
  readonly decidedAt?: string;
  readonly guidance?: string;
  readonly eventRefs: readonly string[];
};

export type RuntimeSubAgentRunRecord = SubAgentRunTrace;

/**
 * Ordinary Agent's canonical model-visible window after a run. Attachments are
 * request-scoped and must not be stored here; provider continuations are
 * restricted by the intelligence persistence contract before this is written.
 */
export type RuntimeOrdinaryModelContextRecord = {
  readonly runId: string;
  readonly messages: readonly ModelMessage[];
};

export type RuntimeRunSnapshot = {
  readonly run: RuntimeRunRecord;
  readonly workspace?: RuntimeWorkspaceRecord;
  readonly events: readonly RuntimeEventRecord[];
  readonly modelCalls: readonly RuntimeModelCallRecord[];
  readonly toolCalls: readonly RuntimeToolCallRecord[];
  readonly artifacts: readonly RuntimeArtifactRecord[];
  readonly confirmations: readonly RuntimeConfirmationRecord[];
  readonly subAgentRuns: readonly RuntimeSubAgentRunRecord[];
  readonly ordinaryModelContext?: RuntimeOrdinaryModelContextRecord;
};

export type RuntimeRunSnapshotContent = RuntimeRunSnapshot;

export const RUNTIME_RUN_SNAPSHOT_SCHEMA_VERSION = "runtime-run-snapshot/v1" as const;
export const RUNTIME_RUN_MANIFEST_SCHEMA_VERSION = "runtime-run-manifest/v1" as const;

/** The manifest deliberately excludes frozen capability and projection payloads. */
export type RuntimeRunSummaryRecord = Pick<RuntimeRunRecord,
  | "runId"
  | "profile"
  | "runKind"
  | "runMode"
  | "status"
  | "goalSummary"
  | "aiMode"
  | "workspaceId"
  | "workspacePath"
  | "conversationId"
  | "appHome"
  | "runHome"
  | "createdAt"
  | "updatedAt"
  | "completedAt"
  | "resultTitle"
  | "resultSummary"
  | "stopReason"
  | "continuationAvailability"
  | "error"
>;

export type RuntimeRunSnapshotDocument = {
  readonly schemaVersion: typeof RUNTIME_RUN_SNAPSHOT_SCHEMA_VERSION;
  readonly revision: number;
  readonly content: RuntimeRunSnapshotContent;
};

export type RuntimeRunManifest = {
  readonly schemaVersion: typeof RUNTIME_RUN_MANIFEST_SCHEMA_VERSION;
  readonly revision: number;
  readonly snapshotRef: string;
  readonly run: RuntimeRunSummaryRecord;
};

export class RuntimeSnapshotIncompatibleError extends Error {
  readonly code = "runtime_snapshot_incompatible" as const;

  constructor(
    readonly runId: string,
    reason: string,
  ) {
    super(`Runtime snapshot ${runId} is incompatible with runtime-run-snapshot/v1: ${reason}`);
    this.name = "RuntimeSnapshotIncompatibleError";
  }
}

export type RuntimeRunModelCallsRecord = {
  readonly runId: string;
  readonly modelCalls: readonly RuntimeModelCallRecord[];
};

export interface RuntimeDatabase {
  upsertConversation(record: RuntimeConversationRecord): Promise<RuntimeConversationRecord>;
  getConversation(conversationId: string): Promise<RuntimeConversationRecord | undefined>;
  listConversations(limit?: number): Promise<readonly RuntimeConversationRecord[]>;
  deleteConversation(conversationId: string): Promise<void>;
  saveRunSnapshot(content: RuntimeRunSnapshotContent): Promise<RuntimeRunSnapshotContent>;
  getRun(runId: string): Promise<RuntimeRunSnapshot | undefined>;
  listRuns(limit?: number): Promise<readonly RuntimeRunSummaryRecord[]>;
  listModelCallsForRuns?(runIds: readonly string[]): Promise<readonly RuntimeRunModelCallsRecord[]>;
}
