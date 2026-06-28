import { createHash } from "node:crypto";
import type { SanitizedDesktopAgentConfig } from "../../domain/config/index.js";
import type { AgentDefinition } from "./contracts.js";

const USER_CONFIGURED_DESKTOP_PROMPT_REF = "prompt:desktop-root-agent:user-configured";

export function desktopAgentDefinitionFromConfig(
  baseDefinition: AgentDefinition,
  config: SanitizedDesktopAgentConfig
): AgentDefinition {
  if (config.isDefault) {
    return baseDefinition;
  }
  return {
    ...baseDefinition,
    prompt: {
      ...baseDefinition.prompt,
      promptRef: USER_CONFIGURED_DESKTOP_PROMPT_REF,
      version: `user-${systemPromptFingerprint(config.systemPrompt)}`,
      systemPrompt: config.systemPrompt,
    },
  };
}

function systemPromptFingerprint(systemPrompt: string): string {
  return createHash("sha256").update(systemPrompt).digest("hex").slice(0, 12);
}
