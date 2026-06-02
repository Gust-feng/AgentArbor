import { modelProviderDisplayName, resolveModelProviderIdentity } from "./model-provider-logos";
import type { ConfigResponse, ModelProviderModelCatalog } from "./contracts/config";

export type ComposerReasoningEffort = "" | "low" | "medium" | "high";
export type VisibleAiMode = "none" | "fake" | "openai-compatible" | "openai-responses";

export function mergeConfigResponse(previous: ConfigResponse | undefined, incoming: ConfigResponse): ConfigResponse {
  return {
    ...previous,
    ...incoming,
    config: incoming.config ?? incoming.profile ?? previous?.config,
    profiles: incoming.profiles ?? previous?.profiles,
    modelProviderMarket: incoming.modelProviderMarket ?? previous?.modelProviderMarket,
    modelCatalogs: incoming.modelCatalogs ?? previous?.modelCatalogs,
    workspace: incoming.workspace ?? previous?.workspace,
    capabilities: incoming.capabilities ?? previous?.capabilities,
  };
}

export function normalizeVisibleAiMode(mode: VisibleAiMode | undefined): VisibleAiMode {
  return mode === "none" ||
    mode === "fake" ||
    mode === "openai-compatible" ||
    mode === "openai-responses"
    ? mode
    : "openai-compatible";
}

export function visibleConfigLabel(config: NonNullable<ConfigResponse["config"]>): string {
  const identity = resolveModelProviderIdentity({
    title: config.label,
    profileId: config.profileId,
    baseUrl: config.baseUrl,
    model: config.model,
  });
  return identity === "unknown" ? config.label ?? "" : modelProviderDisplayName(identity);
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
