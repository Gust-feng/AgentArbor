import type { BasicAgentRun, DesktopWorkViewReadModel, RunEvent, TranscriptNode } from "../../domain/basic-agent/index.js";
import type { RunAgentDefinitionRef, RunCapabilityResolution } from "../../domain/config/index.js";
import type { ModelUsage } from "../../domain/intelligence/index.js";
import type { ToolCallResult } from "../../domain/tools/index.js";
import type { WorkspaceFolderSummary } from "../task-soil/workspace-folder-summary.js";

export type OrdinaryPanelBasicRun = Omit<BasicAgentRun, "runMode" | "requiresUserAction"> & {
  readonly runMode: "agent";
  readonly requiresUserAction: boolean;
};
export type OrdinaryPanelCapabilityResolution = Omit<RunCapabilityResolution, "runMode"> & {
  readonly runMode: "agent";
};
export type OrdinaryPanelWorkView = Omit<DesktopWorkViewReadModel, "run"> & {
  readonly run: OrdinaryPanelBasicRun;
};

export type OrdinaryPanelReplayCursor = {
  readonly token: string;
  readonly lastSequence: number;
};

export type OrdinaryPanelReplay = {
  readonly reset: boolean;
  readonly events: readonly RunEvent[];
  readonly cursor: OrdinaryPanelReplayCursor;
};

export type OrdinaryPanelRunDetail = {
  readonly runId: string;
  readonly status: OrdinaryPanelBasicRun["status"];
  readonly error?: { readonly code: string; readonly message: string };
  readonly transcript?: { readonly transcriptNodes?: readonly TranscriptNode[] };
  readonly stopReason?: string;
  readonly continuationAvailability?: "none" | "live" | "lost_after_restart" | "new_turn";
  readonly toolResults: readonly ToolCallResult[];
  readonly usage: ModelUsage;
};

export type OrdinaryPanelRunView = {
  readonly run: OrdinaryPanelBasicRun;
  readonly agentDefinitionRef?: RunAgentDefinitionRef;
  readonly capabilityResolution?: OrdinaryPanelCapabilityResolution;
  readonly workView: OrdinaryPanelWorkView;
  readonly detail: OrdinaryPanelRunDetail;
  readonly replay: OrdinaryPanelReplay;
};

export type OrdinaryPanelConversationTurnStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked"
  | "needs_input";

export type OrdinaryPanelConversationStatus =
  | "idle"
  | "pending"
  | "running"
  | "approval_needed"
  | "needs_input"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export type OrdinaryPanelConversationTurnModel = {
  readonly profileId: string;
  readonly label?: string;
  readonly providerKind?: string;
  readonly protocolKind?: string;
  readonly baseUrl?: string;
  readonly model?: string;
};

export type OrdinaryPanelConversationTurnAttachment = {
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

export type OrdinaryPanelConversationTurn = {
  readonly turnId: string;
  readonly role: "user" | "assistant";
  readonly title: string;
  readonly content: string;
  readonly status: OrdinaryPanelConversationTurnStatus;
  readonly interruption?: "user_cancelled" | "runtime_stopped";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runId?: string;
  readonly responseModel?: OrdinaryPanelConversationTurnModel;
  readonly attachments?: readonly OrdinaryPanelConversationTurnAttachment[];
};

export type OrdinaryPanelConversationPendingAction = {
  readonly kind: "approval" | "input";
  readonly runId: string;
  readonly assistantTurnId: string;
};

export type OrdinaryPanelConversation = {
  readonly conversationId: string;
  /** Canonical owner（ADR-0035）。v2 旧对话为 undefined。 */
  readonly owner?: { readonly kind: "space" | "workspace"; readonly id: string };
  /** 兼容投影：space owner 的 id；workspace owner 或无 owner 时 undefined。 */
  readonly spaceId?: string;
  readonly title: string;
  readonly titleEditedAt?: string;
  readonly preview: string;
  readonly currentAction: string;
  readonly nextStep: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly pinnedAt?: string;
  readonly status: OrdinaryPanelConversationStatus;
  readonly activeRunId?: string;
  readonly latestRunId?: string;
  readonly workspaceFolder?: WorkspaceFolderSummary;
  readonly requiresUserAction: boolean;
  readonly pendingAction?: OrdinaryPanelConversationPendingAction;
  readonly queuedRunIds: readonly string[];
  readonly queuedRunCount: number;
  readonly currentRun?: OrdinaryPanelRunView;
  readonly turns: readonly OrdinaryPanelConversationTurn[];
};

export type OrdinaryPanelConversationSummary = Omit<OrdinaryPanelConversation, "turns">;
