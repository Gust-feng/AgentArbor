import type { RunAgentDefinitionRef } from "../config/contracts.js";
import type { ConfirmationRequest } from "../confirmation/contracts.js";
import type { ModelUsage } from "../intelligence/contracts.js";
import type { ObservationRef } from "../observation/contracts.js";
import type { ToolDisplayProjection } from "../observation/tool-display.js";
import type {
  ToolErrorDomain,
  ToolErrorFacts,
} from "../tools/contracts.js";
export type {
  ConfirmationDecision,
  ConfirmationRequest,
  ConfirmationRiskLevel,
} from "../confirmation/contracts.js";

/** User-facing approval projection scoped by the feature-owned run. */
export type OwnerScopedConfirmationRequest = ConfirmationRequest & {
  readonly ownerRunId: string;
};

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

export type SkillJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly SkillJsonValue[]
  | { readonly [key: string]: SkillJsonValue };

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
  /** The parent AgentTool fact for a nested sub-agent mechanical action. */
  readonly parentToolCallFactId?: string;
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
  /** The parent AgentTool fact for a nested sub-agent mechanical action. */
  readonly parentToolCallFactId?: string;
  readonly display?: ToolDisplayProjection;
  readonly confirmation?: OwnerScopedConfirmationRequest;
  readonly modelUsage?: ModelUsage;
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
  readonly sourceKind?: "project" | "user" | "plugin" | "admin" | "custom";
  readonly sourceRootId?: string;
  readonly sourcePrecedence?: number;
  readonly stateKey?: string;
  readonly loadError?: string;
  readonly version?: string;
  readonly provenance?: Readonly<Record<string, SkillJsonValue>>;
  readonly whenToUse?: string;
  readonly disableModelInvocation?: boolean;
  readonly userInvocable?: boolean;
  readonly scripts?: readonly string[];
  readonly references?: readonly string[];
  readonly assets?: readonly string[];
  readonly allowedTools?: readonly string[];
  readonly resources?: readonly {
    readonly kind: "script" | "reference" | "asset";
    readonly name: string;
    readonly relativePath?: string;
    readonly sourcePath: string;
    readonly contentHash?: string;
    readonly byteLength?: number;
    readonly loadError?: string;
  }[];
  readonly resourceIndex?: readonly {
    readonly type: "script" | "reference" | "asset" | "eval";
    readonly relativePath: string;
    readonly exists: boolean;
    readonly contentHash?: string;
    readonly byteLength?: number;
  }[];
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
    readonly mimeType?: string;
    readonly truncated?: boolean;
  };
  readonly mediaPreview?: {
    readonly kind: "image";
    readonly url: string;
    readonly mimeType: string;
    readonly byteLength?: number;
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

export type SkillSelectionMethod =
  | "explicit"
  | "model"
  | "keyword"
  | "keyword_fallback"
  | "mixed"
  | "unknown"
  | (string & {});

export type SkillSelectionDecisionReason = {
  readonly code: string;
  readonly summary: string;
  readonly skillId?: string;
  readonly skillName?: string;
  readonly confidence?: number;
};

export type SkillSelectionDecisionFacts = {
  readonly selectionMethod: SkillSelectionMethod;
  readonly modelCallRef?: string;
  readonly candidateSkillIds: readonly string[];
  readonly selectedSkillIds: readonly string[];
  readonly omittedReasons?: readonly SkillSelectionDecisionReason[];
  readonly rejectedReasons?: readonly SkillSelectionDecisionReason[];
  readonly confidence?: number;
  readonly reasonSummary?: string;
};

export type DesktopWorkViewAnswer = {
  readonly title: string;
  readonly content: string;
  readonly evidenceRefs: readonly ObservationRef[];
  readonly nextActions: readonly string[];
};

export type DesktopWorkViewReadModel = {
  readonly run: BasicAgentRun;
  readonly stage: DesktopWorkViewStage;
  readonly headline: string;
  readonly currentAction: string;
  readonly contextAttachments: readonly ContextAttachment[];
  readonly pendingConfirmation?: OwnerScopedConfirmationRequest;
  readonly answer?: DesktopWorkViewAnswer;
  readonly deliverable?: AgentDeliverable;
  readonly visibleEvents: readonly RunEvent[];
  readonly transcriptNodes: readonly TranscriptNode[];
  readonly workSummary: {
    readonly summary: string;
    readonly pendingActionCount: number;
    readonly toolResultCount: number;
    readonly contextAttachmentCount: number;
  };
};
