import type { RuntimeConversationRecord, RuntimeRunStatus } from "../../domain/runtime-database/index.js";
import type {
  PanelBasicAgentRunDetailReadModel,
  PanelBasicAgentRunViewReadModel,
} from "../panel-read-model/basic-agent-run-view-contracts.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import type { WorkspaceFolderSummary } from "../workspace-folder-summary.js";

export type PanelConversationTurnRole = "user" | "assistant";
export type PanelConversationTurnStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "needs_input";
export type PanelConversationStatus = Extract<
  RuntimeRunStatus,
  "pending" | "running" | "approval_needed" | "needs_input" | "completed" | "failed" | "cancelled" | "blocked"
> | "idle";

export type PanelConversationTurnModel = {
  readonly profileId: string;
  readonly label?: string;
  readonly providerKind?: string;
  readonly protocolKind?: string;
  readonly baseUrl?: string;
  readonly model?: string;
};

export type PanelConversationTurnAttachment = {
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

export type PanelConversationTurn = {
  readonly turnId: string;
  readonly role: PanelConversationTurnRole;
  readonly createdAt: string;
  title: string;
  content: string;
  status: PanelConversationTurnStatus;
  updatedAt: string;
  runId?: string;
  responseModel?: PanelConversationTurnModel;
  taskSoilInput?: DesktopTaskSoilInput;
  attachments?: readonly PanelConversationTurnAttachment[];
};

export type PanelConversationPendingAction = {
  readonly kind: "approval" | "input";
  readonly runId: string;
  readonly assistantTurnId: string;
};

export type PanelConversation = {
  readonly conversationId: string;
  readonly createdAt: string;
  title: string;
  titleEditedAt?: string;
  updatedAt: string;
  pinnedAt?: string;
  currentRunId?: string;
  latestRunId?: string;
  queuedRunIds: string[];
  pendingAction?: PanelConversationPendingAction;
  turns: PanelConversationTurn[];
};

export type PanelConversationTurnReadModel = {
  readonly turnId: string;
  readonly role: PanelConversationTurnRole;
  readonly title: string;
  readonly content: string;
  readonly status: PanelConversationTurnStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runId?: string;
  readonly responseModel?: PanelConversationTurnModel;
  readonly attachments?: readonly PanelConversationTurnAttachment[];
};

export type PanelConversationReadModel = {
  readonly conversationId: string;
  readonly title: string;
  readonly titleEditedAt?: string;
  readonly preview: string;
  readonly currentAction: string;
  readonly nextStep: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly pinnedAt?: string;
  readonly status: PanelConversationStatus;
  readonly activeRunId?: string;
  readonly latestRunId?: string;
  readonly workspaceFolder?: WorkspaceFolderSummary;
  readonly requiresUserAction: boolean;
  readonly pendingAction?: PanelConversationPendingAction;
  readonly queuedRunIds: readonly string[];
  readonly queuedRunCount: number;
  readonly currentRun?: PanelConversationCurrentRunReadModel;
  readonly turns: readonly PanelConversationTurnReadModel[];
};

export type PanelConversationSummaryReadModel = Omit<PanelConversationReadModel, "turns">;

export type PanelConversationCurrentRunDetailReadModel = PanelBasicAgentRunDetailReadModel;

export type PanelConversationCurrentRunReadModel = PanelBasicAgentRunViewReadModel;

export type TrimRuntimeConversationResult = {
  readonly record: RuntimeConversationRecord;
  readonly trimmed: boolean;
};
