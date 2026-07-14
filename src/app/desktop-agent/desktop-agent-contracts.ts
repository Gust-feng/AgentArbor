import type { SkillDefinition, SkillSelectionDecisionFacts } from "../../domain/basic-agent/index.js";

export type DesktopAgentConversationMessage = {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly ref?: string;
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
