import type { ArborMessageType, ArtifactRef } from "../common.js";
import type { BasicAgentRun, RunEvent } from "../basic-agent/contracts.js";
import type { BasicAgentCapabilitySnapshot } from "../config/contracts.js";
import type { ToolDisplayProjection, ToolResultEnvelope } from "../tools/contracts.js";
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
  readonly status: "pending" | "running" | "completed" | "failed";
  readonly runId?: string;
  readonly responseModel?: {
    readonly profileId: string;
    readonly label?: string;
    readonly providerKind?: string;
    readonly protocolKind?: string;
    readonly baseUrl?: string;
    readonly model?: string;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type RuntimeConversationRecord = {
  readonly conversationId: string;
  readonly title: string;
  readonly preview: string;
  readonly status: "idle" | "running" | "completed" | "failed";
  readonly activeRunId?: string;
  readonly latestRunId?: string;
  readonly requiresUserAction?: boolean;
  readonly queuedRunIds: readonly string[];
  readonly queuedRunCount: number;
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
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
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
  readonly eventRefs: readonly string[];
};

export type RuntimeToolCallRecord = {
  readonly callId: string;
  readonly runId: string;
  readonly toolName?: string;
  readonly status: "requested" | "approval_required" | "completed" | "failed" | "cancelled";
  readonly action?: string;
  readonly path?: string;
  readonly query?: string;
  readonly command?: string;
  readonly exitCode?: number;
  readonly summary?: string;
  readonly preview?: string;
  readonly display?: ToolDisplayProjection;
  readonly envelope?: ToolResultEnvelope;
  readonly truncated?: boolean;
  readonly error?: string;
  readonly eventRefs: readonly string[];
  readonly createdAt?: string;
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
  readonly requestedAt: string;
  readonly expiresAt?: string;
  readonly decidedAt?: string;
  readonly guidance?: string;
  readonly eventRefs: readonly string[];
};

export type RuntimeRunSnapshot = {
  readonly run: RuntimeRunRecord;
  readonly workspace?: RuntimeWorkspaceRecord;
  readonly basicRun?: BasicAgentRun;
  readonly basicEvents: readonly RunEvent[];
  readonly events: readonly RuntimeEventRecord[];
  readonly modelCalls: readonly RuntimeModelCallRecord[];
  readonly toolCalls: readonly RuntimeToolCallRecord[];
  readonly artifacts: readonly RuntimeArtifactRecord[];
  readonly confirmations: readonly RuntimeConfirmationRecord[];
};

export interface RuntimeDatabase {
  upsertWorkspace(record: RuntimeWorkspaceRecord): Promise<RuntimeWorkspaceRecord>;
  upsertConversation(record: RuntimeConversationRecord): Promise<RuntimeConversationRecord>;
  getConversation(conversationId: string): Promise<RuntimeConversationRecord | undefined>;
  listConversations(limit?: number): Promise<readonly RuntimeConversationRecord[]>;
  upsertRun(record: RuntimeRunRecord): Promise<RuntimeRunRecord>;
  upsertBasicRun(record: BasicAgentRun): Promise<BasicAgentRun>;
  replaceBasicRunEvents(runId: string, events: readonly RunEvent[]): Promise<readonly RunEvent[]>;
  replaceRunEvents(runId: string, events: readonly RuntimeEventRecord[]): Promise<readonly RuntimeEventRecord[]>;
  replaceModelCalls(runId: string, calls: readonly RuntimeModelCallRecord[]): Promise<readonly RuntimeModelCallRecord[]>;
  replaceToolCalls(runId: string, calls: readonly RuntimeToolCallRecord[]): Promise<readonly RuntimeToolCallRecord[]>;
  replaceArtifacts(runId: string, artifacts: readonly RuntimeArtifactRecord[]): Promise<readonly RuntimeArtifactRecord[]>;
  replaceConfirmations(runId: string, confirmations: readonly RuntimeConfirmationRecord[]): Promise<readonly RuntimeConfirmationRecord[]>;
  getRun(runId: string): Promise<RuntimeRunSnapshot | undefined>;
  listRuns(limit?: number): Promise<readonly RuntimeRunRecord[]>;
}
