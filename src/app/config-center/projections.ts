import type {
  AgentArborLocalSettings,
  LocalDevSecretStore,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
  SanitizedWebSearchConfig,
  SanitizedWorkspaceConfig,
  ModelProviderProfileSettings,
} from "../../domain/config/index.js";
import {
  DEFAULT_MODEL_PROVIDER_BASE_URL,
  normalizeBaseUrl,
} from "./model-provider-settings.js";
import { normalizeInformationAccessSettings } from "./settings-schema.js";
import { normalizeConfiguredWorkspaceDirectory } from "./workspace-settings.js";

export async function toSanitizedModelProviderConfig(input: {
  readonly settings: AgentArborLocalSettings;
  readonly secretStore: LocalDevSecretStore;
}): Promise<SanitizedModelProviderConfig> {
  return toSanitizedModelProfile({
    profile: input.settings.modelProvider,
    secretStore: input.secretStore,
  });
}

export async function toSanitizedModelProfile(input: {
  readonly profile: ModelProviderProfileSettings;
  readonly secretStore: LocalDevSecretStore;
}): Promise<SanitizedModelProviderConfig> {
  const secret = await input.secretStore.getMetadata(input.profile.secretRef);
  return {
    profileId: input.profile.profileId,
    label: input.profile.label,
    logoDataUrl: input.profile.logoDataUrl,
    providerKind: input.profile.providerKind,
    protocolKind: input.profile.protocolKind,
    baseUrl: normalizeBaseUrl(input.profile.baseUrl) ?? DEFAULT_MODEL_PROVIDER_BASE_URL,
    model: input.profile.model,
    openAI: input.profile.openAI,
    defaultAiMode: input.profile.defaultAiMode,
    secretRef: input.profile.secretRef,
    enabled: input.profile.enabled,
    secretConfigured: secret.configured,
    secretUpdatedAt: secret.updatedAt,
    updatedAt: input.profile.updatedAt,
  };
}

export async function toSanitizedInformationAccessConfig(input: {
  readonly settings: AgentArborLocalSettings;
  readonly secretStore: LocalDevSecretStore;
}): Promise<SanitizedInformationAccessConfig> {
  const informationAccess = normalizeInformationAccessSettings(input.settings.informationAccess, input.settings.updatedAt);
  const webSearch = await toSanitizedWebSearchConfig(input);
  return {
    sourcePreference: [...informationAccess.sourcePreference],
    web: {
      provider: webSearch.provider,
      providerKind: informationAccess.tavily.providerKind,
      maxResults: webSearch.maxResults,
      secretRef: webSearch.secretRef,
      secretConfigured: webSearch.secretConfigured,
      secretUpdatedAt: webSearch.secretUpdatedAt,
      status: webSearch.status,
      updatedAt: webSearch.updatedAt,
    },
    stubs: {
      docs: "stub",
      packages: "stub",
      github: "stub",
      run_memory: "readonly_stub",
    },
  };
}

export async function toSanitizedWebSearchConfig(input: {
  readonly settings: AgentArborLocalSettings;
  readonly secretStore: LocalDevSecretStore;
}): Promise<SanitizedWebSearchConfig> {
  const informationAccess = normalizeInformationAccessSettings(input.settings.informationAccess, input.settings.updatedAt);
  const secret = await input.secretStore.getMetadata(informationAccess.tavily.secretRef);
  const provider = informationAccess.webSearch.provider;
  return {
    provider,
    maxResults: informationAccess.tavily.maxResults,
    secretRef: informationAccess.tavily.secretRef,
    secretConfigured: secret.configured,
    secretUpdatedAt: secret.updatedAt,
    status: provider === "none" ? "disabled" : secret.configured ? "ready" : "no-provider",
    updatedAt: informationAccess.webSearch.updatedAt,
  };
}

export function toSanitizedWorkspaceConfig(settings: AgentArborLocalSettings): SanitizedWorkspaceConfig {
  return {
    workspaceDirectory: normalizeConfiguredWorkspaceDirectory(settings.workspaceDirectory),
    updatedAt: settings.updatedAt,
  };
}
