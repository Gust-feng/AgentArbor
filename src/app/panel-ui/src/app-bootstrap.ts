import { getJson } from "./api";
import type { AppState } from "./app-state";
import type { ConfigResponse } from "./contracts/config";
import type { ConversationSummary } from "./contracts/conversation";
import type { DeepRunSummary, ListDeepRunSummariesResponse } from "./contracts/deep";
import type { SkillDefinition } from "./contracts/skills";
import type { McpServerCatalogItem, ToolsResponse } from "./contracts/tools";

export type AppBootstrapState = Pick<AppState, "config" | "tools" | "skills" | "conversations" | "deepRuns">;

export async function loadAppBootstrap(): Promise<AppBootstrapState> {
  const [config, tools, mcp, skills, conversations, deepRuns] = await Promise.all([
    getJson<ConfigResponse>("/api/config"),
    getJson<ToolsResponse>("/api/config/tools"),
    getJson<{ readonly catalog?: readonly McpServerCatalogItem[] }>("/api/config/mcp"),
    getJson<{ readonly skills: readonly SkillDefinition[] }>("/api/skills"),
    getJson<{ readonly conversations: readonly ConversationSummary[] }>("/api/conversations"),
    getJson<ListDeepRunSummariesResponse>("/api/deep/runs?limit=50"),
  ]);
  return {
    config,
    tools: { ...tools, mcpCatalog: mcp.catalog ?? [] },
    skills: skills.skills ?? [],
    conversations: conversations.conversations ?? [],
    deepRuns: deepRuns.runs ?? [],
  };
}

export function applyAppBootstrap(previous: AppState, bootstrap: AppBootstrapState): AppState {
  return {
    ...previous,
    ...bootstrap,
  };
}
