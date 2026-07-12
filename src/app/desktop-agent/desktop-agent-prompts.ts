import type { ModelCapabilities } from "../../domain/config/index.js";
import type { ModelMessage } from "../../domain/intelligence/index.js";
import type { TaskSoil } from "../../domain/soil/index.js";
import type { AgentDefinition } from "../agent-prompts/contracts.js";
import { DESKTOP_ROOT_AGENT } from "../agent-prompts/desktop-root-agent.js";
import {
  buildBasicAgentContextPack,
  type BasicAgentContextPack,
} from "../basic-agent-runtime/context-pack.js";
import type { BasicAgentConversationSummary, BasicAgentTokenCounter } from "../basic-agent-runtime/index.js";
import type {
  DesktopAgentConversationMessage,
  DesktopAgentInterruptedRunContext,
  DesktopAgentSkillContext,
} from "./desktop-agent-contracts.js";
export type { DesktopAgentSkillContext } from "./desktop-agent-contracts.js";

export type DesktopAgentContextPackInput = {
  readonly agentDefinition?: AgentDefinition;
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly conversationHistory: readonly DesktopAgentConversationMessage[];
  readonly conversationSummary?: BasicAgentConversationSummary;
  readonly interruptedRunContexts?: readonly DesktopAgentInterruptedRunContext[];
  readonly skillContexts?: readonly DesktopAgentSkillContext[];
  readonly modelCapabilities?: ModelCapabilities;
  readonly tokenCounter?: BasicAgentTokenCounter;
  readonly maxMessages?: number;
  readonly maxChars?: number;
  readonly maxInputTokens?: number;
};

export function desktopAgentContextPack(input: DesktopAgentContextPackInput): BasicAgentContextPack {
  return buildBasicAgentContextPack({
    ...input,
    agentDefinition: input.agentDefinition ?? DESKTOP_ROOT_AGENT,
  });
}

export function desktopAgentMessages(input: DesktopAgentContextPackInput): readonly ModelMessage[] {
  return desktopAgentContextPack(input).messages;
}
