import type { ConfigResponse, ModelProviderModelCatalog, ToolConfirmationPolicy } from "./contracts/config";

export type ComposerReasoningEffort = "" | "low" | "medium" | "high";
export type ComposerToolConfirmationPolicy = ToolConfirmationPolicy;
export type VisibleAiMode = "none" | "openai-compatible" | "openai-responses";

/**
 * Agent 模式选择：用户在 Desktop Shell 入口处显式选择的 agent 运行路径。
 *
 * 与 {@link VisibleAiMode} 严格区分：
 * - VisibleAiMode 是模型 provider 选择（none/openai-compatible/openai-responses），
 *   决定走哪个模型接入层；
 * - AgentMode 是 agent 运行编排路径（普通 Agent 主循环 / Deep 地下认知运行时），
 *   决定提交目标（/api/conversations vs /api/deep/*）和视图投影。
 *
 * 默认 "normal"（普通 Agent），"deep" 为显式深入入口（FR-001）。
 */
export type AgentMode = "normal" | "deep";

export function mergeConfigResponse(previous: ConfigResponse | undefined, incoming: ConfigResponse): ConfigResponse {
  return {
    ...previous,
    ...incoming,
    product: incoming.product ?? previous?.product,
    appearance: incoming.appearance ?? previous?.appearance,
    config: incoming.config ?? incoming.profile ?? previous?.config,
    profiles: incoming.profiles ?? previous?.profiles,
    modelProviderOrder: incoming.modelProviderOrder ?? previous?.modelProviderOrder,
    modelProviderMarket: incoming.modelProviderMarket ?? previous?.modelProviderMarket,
    modelCatalogs: incoming.modelCatalogs ?? previous?.modelCatalogs,
    modelCapabilityProfiles: incoming.modelCapabilityProfiles ?? previous?.modelCapabilityProfiles,
    commandShell: incoming.commandShell ?? previous?.commandShell,
    toolConfirmation: incoming.toolConfirmation ?? previous?.toolConfirmation,
    desktopAgent: incoming.desktopAgent ?? previous?.desktopAgent,
    skillTrigger: incoming.skillTrigger ?? previous?.skillTrigger,
    capabilities: incoming.capabilities ?? previous?.capabilities,
  };
}
export function normalizeVisibleAiMode(mode: VisibleAiMode | undefined): VisibleAiMode {
  return mode === "none" ||
    mode === "openai-compatible" ||
    mode === "openai-responses"
    ? mode
    : "openai-compatible";
}

/**
 * 归一化 agent 模式：仅接受显式 "deep"，其余一律回退到默认 "normal"。
 * 防止后端投影或本地存储中的未知值泄漏到 UI 入口。
 */
export function normalizeAgentMode(mode: AgentMode | undefined): AgentMode {
  return mode === "deep" ? "deep" : "normal";
}

export function normalizeComposerToolConfirmationPolicy(
  policy: ComposerToolConfirmationPolicy | undefined
): ComposerToolConfirmationPolicy {
  return policy === "full_access" ? "full_access" : "prompt";
}

export function visibleConfigLabel(config: NonNullable<ConfigResponse["config"]>): string {
  return config.label ?? "";
}

export function visibleConfigBaseUrl(config: NonNullable<ConfigResponse["config"]>): string {
  const baseUrl = config.baseUrl ?? "";
  if (config.profileId === "default" && (baseUrl.length === 0 || baseUrl === "https://api.openai.com")) {
    return "https://api.openai.com/v1";
  }
  return baseUrl;
}

export function runReasoningSettings(
  reasoningEffort: ComposerReasoningEffort,
  supportsReasoningEffort: boolean
): { readonly reasoningEffort?: Exclude<ComposerReasoningEffort, ""> } {
  if (!supportsReasoningEffort || reasoningEffort.length === 0) {
    return {};
  }
  return { reasoningEffort: reasoningEffort as Exclude<ComposerReasoningEffort, ""> };
}

export function catalogRecordFromList(catalogs: readonly ModelProviderModelCatalog[]): Record<string, ModelProviderModelCatalog> {
  const record: Record<string, ModelProviderModelCatalog> = {};
  for (const catalog of catalogs) {
    if (catalog.profileId.trim().length > 0) {
      record[catalog.profileId] = catalog;
    }
  }
  return record;
}
