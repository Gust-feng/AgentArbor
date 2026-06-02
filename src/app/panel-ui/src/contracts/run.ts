import type { ObservationRef, TaskStatus } from "./common";
import type { ContextAttachment } from "./context";
import type { ToolDisplayProjection } from "./tools";

export type BasicAgentRun = {
  readonly runId: string;
  readonly conversationId?: string;
  readonly title: string;
  readonly goalSummary: string;
  readonly status: TaskStatus;
  readonly runMode: "agent" | "deep";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly currentStep?: string;
  readonly nextStep?: string;
  readonly requiresUserAction: boolean;
  readonly eventCursor: {
    readonly lastSequence: number;
    readonly eventCount: number;
  };
};

export type RunEvent = {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: string;
  readonly title: string;
  readonly summary?: string;
  readonly delta?: string;
  readonly status: TaskStatus;
  readonly timestamp: string;
  readonly refs: readonly ObservationRef[];
  readonly visibility: "compact" | "expanded" | "debug";
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
  };
};

export type PanelStreamEvent = {
  readonly eventId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: string;
  readonly createdAt: string;
  readonly agentLabel?: string;
  readonly summary?: string;
  readonly status?: string;
  readonly toolName?: string;
  readonly detail?: {
    readonly action?: string;
    readonly path?: string;
    readonly query?: string;
    readonly command?: string;
    readonly exitCode?: number;
    readonly preview?: string;
    readonly display?: ToolDisplayProjection;
    readonly error?: string;
    readonly truncated?: boolean;
  };
};

export type TranscriptNodeKind =
  | "thinking"
  | "tool"
  | "confirmation"
  | "user_decision"
  | "answer"
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

export type TranscriptConfirmation = {
  readonly confirmationId: string;
  readonly runId: string;
  readonly conversationId?: string;
  readonly title: string;
  readonly actionSummary: string;
  readonly affectedResources: readonly string[];
  readonly riskLevel: "low" | "medium" | "high";
  readonly resumeAvailability?: "live" | "lost_after_restart";
  readonly requestedAt: string;
  readonly expiresAt?: string;
  readonly sourceRefs: readonly string[];
};

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
  readonly confirmation?: TranscriptConfirmation;
  readonly refs: readonly ObservationRef[];
};

export type DesktopRunDetail = {
  readonly runId: string;
  readonly status: string;
  readonly error?: { readonly code: string; readonly message: string };
  readonly transcript?: {
    readonly events?: readonly PanelStreamEvent[];
    readonly transcriptNodes?: readonly TranscriptNode[];
  };
  readonly canvas?: {
    readonly kind?: string;
    readonly agent?: {
      readonly answer?: { readonly answer: string };
      readonly pendingConfirmation?: {
        readonly confirmationId: string;
        readonly title: string;
        readonly question: string;
        readonly consequence: string;
        readonly riskLevel: string;
        readonly resumeAvailability?: "live" | "lost_after_restart";
      };
      readonly context?: {
        readonly usageSummary?: string;
        readonly items?: readonly {
          readonly itemId: string;
          readonly sourceKind: string;
          readonly summary: string;
          readonly truncated?: boolean;
        }[];
      };
    };
    readonly workSession?: {
      readonly directAnswer?: { readonly answer: string };
      readonly report?: {
        readonly title?: string;
        readonly decisionSummary?: string;
        readonly nextActions?: readonly string[];
      };
    };
    readonly underground?: {
      readonly status?: string;
      readonly convergenceSummary?: string;
      readonly recommendedDirection?: { readonly reason?: string };
    };
  };
  readonly restoredResult?: {
    readonly title: string;
    readonly summary: string;
  };
};

export type PendingConfirmation = NonNullable<
  NonNullable<NonNullable<DesktopRunDetail["canvas"]>["agent"]>["pendingConfirmation"]
>;

export type AgentDeliverable = {
  readonly deliverableId: string;
  readonly runId: string;
  readonly title: string;
  readonly summary: string;
  readonly sections: readonly {
    readonly sectionId: string;
    readonly title: string;
    readonly content: string;
    readonly evidenceRefs: readonly ObservationRef[];
  }[];
  readonly evidenceRefs: readonly ObservationRef[];
  readonly toolDisplays: readonly ToolDisplayProjection[];
  readonly fileChanges: readonly ToolDisplayProjection[];
  readonly commands: readonly ToolDisplayProjection[];
  readonly nextActions: readonly string[];
  readonly createdAt: string;
};

export type DesktopWorkSessionAnswer = {
  readonly title: string;
  readonly content: string;
  readonly evidenceRefs: readonly ObservationRef[];
  readonly nextActions: readonly string[];
};

export type ContextLedger = {
  readonly runId: string;
  readonly summary: string;
  readonly entries: readonly {
    readonly entryId: string;
    readonly kind: "goal" | "attachment" | "history" | "skill" | "tool_evidence" | "budget" | "truncation";
    readonly title: string;
    readonly summary: string;
    readonly refs: readonly ObservationRef[];
    readonly status: "used" | "truncated" | "omitted" | "blocked";
  }[];
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

export type DesktopWorkSession = {
  readonly run: BasicAgentRun;
  readonly stage:
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
  readonly headline: string;
  readonly currentAction: string;
  readonly contextAttachments: readonly ContextAttachment[];
  readonly contextLedger: ContextLedger;
  readonly pendingConfirmation?: {
    readonly confirmationId: string;
    readonly runId: string;
    readonly conversationId?: string;
    readonly title: string;
    readonly actionSummary: string;
    readonly affectedResources: readonly string[];
    readonly riskLevel: "low" | "medium" | "high";
    readonly resumeAvailability?: "live" | "lost_after_restart";
    readonly requestedAt: string;
    readonly sourceRefs: readonly string[];
  };
  readonly answer?: DesktopWorkSessionAnswer;
  readonly deliverable?: AgentDeliverable;
  readonly visibleEvents: readonly RunEvent[];
  readonly transcriptNodes?: readonly TranscriptNode[];
  readonly safetySummary: {
    readonly summary: string;
    readonly pendingActionCount: number;
    readonly toolResultCount: number;
    readonly contextAttachmentCount: number;
  };
};
