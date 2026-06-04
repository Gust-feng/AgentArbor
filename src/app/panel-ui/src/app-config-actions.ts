import { getJson, postJson } from "./api";
import {
  catalogRecordFromList,
  mergeConfigResponse,
  type VisibleAiMode,
} from "./app-config-projection";
import type { ModelForm, ToolForm } from "./components/settings-types";
import type { ConfigResponse, ModelProviderModelCatalog } from "./contracts/config";
import type { SkillDefinition } from "./contracts/skills";
import type { ToolsResponse } from "./contracts/tools";
import { parseModelOptionId } from "./model-options";

export async function saveModelProviderConfig(input: {
  readonly config: ConfigResponse | undefined;
  readonly form: ModelForm;
  readonly aiMode: VisibleAiMode;
}): Promise<ConfigResponse> {
  const existingProfile = input.config?.profiles?.some((profile) => profile.profileId === input.form.profileId) === true;
  const preset = existingProfile
    ? undefined
    : input.config?.modelProviderMarket?.presets?.find((item) => item.presetId === input.form.profileId);
  if (preset !== undefined) {
    const created = await postJson<ConfigResponse>("/api/config/model-profiles", {
      profileId: preset.presetId,
      label: input.form.label.trim() || preset.label,
      providerKind: preset.providerKind,
      protocolKind: input.form.protocolKind || preset.protocolKind,
      baseUrl: input.form.baseUrl || preset.baseUrl,
      model: input.form.model,
      clearModel: input.form.model.trim().length === 0,
      apiKey: input.form.apiKeyCleared ? undefined : input.form.apiKey,
      defaultAiMode: input.aiMode,
    });
    return mergeConfigResponse(
      created,
      await postJson<ConfigResponse>(`/api/config/model-profiles/${encodeURIComponent(preset.presetId)}/activate`, {})
    );
  }

  const updated = await postJson<ConfigResponse>("/api/config/model-provider", {
    profileId: input.form.profileId,
    label: input.form.label,
    baseUrl: input.form.baseUrl,
    protocolKind: input.form.protocolKind,
    model: input.form.model,
    clearModel: input.form.model.trim().length === 0,
    apiKey: input.form.apiKeyCleared ? undefined : input.form.apiKey,
    clearApiKey: input.form.apiKeyCleared,
    defaultAiMode: input.aiMode,
  });
  return input.form.profileId.length > 0 && input.config?.config?.profileId !== input.form.profileId
    ? mergeConfigResponse(
        updated,
        await postJson<ConfigResponse>(`/api/config/model-profiles/${encodeURIComponent(input.form.profileId)}/activate`, {})
      )
    : updated;
}

export async function createCustomModelProviderProfile(input: {
  readonly form: ModelForm;
  readonly aiMode: VisibleAiMode;
}): Promise<ConfigResponse> {
  const label = input.form.label.trim() || "自定义厂商";
  const created = await postJson<ConfigResponse>("/api/config/model-profiles", {
    profileId: label,
    label,
    providerKind: "openai_compatible",
    protocolKind: input.form.protocolKind || "openai_compatible_chat_completions",
    baseUrl: input.form.baseUrl,
    model: input.form.model,
    clearModel: input.form.model.trim().length === 0,
    defaultAiMode: input.aiMode,
    apiKey: input.form.apiKey,
  });
  const profileId = created.profile?.profileId ?? created.config?.profileId ?? label;
  return mergeConfigResponse(
    created,
    await postJson<ConfigResponse>(`/api/config/model-profiles/${encodeURIComponent(profileId)}/activate`, {})
  );
}

export async function revealModelProviderApiKey(profileId: string): Promise<string | undefined> {
  const response = await getJson<{ readonly apiKey?: string }>(
    `/api/config/model-profiles/${encodeURIComponent(profileId)}/api-key`
  );
  return typeof response.apiKey === "string" ? response.apiKey : undefined;
}

export async function selectModelProviderModel(input: {
  readonly config: ConfigResponse | undefined;
  readonly modelOptionId: string;
  readonly aiMode: VisibleAiMode;
}): Promise<{
  readonly config?: ConfigResponse;
  readonly form?: ModelForm;
}> {
  const parsed = parseModelOptionId(input.modelOptionId);
  if (parsed === undefined) return {};
  const profile = input.config?.profiles?.find((item) => item.profileId === parsed.profileId);
  if (profile === undefined) return {};
  const updated = await postJson<ConfigResponse>(`/api/config/model-profiles/${encodeURIComponent(parsed.profileId)}`, {
    model: parsed.modelId,
    defaultAiMode: input.aiMode,
  });
  const activated =
    input.config?.config?.profileId === parsed.profileId
      ? updated
      : mergeConfigResponse(updated, await postJson<ConfigResponse>(`/api/config/model-profiles/${encodeURIComponent(parsed.profileId)}/activate`, {}));
  return {
    config: activated,
    form: {
      profileId: parsed.profileId,
      label: profile.label ?? parsed.profileId,
      baseUrl: profile.baseUrl ?? "",
      protocolKind: profile.protocolKind ?? "openai_compatible_chat_completions",
      model: parsed.modelId,
      apiKey: "",
      apiKeyCleared: false,
    },
  };
}

export async function fetchModelProviderCatalog(profileId: string): Promise<{
  readonly catalog: ModelProviderModelCatalog;
  readonly catalogs?: readonly ModelProviderModelCatalog[];
}> {
  const response = await getJson<{
    readonly catalog: ModelProviderModelCatalog;
    readonly modelCatalogs?: readonly ModelProviderModelCatalog[];
  }>(`/api/config/model-profiles/${encodeURIComponent(profileId)}/models`);
  return {
    catalog: response.catalog,
    catalogs: response.modelCatalogs,
  };
}

export async function saveModelProviderCatalog(input: {
  readonly profileId: string;
  readonly catalog: ModelProviderModelCatalog;
}): Promise<readonly ModelProviderModelCatalog[]> {
  const response = await postJson<{
    readonly catalog: ModelProviderModelCatalog;
    readonly modelCatalogs?: readonly ModelProviderModelCatalog[];
  }>(`/api/config/model-profiles/${encodeURIComponent(input.profileId)}/model-catalog`, {
    label: input.catalog.label,
    baseUrl: input.catalog.baseUrl,
    modelsPath: input.catalog.modelsPath,
    fetchedAt: input.catalog.fetchedAt,
    models: input.catalog.models,
  });
  return response.modelCatalogs ?? [response.catalog];
}

export async function saveWorkspaceDirectory(workspaceDirectory: string): Promise<{ readonly workspaceDirectory?: string }> {
  const response = await postJson<{ readonly workspace: { readonly workspaceDirectory?: string } }>("/api/config/workspace", {
    workspaceDirectory,
  });
  return response.workspace;
}

export async function saveToolSettings(form: ToolForm): Promise<ToolsResponse> {
  return postJson<ToolsResponse>("/api/config/tools/web-search", {
    provider: form.provider,
    tavilyApiKey: form.tavilyApiKey,
    maxResults: Number(form.maxResults),
  });
}

export async function updateToolState(toolName: string, enabled: boolean): Promise<ToolsResponse> {
  return postJson<ToolsResponse>(`/api/config/tools/${encodeURIComponent(toolName)}/state`, {
    enabled,
  });
}

export async function updateSkillState(skillId: string, enabled: boolean): Promise<readonly SkillDefinition[]> {
  const response = await postJson<{ readonly skills: readonly SkillDefinition[] }>(`/api/skills/${encodeURIComponent(skillId)}/state`, {
    enabled,
  });
  return response.skills;
}

export function mergeCatalogsIntoConfig(
  config: ConfigResponse | undefined,
  catalogs: readonly ModelProviderModelCatalog[]
): ConfigResponse {
  return mergeConfigResponse(config, { modelCatalogs: catalogs });
}

export { catalogRecordFromList };
