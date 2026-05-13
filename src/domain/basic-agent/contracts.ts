import type { ObservationRef } from "../observation/index.js";
import type { ToolDisplayProjection } from "../tools/index.js";

export type AgentTaskStatus =
  | "queued"
  | "planning"
  | "running"
  | "needs_input"
  | "approval_needed"
  | "paused"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type BasicAgentRun = {
  readonly runId: string;
  readonly conversationId?: string;
  readonly title: string;
  readonly goalSummary: string;
  readonly status: AgentTaskStatus;
  readonly runMode: "agent" | "deep";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly currentStep?: string;
  readonly nextStep?: string;
  readonly requiresUserAction?: boolean;
  readonly eventCursor: {
    readonly lastSequence: number;
    readonly eventCount: number;
  };
};

export type RunEventVisibility = "compact" | "expanded" | "debug";

export type RunEvent = {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: string;
  readonly title: string;
  readonly summary?: string;
  readonly status: AgentTaskStatus;
  readonly timestamp: string;
  readonly refs: readonly ObservationRef[];
  readonly visibility: RunEventVisibility;
};

export type ConfirmationRiskLevel = "low" | "medium" | "high";

export type ConfirmationRequest = {
  readonly confirmationId: string;
  readonly runId: string;
  readonly conversationId?: string;
  readonly title: string;
  readonly actionSummary: string;
  readonly affectedResources: readonly string[];
  readonly riskLevel: ConfirmationRiskLevel;
  readonly resumeAvailability?: "live" | "lost_after_restart";
  readonly requestedAt: string;
  readonly expiresAt?: string;
  readonly sourceRefs: readonly string[];
};

export type ConfirmationDecision = {
  readonly confirmationId: string;
  readonly runId: string;
  readonly decision: "approve_once" | "deny" | "guidance";
  readonly decidedAt: string;
  readonly guidance?: string;
};

export type SkillDefinition = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly sourcePath: string;
  readonly triggers: readonly string[];
  readonly lastUsedAt?: string;
  readonly summary?: string;
  readonly category?: string;
  readonly scripts?: readonly string[];
  readonly references?: readonly string[];
};

export type ContextAttachmentKind = "workspace" | "file" | "project" | "web";

export type ContextAttachment = {
  readonly attachmentId: string;
  readonly kind: ContextAttachmentKind;
  readonly ref: string;
  readonly title: string;
  readonly summary: string;
  readonly permissionRefs: readonly string[];
  readonly readonlyPreviewMeta: {
    readonly available: boolean;
    readonly title?: string;
    readonly byteLength?: number;
    readonly truncated?: boolean;
  };
  readonly status: "ready" | "blocked";
  readonly warning?: string;
};

export type DesktopWorkSessionStage =
  | "drafting"
  | "queued"
  | "understanding"
  | "gathering_context"
  | "using_tools"
  | "awaiting_approval"
  | "composing_result"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

export type AgentDeliverableSection = {
  readonly sectionId: string;
  readonly title: string;
  readonly content: string;
  readonly evidenceRefs: readonly ObservationRef[];
};

export type AgentDeliverable = {
  readonly deliverableId: string;
  readonly runId: string;
  readonly title: string;
  readonly summary: string;
  readonly sections: readonly AgentDeliverableSection[];
  readonly evidenceRefs: readonly ObservationRef[];
  readonly toolDisplays: readonly ToolDisplayProjection[];
  readonly fileChanges: readonly ToolDisplayProjection[];
  readonly commands: readonly ToolDisplayProjection[];
  readonly nextActions: readonly string[];
  readonly createdAt: string;
};

export type ContextLedgerEntry = {
  readonly entryId: string;
  readonly kind: "goal" | "attachment" | "history" | "skill" | "tool_evidence" | "budget" | "truncation";
  readonly title: string;
  readonly summary: string;
  readonly refs: readonly ObservationRef[];
  readonly status: "used" | "truncated" | "omitted" | "blocked";
};

export type ContextLedger = {
  readonly runId: string;
  readonly summary: string;
  readonly entries: readonly ContextLedgerEntry[];
  readonly budget?: {
    readonly maxMessages?: number;
    readonly maxChars?: number;
    readonly usedChars?: number;
    readonly inputTokenBudget?: number;
    readonly reservedOutputTokens?: number;
    readonly estimatedInputTokens?: number;
    readonly budgetSource?: string;
  };
  readonly truncation: {
    readonly truncated: boolean;
    readonly omittedItemCount: number;
    readonly truncatedItemIds: readonly string[];
  };
};

export type DesktopWorkSessionAnswer = {
  readonly title: string;
  readonly content: string;
  readonly evidenceRefs: readonly ObservationRef[];
  readonly nextActions: readonly string[];
};

export type DesktopWorkSessionReadModel = {
  readonly run: BasicAgentRun;
  readonly stage: DesktopWorkSessionStage;
  readonly headline: string;
  readonly currentAction: string;
  readonly contextAttachments: readonly ContextAttachment[];
  readonly contextLedger: ContextLedger;
  readonly pendingConfirmation?: ConfirmationRequest;
  readonly answer?: DesktopWorkSessionAnswer;
  readonly deliverable?: AgentDeliverable;
  readonly visibleEvents: readonly RunEvent[];
  readonly safetySummary: {
    readonly summary: string;
    readonly pendingActionCount: number;
    readonly toolResultCount: number;
    readonly contextAttachmentCount: number;
  };
};
