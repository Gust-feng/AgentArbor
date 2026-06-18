import type { RunAgentDefinitionRef } from "../config/contracts.js";
import type { ObservationRef } from "../observation/contracts.js";
import type {
  ToolDisplayProjection,
  ToolErrorDomain,
  ToolErrorFacts,
  ToolResultEnvelope,
} from "../tools/contracts.js";
import type { ConfirmationRequest } from "./confirmation-contracts.js";
export type { ConfirmationDecision, ConfirmationRequest, ConfirmationRiskLevel } from "./confirmation-contracts.js";

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
  readonly agentDefinitionRef?: RunAgentDefinitionRef;
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
  readonly delta?: string;
  readonly status: AgentTaskStatus;
  readonly timestamp: string;
  readonly toolName?: string;
  readonly refs: readonly ObservationRef[];
  readonly visibility: RunEventVisibility;
  readonly detail?: {
    readonly action?: string;
    readonly path?: string;
    readonly query?: string;
    readonly command?: string;
    readonly exitCode?: number;
    readonly preview?: string;
    readonly display?: ToolDisplayProjection;
    readonly envelope?: ToolResultEnvelope;
    readonly truncated?: boolean;
    readonly error?: string;
    readonly errorDomain?: ToolErrorDomain;
    readonly errorFacts?: ToolErrorFacts;
  };
};

export type TranscriptNodeKind =
  | "thinking"
  | "tool"
  | "confirmation"
  | "user_decision"
  | "answer"
  | "body"
  | "system";

export type TranscriptNodePhase =
  | "noted"
  | "preparing"
  | "waiting_approval"
  | "approved"
  | "denied"
  | "guidance"
  | "executing"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export type TranscriptNode = {
  readonly nodeId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly kind: TranscriptNodeKind;
  readonly phase: TranscriptNodePhase;
  readonly title: string;
  readonly summary?: string;
  readonly text?: string;
  readonly timestamp: string;
  readonly toolName?: string;
  readonly display?: ToolDisplayProjection;
  readonly confirmation?: ConfirmationRequest;
  readonly refs: readonly ObservationRef[];
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
  readonly readonlyPreview?: {
    readonly title?: string;
    readonly text: string;
    readonly truncated: boolean;
  };
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

export type DesktopWorkViewStage =
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
    readonly maxInputTokens?: number;
    readonly usedInputTokens?: number;
    readonly tokenCountSource?: string;
    readonly maxChars?: number;
    readonly usedChars?: number;
    readonly inputTokenBudget?: number;
    readonly reservedOutputTokens?: number;
    readonly budgetSource?: string;
  };
  readonly truncation: {
    readonly truncated: boolean;
    readonly omittedItemCount: number;
    readonly truncatedItemIds: readonly string[];
  };
};

export type DesktopWorkViewAnswer = {
  readonly title: string;
  readonly content: string;
  readonly evidenceRefs: readonly ObservationRef[];
  readonly nextActions: readonly string[];
};

export type TriggeredSkillReadModel = {
  readonly skillId: string;
  readonly name: string;
  readonly triggerReason: string;
  readonly summary: string;
  readonly sourceRef: string;
  readonly truncated: boolean;
};

export type DesktopWorkViewReadModel = {
  readonly run: BasicAgentRun;
  readonly stage: DesktopWorkViewStage;
  readonly headline: string;
  readonly currentAction: string;
  readonly contextAttachments: readonly ContextAttachment[];
  readonly contextLedger: ContextLedger;
  readonly triggeredSkills: readonly TriggeredSkillReadModel[];
  readonly pendingConfirmation?: ConfirmationRequest;
  readonly answer?: DesktopWorkViewAnswer;
  readonly deliverable?: AgentDeliverable;
  readonly toolEvidence: readonly ToolResultEnvelope[];
  readonly visibleEvents: readonly RunEvent[];
  readonly transcriptNodes: readonly TranscriptNode[];
  readonly safetySummary: {
    readonly summary: string;
    readonly pendingActionCount: number;
    readonly toolResultCount: number;
    readonly contextAttachmentCount: number;
  };
};

/**
 * @deprecated Historical panel state name. New ordinary Agent read-model code
 * should use DesktopWorkView* names.
 */
export type DesktopWorkSessionStage = DesktopWorkViewStage;

/**
 * @deprecated Historical panel state name. New ordinary Agent read-model code
 * should use DesktopWorkView* names.
 */
export type DesktopWorkSessionAnswer = DesktopWorkViewAnswer;

/**
 * @deprecated Historical panel state name. New ordinary Agent read-model code
 * should use DesktopWorkView* names.
 */
export type DesktopWorkSessionReadModel = DesktopWorkViewReadModel;
