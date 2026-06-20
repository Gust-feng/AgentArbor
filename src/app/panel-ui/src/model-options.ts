import type { ChatModelOption } from "./components/chat-empty";
import { resolveModelIconSvgForModel } from "./model-icons";
import { modelProviderSortRank, resolveModelProviderIdentity } from "./model-provider-logos";
import type { ConfigResponse, ModelProviderModelCatalog } from "./contracts/config";

type ConfigModelProfile = NonNullable<ConfigResponse["profiles"]>[number];
type ConfigModelProfileWithId = ConfigModelProfile & { readonly profileId: string };

export function modelOptionsFromConfig(
  config: ConfigResponse | undefined,
  catalogs: Readonly<Record<string, ModelProviderModelCatalog>>
): readonly ChatModelOption[] {
  const order = config?.modelProviderOrder ?? [];
  return (config?.profiles ?? [])
    .filter(modelProfileHasId)
    .map((profile, index) => ({ profile, index }))
    .sort((left, right) => {
      const leftOrder = orderIndex(order, `profile:${left.profile.profileId}`);
      const rightOrder = orderIndex(order, `profile:${right.profile.profileId}`);
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      const rankDelta = modelProviderSortRank({
        title: left.profile.label,
        profileId: left.profile.profileId,
        baseUrl: left.profile.baseUrl,
        model: left.profile.model,
      }) - modelProviderSortRank({
        title: right.profile.label,
        profileId: right.profile.profileId,
        baseUrl: right.profile.baseUrl,
        model: right.profile.model,
      });
      return rankDelta === 0 ? left.index - right.index : rankDelta;
    })
    .flatMap(({ profile }) => {
      const catalog = catalogs[profile.profileId];
      const identity = resolveModelProviderIdentity({
        title: profile.label ?? catalog?.label,
        profileId: profile.profileId,
        baseUrl: profile.baseUrl ?? catalog?.baseUrl,
        model: profile.model,
      });
      const label = profile.label ?? catalog?.label ?? profile.profileId;
      return modelCatalogItemsWithConfiguredModel(catalog?.models ?? [], profile.model, label)
        .filter((model) => model.id.trim().length > 0)
        .map((model) => ({
          id: modelOptionId(profile.profileId, model.id),
          name: model.displayName || model.id,
          label,
          providerLabel: label,
          providerIdentity: identity,
          profileId: profile.profileId,
          modelId: model.id,
          iconSvg: shouldShowProviderIcon(profile)
            ? resolveModelIconSvgForModel({ providerIdentity: identity, modelId: model.id, displayName: model.displayName })
            : undefined,
        }));
    });
}

export function selectedModelOptionId(config: ConfigResponse | undefined, options: readonly ChatModelOption[]): string {
  const profileId = config?.config?.profileId;
  const model = config?.config?.model;
  if (profileId === undefined || model === undefined) return "";
  const selectedId = modelOptionId(profileId, model);
  return options.some((option) => option.id === selectedId) ? selectedId : "";
}

export function modelOptionSupportsReasoningEffort(
  config: ConfigResponse | undefined,
  optionId: string
): boolean {
  if (optionId.length === 0) {
    return config?.capabilities?.modelCapabilities?.supportsReasoningEffort === true;
  }
  const parsed = parseModelOptionId(optionId);
  if (parsed === undefined) return false;
  const profile =
    config?.profiles?.find((item) => item.profileId === parsed.profileId) ??
    (config?.config?.profileId === parsed.profileId ? config.config : undefined);
  if (profile === undefined) return false;
  return modelLooksReasoningEffortCapable({
    profileId: parsed.profileId,
    providerKind: profile.providerKind,
    protocolKind: profile.protocolKind,
    baseUrl: profile.baseUrl,
    label: profile.label,
    model: parsed.modelId,
  });
}

export function parseModelOptionId(value: string): { readonly profileId: string; readonly modelId: string } | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
    const [profileId, modelId] = parsed;
    if (typeof profileId !== "string" || typeof modelId !== "string") return undefined;
    if (profileId.trim().length === 0 || modelId.trim().length === 0) return undefined;
    return { profileId, modelId };
  } catch {
    return undefined;
  }
}

function modelProfileHasId(profile: ConfigModelProfile): profile is ConfigModelProfileWithId {
  return typeof profile.profileId === "string" && profile.profileId.trim().length > 0;
}

function shouldShowProviderIcon(profile: ConfigModelProfile): boolean {
  return profile.secretConfigured === true &&
    profile.defaultAiMode !== "fake" &&
    profile.defaultAiMode !== "none";
}

function modelCatalogItemsWithConfiguredModel(
  models: readonly ModelProviderModelCatalog["models"][number][],
  configuredModel: string | undefined,
  owner: string
): readonly ModelProviderModelCatalog["models"][number][] {
  const modelId = configuredModel?.trim();
  if (modelId === undefined || modelId.length === 0 || models.some((model) => model.id === modelId)) {
    return models;
  }
  return [
    {
      id: modelId,
      displayName: modelId,
      owner,
    },
    ...models,
  ];
}

function modelOptionId(profileId: string, modelId: string): string {
  return JSON.stringify([profileId, modelId]);
}

function orderIndex(order: readonly string[], key: string): number {
  const index = order.indexOf(key);
  if (index !== -1) return index;
  if (key.startsWith("profile:")) {
    const presetIndex = order.indexOf(`preset:${key.slice("profile:".length)}`);
    if (presetIndex !== -1) return presetIndex;
  }
  return Number.MAX_SAFE_INTEGER;
}

function modelLooksReasoningEffortCapable(input: {
  readonly profileId?: string;
  readonly providerKind?: string;
  readonly protocolKind?: string;
  readonly baseUrl?: string;
  readonly label?: string;
  readonly model: string;
}): boolean {
  if (input.providerKind !== undefined && input.providerKind !== "openai_compatible") {
    return false;
  }
  const model = input.model.toLowerCase();
  const providerSignals = `${input.profileId ?? ""} ${input.label ?? ""} ${input.baseUrl ?? ""}`.toLowerCase();
  if (providerSignals.includes("deepseek") && model.includes("deepseek-v4")) {
    return true;
  }
  const openAiProvider =
    providerSignals.includes("api.openai.com") ||
    providerSignals.includes("openai") ||
    (providerSignals.includes("default") && (input.baseUrl ?? "").trim().length === 0);
  if (!openAiProvider) {
    return false;
  }
  return (
    model.includes("gpt-5") ||
    model.includes("gpt-5.4") ||
    model.includes("gpt-5.5") ||
    model.includes("o3") ||
    model.includes("o4")
  );
}
