import { getJson } from "./api";
import type { AppState } from "./app-state";
import type { AppUpdateInfo } from "./contracts/app-update";
import type { ConfigResponse } from "./contracts/config";
import type { ConversationSummary } from "./contracts/conversation";
import type {
  ListDeepConversationSummariesResponse,
  ListDeepRunSummariesResponse,
} from "./contracts/deep";
import type { SkillDefinition } from "./contracts/skills";
import type { McpServerCatalogItem, ToolsResponse } from "./contracts/tools";

export type AppBootstrapState = Pick<
  AppState,
  "config" | "tools" | "appUpdate" | "skills" | "conversations" | "deepConversations" | "deepRuns"
>;

export async function loadAppBootstrap(): Promise<AppBootstrapState> {
  const [config, tools, mcp, appUpdate, skills, conversations, deepConversations, deepRuns] = await Promise.all([
    getJson<ConfigResponse>("/api/config"),
    getJson<ToolsResponse>("/api/config/tools"),
    getJson<{ readonly catalog?: readonly McpServerCatalogItem[] }>("/api/config/mcp"),
    getJson<AppUpdateInfo>("/api/app/update"),
    getJson<{ readonly skills: readonly SkillDefinition[] }>("/api/skills"),
    getJson<{ readonly conversations: readonly ConversationSummary[] }>("/api/conversations"),
    getJson<ListDeepConversationSummariesResponse>("/api/deep/conversations?limit=50"),
    getJson<ListDeepRunSummariesResponse>("/api/deep/runs?limit=50"),
  ]);
  return {
    config,
    tools: { ...tools, mcpCatalog: mcp.catalog ?? [] },
    appUpdate,
    skills: skills.skills ?? [],
    conversations: conversations.conversations ?? [],
    deepConversations: deepConversations.conversations ?? [],
    deepRuns: deepRuns.runs ?? [],
  };
}

export function applyAppBootstrap(previous: AppState, bootstrap: AppBootstrapState): AppState {
  return {
    ...previous,
    ...bootstrap,
  };
}
