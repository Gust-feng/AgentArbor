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
import type { SubAgentDefinition } from "./contracts/sub-agents";
import type { McpServerCatalogItem, ToolsResponse } from "./contracts/tools";
import { MULTI_AGENT_ENTRY_AVAILABLE } from "./app-multi-agent-availability";

export type AppBootstrapState = Pick<
  AppState,
  "config" | "tools" | "appUpdate" | "skills" | "subAgents" | "conversations" | "deepConversations" | "deepRuns"
>;

export async function loadAppBootstrap(signal?: AbortSignal): Promise<AppBootstrapState> {
  const deepConversationsRequest = MULTI_AGENT_ENTRY_AVAILABLE
    ? getJson<ListDeepConversationSummariesResponse>("/api/deep/conversations?limit=50", { signal })
    : Promise.resolve<ListDeepConversationSummariesResponse>({ ok: true, conversations: [] });
  const deepRunsRequest = MULTI_AGENT_ENTRY_AVAILABLE
    ? getJson<ListDeepRunSummariesResponse>("/api/deep/runs?limit=50", { signal })
    : Promise.resolve<ListDeepRunSummariesResponse>({ ok: true, runs: [] });
  const [config, tools, mcp, appUpdate, skills, subAgents, conversations, deepConversations, deepRuns] = await Promise.all([
    getJson<ConfigResponse>("/api/config", { signal }),
    getJson<ToolsResponse>("/api/config/tools", { signal }),
    getJson<{ readonly catalog?: readonly McpServerCatalogItem[] }>("/api/config/mcp", { signal }),
    getJson<AppUpdateInfo>("/api/app/update", { signal }),
    getJson<{ readonly skills: readonly SkillDefinition[] }>("/api/skills", { signal }),
    getJson<{ readonly subAgents: readonly SubAgentDefinition[] }>("/api/config/sub-agents", { signal }),
    getJson<{ readonly conversations: readonly ConversationSummary[] }>("/api/conversations", { signal }),
    deepConversationsRequest,
    deepRunsRequest,
  ]);
  return {
    config,
    tools: { ...tools, mcpCatalog: mcp.catalog ?? [] },
    appUpdate,
    skills: skills.skills ?? [],
    subAgents: subAgents.subAgents ?? [],
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