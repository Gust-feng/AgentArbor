import type { ModelOutputContract, ModelPurpose, ModelRequest } from "../../domain/intelligence/index.js";

export type AgentSystemPromptSpec = {
  readonly promptRef: string;
  readonly version: string;
  readonly systemPrompt: string;
};

export type AgentToolVisibilityProfile = {
  readonly profileId: string;
  readonly runMode: "agent" | "deep";
  readonly hiddenToolNamePrefixes: readonly string[];
};

export type AgentTurnPolicySpec = {
  readonly allowModel: boolean;
  readonly fallback: "deterministic" | "disabled";
  readonly purpose: ModelPurpose;
  readonly sensitivity: ModelRequest["sensitivity"];
  readonly defaultMaxOutputTokens: number;
};

export type AgentDefinition = {
  readonly agentId: string;
  readonly displayName: string;
  readonly prompt: AgentSystemPromptSpec;
  readonly turnPolicy: AgentTurnPolicySpec;
  readonly outputContract: ModelOutputContract;
  readonly toolVisibilityProfile: AgentToolVisibilityProfile;
};

export function isToolVisibleToAgentProfile(
  profile: AgentToolVisibilityProfile,
  toolName: string
): boolean {
  return !profile.hiddenToolNamePrefixes.some((prefix) => toolName.startsWith(prefix));
}

export function filterToolNamesVisibleToAgentProfile(
  profile: AgentToolVisibilityProfile,
  toolNames: readonly string[]
): readonly string[] {
  return toolNames.filter((toolName) => isToolVisibleToAgentProfile(profile, toolName));
}
