import type { ModelMessage } from "../domain/intelligence/index.js";
import type { TaskSoil } from "../domain/soil/index.js";
import { buildBasicAgentContextPack } from "./basic-agent-runtime/context-pack.js";
import type { DesktopAgentConversationMessage, DesktopAgentSkillContext } from "./desktop-agent-contracts.js";
export type { DesktopAgentSkillContext } from "./desktop-agent-contracts.js";

export function desktopAgentMessages(input: {
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly conversationHistory: readonly DesktopAgentConversationMessage[];
  readonly skillContexts?: readonly DesktopAgentSkillContext[];
}): readonly ModelMessage[] {
  return buildBasicAgentContextPack(input).messages;
}
