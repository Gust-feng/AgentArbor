import { getJson } from "./api";
import type { AppState } from "./app-state";
import type { ConfigResponse } from "./contracts/config";
import type { ConversationSummary } from "./contracts/conversation";
import type { SkillDefinition } from "./contracts/skills";
import type { ToolsResponse } from "./contracts/tools";

export type AppBootstrapState = Pick<AppState, "config" | "tools" | "skills" | "conversations">;

export async function loadAppBootstrap(): Promise<AppBootstrapState> {
  const [config, tools, skills, conversations] = await Promise.all([
    getJson<ConfigResponse>("/api/config"),
    getJson<ToolsResponse>("/api/config/tools"),
    getJson<{ readonly skills: readonly SkillDefinition[] }>("/api/skills"),
    getJson<{ readonly conversations: readonly ConversationSummary[] }>("/api/conversations"),
  ]);
  return {
    config,
    tools,
    skills: skills.skills ?? [],
    conversations: conversations.conversations ?? [],
  };
}

export function applyAppBootstrap(previous: AppState, bootstrap: AppBootstrapState): AppState {
  return {
    ...previous,
    ...bootstrap,
  };
}
