import type { SkillDefinition, SkillSelectionDecisionFacts } from "../../domain/basic-agent/index.js";
import type { ToolFactValue } from "../../domain/tools/index.js";

export type DesktopAgentConversationMessage = {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly ref?: string;
};

export type DesktopAgentInterruptedRunContext = {
  readonly runId: string;
  readonly turnStatus: "blocked" | "needs_input" | "failed" | "cancelled";
  readonly stopReason?: string;
  readonly continuationAvailability?: "none" | "live" | "lost_after_restart" | "new_turn";
  readonly message?: string;
  readonly partialOutput?: string;
  readonly refs: readonly string[];
};

export type DesktopAgentPriorToolCallContext = {
  readonly runId: string;
  readonly callId: string;
  readonly toolName: string;
  readonly status: "requested" | "approval_required" | "completed" | "failed" | "cancelled";
  readonly input?: ToolFactValue;
  readonly output?: ToolFactValue;
  readonly error?: string;
  readonly errorDomain?: string;
  readonly errorFacts?: ToolFactValue;
  readonly factTruncation?: {
    readonly input?: true;
    readonly output?: true;
    readonly errorFacts?: true;
  };
  readonly refs: readonly string[];
};

export type DesktopAgentSkillLoadStatus = "loaded" | "failed";

export type DesktopAgentSkillMarkUsedStatus = "succeeded" | "failed" | "skipped";

export type DesktopAgentSkillContext = {
  readonly skill: SkillDefinition;
  readonly body: string;
  readonly triggerReason: string;
  readonly selectedAt?: string;
  readonly loadStatus?: DesktopAgentSkillLoadStatus;
  readonly loadedAt?: string;
  readonly bodyHash?: string;
  readonly contentHash?: string;
  readonly bodyCharCount?: number;
  readonly truncated?: boolean;
  readonly omitted?: boolean;
  readonly error?: string;
  readonly warning?: string;
  readonly markUsedStatus?: DesktopAgentSkillMarkUsedStatus;
  readonly summary?: string;
  readonly selection?: SkillSelectionDecisionFacts;
};
