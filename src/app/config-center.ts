import { mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  FileSystemLocalDevSecretStore,
  FileSystemNormalSettingsStore,
  resolveAgentArborConfigDirectory,
  type AgentArborConfigDirectoryEnvironment,
} from "../adapters/config/index.js";
import type {
  AgentArborLocalSettings,
  ConfiguredModelProviderKind,
  ConfiguredModelProtocolKind,
  ConfiguredUndergroundAiMode,
  ConfiguredWebSearchProvider,
  CreateModelProviderProfileInput,
  LocalDevSecretStore,
  McpServerSettings,
  ModelCapabilities,
  ModelCapabilityOverrideSettings,
  ModelProviderProfileSettings,
  NormalSettingsStore,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
  SanitizedWorkspaceConfig,
  SanitizedWebSearchConfig,
  UpdateInformationAccessConfigInput,
  UpdateModelProviderConfigInput,
  UpdateToolStateInput,
  UpsertMcpServerInput,
  UpdateWorkspaceConfigInput,
  UpdateWebSearchConfigInput,
  ToolStateSettings,
} from "../domain/config/index.js";
import type { ConfiguredInformationSourceKind, InformationAccessSettings } from "../domain/config/index.js";

export const DEFAULT_MODEL_PROVIDER_BASE_URL = "https://api.openai.com";
export const MODEL_PROVIDER_SECRET_REF = "secret://local-dev/model-provider/default/api-key";
export const INFORMATION_TAVILY_SECRET_REF = "secret://local-dev/information-source/tavily/default/api-key";
const DEFAULT_MODEL_PROFILE_ID = "default";
const DEFAULT_INFORMATION_SOURCE_PREFERENCE: readonly ConfiguredInformationSourceKind[] = [
  "web",
  "codebase",
  "soil",
  "run_memory",
  "docs",
  "packages",
  "github",
];
const DEFAULT_TAVILY_MAX_RESULTS = 5;
const FALLBACK_WORKSPACE_DIRECTORY = process.cwd();

export type ConfigCenterOptions = {
  readonly settingsStore: NormalSettingsStore;
  readonly secretStore: LocalDevSecretStore;
};

export type CreateLocalConfigCenterOptions = {
  readonly configDirectory?: string;
  readonly env?: AgentArborConfigDirectoryEnvironment;
};

export type UndergroundAiConfigEnvironment = Readonly<Record<string, string | undefined>>;

export class WorkspaceDirectoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceDirectoryValidationError";
  }
}

export class ConfigCenterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigCenterValidationError";
  }
}

export class ConfigCenter {
  constructor(private readonly options: ConfigCenterOptions) {}

  async getModelProviderConfig(): Promise<SanitizedModelProviderConfig> {
    const settings = await this.readOrCreateSettings();
    return this.toSanitizedConfig(settings);
  }

  async getModelProviderApiKey(profileId?: string): Promise<string | undefined> {
    const settings = await this.readOrCreateSettings();
    const profile =
      profileId === undefined
        ? settings.modelProvider
        : settings.modelProfiles.find((candidate) => candidate.profileId === normalizeProfileId(profileId));
    return profile === undefined ? undefined : this.options.secretStore.readSecret(profile.secretRef);
  }

  async listModelProviderProfiles(): Promise<readonly SanitizedModelProviderConfig[]> {
    const settings = await this.readOrCreateSettings();
    return Promise.all(settings.modelProfiles.map((profile) => this.toSanitizedModelProfile(profile)));
  }

  async createModelProviderProfile(input: CreateModelProviderProfileInput): Promise<SanitizedModelProviderConfig> {
    const current = await this.readOrCreateSettings();
    const now = new Date().toISOString();
    const profileId = normalizeProfileId(input.profileId);
    if (current.modelProfiles.some((profile) => profile.profileId === profileId)) {
      throw new ConfigCenterValidationError(`Model profile already exists: ${profileId}`);
    }
    const profile = normalizeModelProfile({
      ...input,
      profileId,
      label: normalizeOptionalString(input.label) ?? profileId,
      updatedAt: now,
    }, current.modelProvider);
    const next = normalizeLocalSettings({
      ...current,
      version: 3,
      modelProfiles: [...current.modelProfiles, profile],
      updatedAt: now,
    });
    const apiKey = normalizeOptionalString(input.apiKey);
    if (apiKey !== undefined) {
      await this.options.secretStore.writeSecret(profile.secretRef, apiKey);
    }
    await this.options.settingsStore.writeSettings(next);
    return this.toSanitizedModelProfile(profile);
  }

  async activateModelProviderProfile(profileId: string): Promise<SanitizedModelProviderConfig> {
    const current = await this.readOrCreateSettings();
    const normalized = normalizeProfileId(profileId);
    const profile = current.modelProfiles.find((candidate) => candidate.profileId === normalized);
    if (profile === undefined) {
      throw new ConfigCenterValidationError(`Model profile not found: ${normalized}`);
    }
    if (!profile.enabled) {
      throw new ConfigCenterValidationError(`Model profile is disabled: ${normalized}`);
    }
    const now = new Date().toISOString();
    const next = normalizeLocalSettings({
      ...current,
      version: 3,
      activeModelProfileId: profile.profileId,
      modelProvider: profile,
      updatedAt: now,
    });
    await this.options.settingsStore.writeSettings(next);
    return this.toSanitizedModelProfile(next.modelProvider);
  }

  async deleteModelProviderProfile(profileId: string): Promise<readonly SanitizedModelProviderConfig[]> {
    const current = await this.readOrCreateSettings();
    const normalized = normalizeProfileId(profileId);
    if (current.activeModelProfileId === normalized) {
      throw new ConfigCenterValidationError("Cannot delete the active model profile.");
    }
    const nextProfiles = current.modelProfiles.filter((profile) => profile.profileId !== normalized);
    if (nextProfiles.length === current.modelProfiles.length) {
      throw new ConfigCenterValidationError(`Model profile not found: ${normalized}`);
    }
    const next = normalizeLocalSettings({
      ...current,
      version: 3,
      modelProfiles: nextProfiles,
      updatedAt: new Date().toISOString(),
    });
    await this.options.settingsStore.writeSettings(next);
    return this.listModelProviderProfiles();
  }

  async updateModelProviderConfig(
    input: UpdateModelProviderConfigInput
  ): Promise<SanitizedModelProviderConfig> {
    const current = await this.readOrCreateSettings();
    const now = new Date().toISOString();
    const profileId = input.profileId === undefined ? current.activeModelProfileId : normalizeProfileId(input.profileId);
    const existing = current.modelProfiles.find((profile) => profile.profileId === profileId);
    if (existing === undefined) {
      throw new ConfigCenterValidationError(`Model profile not found: ${profileId}`);
    }
    const updatedProfile = normalizeModelProfile({
      ...existing,
      ...input,
      profileId,
      updatedAt: now,
    }, existing);
    const nextProfiles = current.modelProfiles.map((profile) =>
      profile.profileId === updatedProfile.profileId ? updatedProfile : profile
    );
    const next: AgentArborLocalSettings = normalizeLocalSettings({
      ...current,
      version: 3,
      modelProfiles: nextProfiles,
      modelProvider: profileId === current.activeModelProfileId ? updatedProfile : current.modelProvider,
      updatedAt: now,
    });

    const apiKey = normalizeOptionalString(input.apiKey);
    if (apiKey !== undefined) {
      await this.options.secretStore.writeSecret(updatedProfile.secretRef, apiKey);
    }

    await this.options.settingsStore.writeSettings(next);
    return this.toSanitizedModelProfile(updatedProfile);
  }

  async listModelCapabilityOverrides(): Promise<readonly ModelCapabilityOverrideSettings[]> {
    const settings = await this.readOrCreateSettings();
    return settings.modelCapabilityOverrides ?? [];
  }

  async updateModelCapabilityOverride(input: {
    readonly model: string;
    readonly providerKind?: ConfiguredModelProviderKind;
    readonly capabilities: Partial<ModelCapabilities>;
  }): Promise<readonly ModelCapabilityOverrideSettings[]> {
    const current = await this.readOrCreateSettings();
    const now = new Date().toISOString();
    const model = normalizeRequiredConfigString(input.model, "model");
    const nextOverride: ModelCapabilityOverrideSettings = {
      providerKind: normalizeModelProviderKind(input.providerKind),
      model,
      capabilities: sanitizeCapabilityOverride(input.capabilities),
      updatedAt: now,
    };
    const existing = current.modelCapabilityOverrides ?? [];
    const next = normalizeLocalSettings({
      ...current,
      version: 3,
      modelCapabilityOverrides: [
        ...existing.filter((item) => item.model !== model || item.providerKind !== nextOverride.providerKind),
        nextOverride,
      ],
      updatedAt: now,
    });
    await this.options.settingsStore.writeSettings(next);
    return next.modelCapabilityOverrides ?? [];
  }

  async listToolStates(): Promise<readonly ToolStateSettings[]> {
    const settings = await this.readOrCreateSettings();
    return settings.toolStates ?? [];
  }

  async updateToolState(input: UpdateToolStateInput): Promise<readonly ToolStateSettings[]> {
    const current = await this.readOrCreateSettings();
    const now = new Date().toISOString();
    const name = normalizeRequiredConfigString(input.name, "tool name");
    const nextState: ToolStateSettings = { name, enabled: input.enabled, updatedAt: now };
    const existing = current.toolStates ?? [];
    const next = normalizeLocalSettings({
      ...current,
      version: 3,
      toolStates: [...existing.filter((state) => state.name !== name), nextState],
      updatedAt: now,
    });
    await this.options.settingsStore.writeSettings(next);
    return next.toolStates ?? [];
  }

  async listMcpServers(): Promise<readonly McpServerSettings[]> {
    const settings = await this.readOrCreateSettings();
    return settings.mcpServers ?? [];
  }

  async upsertMcpServer(input: UpsertMcpServerInput): Promise<readonly McpServerSettings[]> {
    const current = await this.readOrCreateSettings();
    const now = new Date().toISOString();
    const serverId = normalizeProfileId(input.serverId);
    const existing = (current.mcpServers ?? []).find((server) => server.serverId === serverId);
    const nextServer: McpServerSettings = {
      serverId,
      label: normalizeOptionalString(input.label) ?? existing?.label ?? serverId,
      transport: input.transport === "http" ? "http" : input.transport === "stdio" ? "stdio" : existing?.transport ?? "stdio",
      command: normalizeOptionalString(input.command) ?? existing?.command,
      args: input.args === undefined ? existing?.args ?? [] : sanitizeMcpArgs(input.args),
      url: normalizeOptionalString(input.url) ?? existing?.url,
      envSecretRefs: input.envSecretRefs === undefined
        ? existing?.envSecretRefs ?? []
        : input.envSecretRefs.map((ref) => normalizeOptionalString(ref)).filter((ref): ref is string => ref !== undefined),
      enabled: input.enabled ?? existing?.enabled ?? false,
      updatedAt: now,
    };
    const next = normalizeLocalSettings({
      ...current,
      version: 3,
      mcpServers: [
        ...(current.mcpServers ?? []).filter((server) => server.serverId !== serverId),
        nextServer,
      ],
      updatedAt: now,
    });
    await this.options.settingsStore.writeSettings(next);
    return next.mcpServers ?? [];
  }

  async getInformationAccessConfig(): Promise<SanitizedInformationAccessConfig> {
    const settings = await this.readOrCreateSettings();
    return this.toSanitizedInformationAccessConfig(settings);
  }

  async getWebSearchConfig(): Promise<SanitizedWebSearchConfig> {
    const settings = await this.readOrCreateSettings();
    return this.toSanitizedWebSearchConfig(settings);
  }

  async updateInformationAccessConfig(
    input: UpdateInformationAccessConfigInput
  ): Promise<SanitizedInformationAccessConfig> {
    const current = await this.readOrCreateSettings();
    const now = new Date().toISOString();
    const currentInformation = normalizeInformationAccessSettings(current.informationAccess, now);
    const tavilyApiKey = normalizeOptionalString(input.tavilyApiKey);
    const nextInformation: InformationAccessSettings = {
      sourcePreference:
        input.sourcePreference === undefined || input.sourcePreference.length === 0
          ? currentInformation.sourcePreference
          : normalizeSourcePreference(input.sourcePreference),
      webSearch: {
        provider: tavilyApiKey === undefined ? currentInformation.webSearch.provider : "tavily",
        updatedAt: now,
      },
      tavily: {
        ...currentInformation.tavily,
        maxResults: normalizePositiveInteger(input.tavilyMaxResults) ?? currentInformation.tavily.maxResults,
        updatedAt: now,
      },
    };
    if (tavilyApiKey !== undefined) {
      await this.options.secretStore.writeSecret(nextInformation.tavily.secretRef, tavilyApiKey);
    }
    await this.options.settingsStore.writeSettings({
      ...current,
      version: 3,
      informationAccess: nextInformation,
      updatedAt: now,
    });
    return this.toSanitizedInformationAccessConfig({ ...current, informationAccess: nextInformation, updatedAt: now });
  }

  async updateWebSearchConfig(input: UpdateWebSearchConfigInput): Promise<SanitizedWebSearchConfig> {
    const current = await this.readOrCreateSettings();
    const now = new Date().toISOString();
    const currentInformation = normalizeInformationAccessSettings(current.informationAccess, now);
    const apiKey = firstNonBlank(input.apiKey, input.tavilyApiKey);
    const provider =
      normalizeWebSearchProvider(input.provider) ??
      (apiKey === undefined ? currentInformation.webSearch.provider : "tavily");
    const nextInformation: InformationAccessSettings = {
      sourcePreference: currentInformation.sourcePreference,
      webSearch: {
        provider,
        updatedAt: now,
      },
      tavily: {
        ...currentInformation.tavily,
        maxResults:
          normalizePositiveInteger(input.maxResults) ??
          normalizePositiveInteger(input.tavilyMaxResults) ??
          currentInformation.tavily.maxResults,
        updatedAt: now,
      },
    };
    if (apiKey !== undefined) {
      await this.options.secretStore.writeSecret(nextInformation.tavily.secretRef, apiKey);
    }
    await this.options.settingsStore.writeSettings({
      ...current,
      version: 3,
      informationAccess: nextInformation,
      updatedAt: now,
    });
    return this.toSanitizedWebSearchConfig({ ...current, informationAccess: nextInformation, updatedAt: now });
  }

  async getWorkspaceConfig(): Promise<SanitizedWorkspaceConfig> {
    const settings = await this.readOrCreateSettings();
    return this.toSanitizedWorkspaceConfig(settings);
  }

  async updateWorkspaceConfig(input: UpdateWorkspaceConfigInput): Promise<SanitizedWorkspaceConfig> {
    const current = await this.readOrCreateSettings();
    const now = new Date().toISOString();
    const workspaceDirectory = await normalizeWorkspaceDirectory(input.workspaceDirectory);
    const next: AgentArborLocalSettings = {
      ...current,
      version: 3,
      workspaceDirectory,
      updatedAt: now,
    };
    await this.options.settingsStore.writeSettings(next);
    return this.toSanitizedWorkspaceConfig(next);
  }

  async createUndergroundAiEnvironment(input: {
    readonly modelProvider?: Pick<SanitizedModelProviderConfig, "secretRef" | "model" | "baseUrl">;
  } = {}): Promise<UndergroundAiConfigEnvironment> {
    const settings = await this.readOrCreateSettings();
    const modelProvider = input.modelProvider ?? settings.modelProvider;
    const apiKey = await this.options.secretStore.readSecret(modelProvider.secretRef);
    const informationAccess = normalizeInformationAccessSettings(settings.informationAccess, settings.updatedAt);
    const tavilyApiKey =
      informationAccess.webSearch.provider === "none"
        ? undefined
        : await this.options.secretStore.readSecret(informationAccess.tavily.secretRef);
    return {
      AGENTARBOR_MODEL_API_KEY: apiKey,
      AGENTARBOR_MODEL_NAME: modelProvider.model,
      AGENTARBOR_MODEL_BASE_URL: normalizeBaseUrl(modelProvider.baseUrl) ?? DEFAULT_MODEL_PROVIDER_BASE_URL,
      AGENTARBOR_TAVILY_API_KEY: tavilyApiKey,
      AGENTARBOR_TAVILY_MAX_RESULTS: String(informationAccess.tavily.maxResults),
      AGENTARBOR_INFORMATION_SOURCE_PREFERENCE: informationAccess.sourcePreference.join(","),
      TAVILY_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
    };
  }

  private async readOrCreateSettings(): Promise<AgentArborLocalSettings> {
    const existing = await this.options.settingsStore.readSettings();
    if (existing !== undefined) {
      const normalized = normalizeLocalSettings(existing);
      if (existing.version !== 3 || existing.activeModelProfileId !== normalized.activeModelProfileId) {
        await this.options.settingsStore.writeSettings(normalized);
      }
      return normalized;
    }
    const created = createDefaultLocalSettings();
    await this.options.settingsStore.writeSettings(created);
    return created;
  }

  private async toSanitizedConfig(settings: AgentArborLocalSettings): Promise<SanitizedModelProviderConfig> {
    return this.toSanitizedModelProfile(settings.modelProvider);
  }

  private async toSanitizedModelProfile(profile: ModelProviderProfileSettings): Promise<SanitizedModelProviderConfig> {
    const secret = await this.options.secretStore.getMetadata(profile.secretRef);
    return {
      profileId: profile.profileId,
      label: profile.label,
      providerKind: profile.providerKind,
      protocolKind: profile.protocolKind,
      baseUrl: normalizeBaseUrl(profile.baseUrl) ?? DEFAULT_MODEL_PROVIDER_BASE_URL,
      model: profile.model,
      defaultAiMode: profile.defaultAiMode,
      secretRef: profile.secretRef,
      enabled: profile.enabled,
      secretConfigured: secret.configured,
      secretUpdatedAt: secret.updatedAt,
      updatedAt: profile.updatedAt,
    };
  }

  private async toSanitizedInformationAccessConfig(
    settings: AgentArborLocalSettings
  ): Promise<SanitizedInformationAccessConfig> {
    const informationAccess = normalizeInformationAccessSettings(settings.informationAccess, settings.updatedAt);
    const webSearch = await this.toSanitizedWebSearchConfig(settings);
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


  private async toSanitizedWebSearchConfig(settings: AgentArborLocalSettings): Promise<SanitizedWebSearchConfig> {
    const informationAccess = normalizeInformationAccessSettings(settings.informationAccess, settings.updatedAt);
    const secret = await this.options.secretStore.getMetadata(informationAccess.tavily.secretRef);
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

  private toSanitizedWorkspaceConfig(settings: AgentArborLocalSettings): SanitizedWorkspaceConfig {
    return {
      workspaceDirectory: normalizeConfiguredWorkspaceDirectory(settings.workspaceDirectory),
      updatedAt: settings.updatedAt,
    };
  }
}

export function createLocalConfigCenter(options: CreateLocalConfigCenterOptions = {}): {
  readonly configCenter: ConfigCenter;
  readonly configDirectory: string;
} {
  const configDirectory =
    options.configDirectory ?? resolveAgentArborConfigDirectory({ env: options.env });
  return {
    configDirectory,
    configCenter: new ConfigCenter({
      settingsStore: new FileSystemNormalSettingsStore(configDirectory),
      secretStore: new FileSystemLocalDevSecretStore(configDirectory),
    }),
  };
}

export function createDefaultLocalSettings(now: string = new Date().toISOString()): AgentArborLocalSettings {
  const defaultProfile: ModelProviderProfileSettings = {
    profileId: DEFAULT_MODEL_PROFILE_ID,
    label: "Default",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: DEFAULT_MODEL_PROVIDER_BASE_URL,
    defaultAiMode: "openai-compatible",
    secretRef: MODEL_PROVIDER_SECRET_REF,
    enabled: true,
    updatedAt: now,
  };
  return {
    version: 3,
    modelProvider: defaultProfile,
    activeModelProfileId: defaultProfile.profileId,
    modelProfiles: [defaultProfile],
    modelCapabilityOverrides: [],
    toolStates: [],
    mcpServers: [],
    informationAccess: createDefaultInformationAccessSettings(now),
    updatedAt: now,
  };
}

function createDefaultInformationAccessSettings(now: string): InformationAccessSettings {
  return {
    sourcePreference: [...DEFAULT_INFORMATION_SOURCE_PREFERENCE],
    webSearch: {
      provider: "tavily",
      updatedAt: now,
    },
    tavily: {
      providerKind: "tavily",
      maxResults: DEFAULT_TAVILY_MAX_RESULTS,
      secretRef: INFORMATION_TAVILY_SECRET_REF,
      updatedAt: now,
    },
  };
}

function normalizeLocalSettings(settings: AgentArborLocalSettings): AgentArborLocalSettings {
  const now = settings.updatedAt;
  const legacyProfile = normalizeModelProfile(settings.modelProvider, createDefaultProfile(now));
  const profiles = dedupeProfiles((settings.modelProfiles.length === 0 ? [legacyProfile] : settings.modelProfiles)
    .map((profile) => normalizeModelProfile(profile, legacyProfile)));
  const activeProfile =
    profiles.find((profile) => profile.profileId === settings.activeModelProfileId) ??
    profiles.find((profile) => profile.profileId === legacyProfile.profileId) ??
    profiles[0] ??
    legacyProfile;
  return {
    ...settings,
    version: 3,
    modelProvider: activeProfile,
    activeModelProfileId: activeProfile.profileId,
    modelProfiles: profiles.length === 0 ? [activeProfile] : profiles,
    modelCapabilityOverrides: normalizeModelCapabilityOverrides(settings.modelCapabilityOverrides ?? [], now),
    toolStates: normalizeToolStates(settings.toolStates ?? [], now),
    mcpServers: normalizeMcpServers(settings.mcpServers ?? [], now),
    informationAccess: normalizeInformationAccessSettings(settings.informationAccess, now),
  };
}

function createDefaultProfile(now: string): ModelProviderProfileSettings {
  return {
    profileId: DEFAULT_MODEL_PROFILE_ID,
    label: "Default",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: DEFAULT_MODEL_PROVIDER_BASE_URL,
    defaultAiMode: "openai-compatible",
    secretRef: MODEL_PROVIDER_SECRET_REF,
    enabled: true,
    updatedAt: now,
  };
}

function normalizeModelProfile(
  input: Partial<ModelProviderProfileSettings> & { readonly profileId?: string },
  fallback: ModelProviderProfileSettings
): ModelProviderProfileSettings {
  const providerKind = normalizeModelProviderKind(input.providerKind) ?? fallback.providerKind;
  return {
    profileId: normalizeProfileId(input.profileId ?? fallback.profileId),
    label: normalizeOptionalString(input.label) ?? fallback.label,
    providerKind,
    protocolKind: normalizeModelProtocolKind(input.protocolKind, providerKind) ?? fallback.protocolKind,
    baseUrl: normalizeBaseUrl(input.baseUrl) ?? fallback.baseUrl,
    model: normalizeOptionalString(input.model) ?? fallback.model,
    defaultAiMode: normalizeAiMode(input.defaultAiMode) ?? fallback.defaultAiMode,
    secretRef: normalizeOptionalString(input.secretRef) ?? secretRefForProfile(input.profileId ?? fallback.profileId),
    enabled: input.enabled ?? fallback.enabled,
    updatedAt: normalizeOptionalString(input.updatedAt) ?? fallback.updatedAt,
  };
}

function dedupeProfiles(profiles: readonly ModelProviderProfileSettings[]): readonly ModelProviderProfileSettings[] {
  const map = new Map<string, ModelProviderProfileSettings>();
  for (const profile of profiles) {
    map.set(profile.profileId, profile);
  }
  return [...map.values()];
}

function normalizeModelCapabilityOverrides(
  overrides: readonly ModelCapabilityOverrideSettings[],
  now: string
): readonly ModelCapabilityOverrideSettings[] {
  return overrides.map((override) => ({
    providerKind: normalizeModelProviderKind(override.providerKind),
    model: normalizeRequiredConfigString(override.model, "model"),
    capabilities: sanitizeCapabilityOverride(override.capabilities),
    updatedAt: normalizeOptionalString(override.updatedAt) ?? now,
  }));
}

function normalizeToolStates(states: readonly ToolStateSettings[], now: string): readonly ToolStateSettings[] {
  return states.map((state) => ({
    name: normalizeRequiredConfigString(state.name, "tool name"),
    enabled: state.enabled,
    updatedAt: normalizeOptionalString(state.updatedAt) ?? now,
  }));
}

function normalizeMcpServers(servers: readonly McpServerSettings[], now: string): readonly McpServerSettings[] {
  return servers.map((server) => ({
    serverId: normalizeProfileId(server.serverId),
    label: normalizeOptionalString(server.label) ?? server.serverId,
    transport: server.transport === "http" ? "http" : "stdio",
    command: normalizeOptionalString(server.command),
    args: sanitizeMcpArgs(server.args ?? []),
    url: normalizeOptionalString(server.url),
    envSecretRefs: server.envSecretRefs.map((ref) => normalizeOptionalString(ref)).filter((ref): ref is string => ref !== undefined),
    enabled: server.enabled,
    updatedAt: normalizeOptionalString(server.updatedAt) ?? now,
  }));
}

function normalizeInformationAccessSettings(
  settings: InformationAccessSettings | undefined,
  now: string
): InformationAccessSettings {
  if (settings === undefined) {
    return createDefaultInformationAccessSettings(now);
  }
  return {
    sourcePreference: normalizeSourcePreference(settings.sourcePreference),
    webSearch: {
      provider: normalizeWebSearchProvider(settings.webSearch?.provider) ?? "tavily",
      updatedAt: normalizeOptionalString(settings.webSearch?.updatedAt) ?? settings.tavily.updatedAt ?? now,
    },
    tavily: {
      providerKind: "tavily",
      maxResults: normalizePositiveInteger(settings.tavily.maxResults) ?? DEFAULT_TAVILY_MAX_RESULTS,
      secretRef: normalizeOptionalString(settings.tavily.secretRef) ?? INFORMATION_TAVILY_SECRET_REF,
      updatedAt: normalizeOptionalString(settings.tavily.updatedAt) ?? now,
    },
  };
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (normalized === undefined) {
    return undefined;
  }
  return normalized.replace(/\/+$/, "");
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeAiMode(value: ConfiguredUndergroundAiMode | undefined): ConfiguredUndergroundAiMode | undefined {
  return value === "none" || value === "fake" || value === "openai-compatible" ? value : undefined;
}

function normalizeModelProviderKind(value: ConfiguredModelProviderKind | undefined): ConfiguredModelProviderKind | undefined {
  return value === "openai_compatible" || value === "anthropic" || value === "gemini" || value === "ollama" || value === "local"
    ? value
    : undefined;
}

function normalizeModelProtocolKind(
  value: ConfiguredModelProtocolKind | undefined,
  providerKind: ConfiguredModelProviderKind
): ConfiguredModelProtocolKind | undefined {
  if (
    value === "openai_compatible_chat_completions" ||
    value === "anthropic_messages" ||
    value === "gemini_generate_content" ||
    value === "ollama_generate"
  ) {
    return value;
  }
  if (providerKind === "anthropic") return "anthropic_messages";
  if (providerKind === "gemini") return "gemini_generate_content";
  if (providerKind === "ollama") return "ollama_generate";
  return "openai_compatible_chat_completions";
}

function normalizeWebSearchProvider(value: ConfiguredWebSearchProvider | undefined): ConfiguredWebSearchProvider | undefined {
  return value === "tavily" || value === "none" ? value : undefined;
}

function normalizeSourcePreference(
  value: readonly ConfiguredInformationSourceKind[] | undefined
): readonly ConfiguredInformationSourceKind[] {
  const normalized = [...new Set((value ?? []).filter(isConfiguredInformationSourceKind))];
  return normalized.length === 0 ? [...DEFAULT_INFORMATION_SOURCE_PREFERENCE] : normalized;
}

function isConfiguredInformationSourceKind(value: string): value is ConfiguredInformationSourceKind {
  return (
    value === "web" ||
    value === "page" ||
    value === "codebase" ||
    value === "soil" ||
    value === "run_memory" ||
    value === "docs" ||
    value === "packages" ||
    value === "github"
  );
}

async function normalizeWorkspaceDirectory(value: string): Promise<string> {
  const normalized = path.resolve(normalizeRequiredString(value, "workspaceDirectory"));
  await ensureWorkspaceReady(normalized);
  return normalized;
}

async function ensureWorkspaceReady(directory: string): Promise<void> {
  try {
    await mkdir(directory, { recursive: true });
  } catch {
    throw new WorkspaceDirectoryValidationError("Workspace directory could not be created.");
  }
  const info = await stat(directory).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) {
    throw new WorkspaceDirectoryValidationError("Workspace directory must be a directory.");
  }
}

function normalizeConfiguredWorkspaceDirectory(value: string | undefined): string {
  return path.resolve(normalizeOptionalString(value) ?? resolveDefaultWorkspaceDirectory());
}

function resolveDefaultWorkspaceDirectory(): string {
  return path.join(os.homedir(), ".agentarbor", "workspace");
}

function normalizeRequiredString(value: string | undefined, fieldName: string): string {
  const normalized = normalizeOptionalString(value);
  if (normalized === undefined) {
    throw new WorkspaceDirectoryValidationError(`${fieldName} must be a non-empty string.`);
  }
  return normalized;
}

function normalizeRequiredConfigString(value: string | undefined, fieldName: string): string {
  const normalized = normalizeOptionalString(value);
  if (normalized === undefined) {
    throw new ConfigCenterValidationError(`${fieldName} must be a non-empty string.`);
  }
  return normalized;
}

function normalizeProfileId(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  if (normalized.length === 0) {
    throw new ConfigCenterValidationError("Profile id must contain letters, numbers, underscore, or dash.");
  }
  return normalized;
}

function secretRefForProfile(profileId: string): string {
  return `secret://local-dev/model-provider/${normalizeProfileId(profileId)}/api-key`;
}

function sanitizeMcpArgs(args: readonly string[]): readonly string[] {
  const sanitized: string[] = [];
  let nextArgIsSecret = false;
  for (const raw of args) {
    const arg = String(raw).trim();
    if (arg.length === 0) {
      continue;
    }
    const sensitiveKeyValue = /(?:api[_-]?key|token|secret|password|passwd|bearer)\s*[=:]/i.test(arg);
    const sensitiveFlag = /^--?(?:api[_-]?key|token|secret|password|passwd|bearer)$/i.test(arg);
    const likelySecretValue = /^(?:Bearer\s+|sk-[A-Za-z0-9_-]+|tvly-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.)/.test(arg);
    if (nextArgIsSecret || sensitiveKeyValue || sensitiveFlag || likelySecretValue) {
      sanitized.push("[secret-ref-required]");
    } else {
      sanitized.push(arg);
    }
    nextArgIsSecret = sensitiveFlag;
  }
  return sanitized;
}

function sanitizeCapabilityOverride(capabilities: Partial<ModelCapabilities>): Partial<ModelCapabilities> {
  return {
    contextWindowTokens: normalizePositiveInteger(capabilities.contextWindowTokens),
    maxOutputTokens: normalizePositiveInteger(capabilities.maxOutputTokens),
    supportsToolCalling: booleanOrUndefined(capabilities.supportsToolCalling),
    supportsParallelToolCalls: booleanOrUndefined(capabilities.supportsParallelToolCalls),
    supportsStructuredOutputs: booleanOrUndefined(capabilities.supportsStructuredOutputs),
    supportsStreaming: booleanOrUndefined(capabilities.supportsStreaming),
    supportsVisionInput: booleanOrUndefined(capabilities.supportsVisionInput),
    supportsReasoningEffort: booleanOrUndefined(capabilities.supportsReasoningEffort),
    preferredApiStyle: normalizePreferredApiStyle(capabilities.preferredApiStyle),
    stability: normalizeModelStability(capabilities.stability),
    lastVerifiedAt: normalizeCapabilityVerifiedAt(capabilities.lastVerifiedAt),
  };
}

function normalizePreferredApiStyle(value: ModelCapabilities["preferredApiStyle"] | undefined): ModelCapabilities["preferredApiStyle"] | undefined {
  return value === "chat_completions" ||
    value === "responses" ||
    value === "messages" ||
    value === "gemini_generate_content" ||
    value === "openai_compatible"
    ? value
    : undefined;
}

function normalizeModelStability(value: ModelCapabilities["stability"] | undefined): ModelCapabilities["stability"] | undefined {
  return value === "stable" || value === "preview" || value === "deprecated" || value === "unknown"
    ? value
    : undefined;
}

function normalizeCapabilityVerifiedAt(value: string | undefined): string | undefined {
  const normalized = normalizeOptionalString(value);
  return normalized !== undefined && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(normalized) ? normalized : undefined;
}

function booleanOrUndefined(value: boolean | undefined): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(1, Math.floor(value));
}

function firstNonBlank(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    const normalized = normalizeOptionalString(value);
    if (normalized !== undefined) {
      return normalized;
    }
  }
  return undefined;
}
