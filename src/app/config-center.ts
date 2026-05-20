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
  CreateModelProviderProfileInput,
  LocalDevSecretStore,
  McpServerSettings,
  ModelCapabilities,
  ModelCapabilityOverrideSettings,
  ModelProviderModelCatalog,
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
import type { InformationAccessSettings } from "../domain/config/index.js";
import {
  DEFAULT_MODEL_PROVIDER_BASE_URL,
  ConfigSchemaValidationError,
  createDefaultLocalSettings,
  normalizeBaseUrl,
  normalizeInformationAccessSettings,
  normalizeLocalSettings,
  normalizeModelProfile,
  normalizeModelProviderKind,
  normalizeOptionalString,
  normalizePositiveInteger,
  normalizeProfileId,
  normalizeRequiredConfigString,
  normalizeSourcePreference,
  normalizeWebSearchProvider,
  parseLocalSettingsFile,
  sanitizeCapabilityOverride,
  sanitizeMcpArgs,
  shouldRewriteLocalSettingsFile,
} from "./config-center/settings-schema.js";

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

  async listModelProviderModelCatalogs(): Promise<readonly ModelProviderModelCatalog[]> {
    const settings = await this.readOrCreateSettings();
    return settings.modelCatalogs ?? [];
  }

  async upsertModelProviderModelCatalog(catalog: ModelProviderModelCatalog): Promise<ModelProviderModelCatalog> {
    const current = await this.readOrCreateSettings();
    const now = new Date().toISOString();
    const profileId = normalizeProfileId(catalog.profileId);
    if (!current.modelProfiles.some((profile) => profile.profileId === profileId)) {
      throw new ConfigCenterValidationError(`Model profile not found: ${profileId}`);
    }
    const normalized = normalizeLocalSettings({
      ...current,
      version: 3,
      modelCatalogs: [
        ...(current.modelCatalogs ?? []).filter((item) => item.profileId !== profileId),
        { ...catalog, profileId },
      ],
      updatedAt: now,
    });
    const saved = normalized.modelCatalogs?.find((item) => item.profileId === profileId);
    if (saved === undefined) {
      throw new ConfigCenterValidationError(`Model catalog could not be saved: ${profileId}`);
    }
    const withoutEmptyCatalog =
      saved.models.length === 0
        ? normalizeLocalSettings({
            ...normalized,
            modelCatalogs: (normalized.modelCatalogs ?? []).filter((item) => item.profileId !== profileId),
            updatedAt: now,
          })
        : normalized;
    const next = normalizeLocalSettings(clearProfileModelOutsideCatalog(withoutEmptyCatalog, saved, now));
    await this.options.settingsStore.writeSettings(next);
    const savedAfterCleanup = next.modelCatalogs?.find((item) => item.profileId === profileId);
    if (savedAfterCleanup === undefined && saved.models.length !== 0) {
      throw new ConfigCenterValidationError(`Model catalog could not be saved: ${profileId}`);
    }
    return savedAfterCleanup ?? saved;
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
    }, createModelProviderProfileFallback(profileId, normalizeOptionalString(input.label) ?? profileId, current.modelProvider, now));
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
    return this.toSanitizedModelProfile(
      next.modelProfiles.find((candidate) => candidate.profileId === profileId) ?? profile
    );
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
    const deletedProfile = current.modelProfiles.find((profile) => profile.profileId === normalized);
    const next = normalizeLocalSettings({
      ...current,
      version: 3,
      modelProfiles: nextProfiles,
      modelCatalogs: (current.modelCatalogs ?? []).filter((catalog) => catalog.profileId !== normalized),
      updatedAt: new Date().toISOString(),
    });
    if (deletedProfile !== undefined) {
      await this.options.secretStore.deleteSecret(deletedProfile.secretRef);
    }
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
    const normalizedProfile = normalizeModelProfile({
      ...existing,
      ...input,
      profileId,
      updatedAt: now,
    }, existing);
    const updatedProfile = input.clearModel === true ? { ...normalizedProfile, model: undefined } : normalizedProfile;
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
    if (input.clearApiKey === true) {
      await Promise.all([...new Set([existing.secretRef, updatedProfile.secretRef])]
        .map((secretRef) => this.options.secretStore.deleteSecret(secretRef)));
    } else if (apiKey !== undefined) {
      await this.options.secretStore.writeSecret(updatedProfile.secretRef, apiKey);
    }

    await this.options.settingsStore.writeSettings(next);
    return this.toSanitizedModelProfile(
      next.modelProfiles.find((profile) => profile.profileId === updatedProfile.profileId) ?? updatedProfile
    );
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
      const parsed = parseLocalSettingsFile(existing);
      const normalized = normalizeLocalSettings(parsed);
      if (shouldRewriteLocalSettingsFile(existing, normalized)) {
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

function createModelProviderProfileFallback(
  profileId: string,
  label: string,
  current: ModelProviderProfileSettings,
  now: string
): ModelProviderProfileSettings {
  return {
    profileId,
    label,
    providerKind: "openai_compatible",
    protocolKind: "openai_responses",
    baseUrl: DEFAULT_MODEL_PROVIDER_BASE_URL,
    defaultAiMode: current.defaultAiMode === "none" ? "none" : "openai-responses",
    secretRef: current.secretRef,
    enabled: true,
    updatedAt: now,
  };
}

function clearProfileModelOutsideCatalog(
  settings: AgentArborLocalSettings,
  catalog: ModelProviderModelCatalog,
  now: string
): AgentArborLocalSettings {
  const savedModelIds = new Set(catalog.models.map((model) => model.id));
  const modelStillSaved = (model: string | undefined): boolean =>
    model === undefined || savedModelIds.has(model);
  const modelProfiles = settings.modelProfiles.map((profile) =>
    profile.profileId === catalog.profileId && !modelStillSaved(profile.model)
      ? { ...profile, model: undefined, updatedAt: now }
      : profile
  );
  const activeProfile =
    modelProfiles.find((profile) => profile.profileId === settings.activeModelProfileId) ?? settings.modelProvider;
  return {
    ...settings,
    modelProfiles,
    modelProvider:
      settings.modelProvider.profileId === catalog.profileId && !modelStillSaved(settings.modelProvider.model)
        ? { ...activeProfile, model: undefined, updatedAt: now }
        : activeProfile,
    updatedAt: now,
  };
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

function firstNonBlank(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    const normalized = normalizeOptionalString(value);
    if (normalized !== undefined) {
      return normalized;
    }
  }
  return undefined;
}
