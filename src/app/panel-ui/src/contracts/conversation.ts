import type {
  BasicAgentRunView,
} from "./run";

export type ConversationTurn = {
  readonly turnId: string;
  readonly role: "user" | "assistant";
  readonly title?: string;
  readonly content: string;
  readonly status: string;
  readonly runId?: string;
  readonly responseModel?: {
    readonly profileId: string;
    readonly label?: string;
    readonly providerKind?: string;
    readonly protocolKind?: string;
    readonly baseUrl?: string;
    readonly model?: string;
  };
};

export type Conversation = {
  readonly conversationId: string;
  readonly title: string;
  readonly titleEditedAt?: string;
  readonly turns: readonly ConversationTurn[];
  readonly activeRunId?: string;
  readonly latestRunId?: string;
  readonly currentRun?: BasicAgentRunView;
  readonly queuedRunIds?: readonly string[];
  readonly pinnedAt?: string;
  readonly updatedAt?: string;
};

export type ConversationSummary = {
  readonly conversationId: string;
  readonly title: string;
  readonly titleEditedAt?: string;
  readonly preview?: string;
  readonly currentAction?: string;
  readonly nextStep?: string;
  readonly status?: string;
  readonly activeRunId?: string;
  readonly latestRunId?: string;
  readonly queuedRunIds?: readonly string[];
  readonly queuedRunCount?: number;
  readonly pinnedAt?: string;
  readonly updatedAt?: string;
  readonly requiresUserAction?: boolean;
};
