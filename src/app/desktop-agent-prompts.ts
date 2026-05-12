import type { ModelMessage } from "../domain/intelligence/index.js";
import type { SkillDefinition } from "../domain/basic-agent/index.js";
import type { TaskSoil } from "../domain/soil/index.js";
import { buildBasicAgentContextPack } from "./basic-agent-runtime/index.js";
import type { DesktopAgentConversationMessage } from "./desktop-agent-session.js";

export type DesktopAgentSkillContext = {
  readonly skill: SkillDefinition;
  readonly body: string;
  readonly triggerReason: string;
};

export function desktopAgentMessages(input: {
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly conversationHistory: readonly DesktopAgentConversationMessage[];
  readonly skillContexts?: readonly DesktopAgentSkillContext[];
}): readonly ModelMessage[] {
  return buildBasicAgentContextPack(input).messages;
}
