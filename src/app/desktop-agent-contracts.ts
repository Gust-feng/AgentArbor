import type { SkillDefinition } from "../domain/basic-agent/index.js";

export type DesktopAgentConversationMessage = {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly ref?: string;
};

export type DesktopAgentSkillContext = {
  readonly skill: SkillDefinition;
  readonly body: string;
  readonly triggerReason: string;
};
