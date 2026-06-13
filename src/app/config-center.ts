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
  McpServerSecretValueInput,
  McpServerSettings,
  ModelCapabilities,
  ModelCapabilityOverrideSettings,
  ModelProviderModelCatalog,
  ModelProviderProfileSettings,
  NormalSettingsStore,
  SanitizedCommandShellConfig,
  SanitizedMcpServerSecretMetadata,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
  SanitizedWorkspaceConfig,
  SanitizedWebSearchConfig,
  UpdateInformationAccessConfigInput,
  UpdateCommandShellConfigInput,
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
  createDefaultLocalSettings,
  normalizeBaseUrl,
  normalizeInformationAccessSettings,
  normalizeLocalSettings,
  normalizeModelProfile,
  normalizeModelProviderKind,
  normalizeOptionalString,
  parseMcpCommandLine,
  normalizePositiveInteger,
  normalizeProfileId,
  normalizeRequiredConfigString,
  normalizeSourcePreference,
  normalizeCommandShellUpdate,
  toSanitizedCommandShellConfig,
  normalizeWebSearchProvider,
  parseLocalSettingsFile,
  sanitizeCapabilityOverride,
  sanitizeMcpArgs,
  shouldRewriteLocalSettingsFile,
} from "./config-center/settings-schema.js";
import {
  toSanitizedInformationAccessConfig,
  toSanitizedModelProfile,
  toSanitizedModelProviderConfig,
  toSanitizedWebSearchConfig,
  toSanitizedWorkspaceConfig,
} from "./config-center/projections.js";
import { normalizeWorkspaceDirectory } from "./config-center/workspace-settings.js";

export { WorkspaceDirectoryValidationError } from "./config-center/workspace-settings.js";

export type ConfigCenterOptions = {
  readonly settingsStore: NormalSettingsStore;
  readonly secretStore: LocalDevSecretStore;
};

export type CreateLocalConfigCenterOptions = {
  readonly configDirectory?: string;
  readonly env?: AgentArborConfigDirectoryEnvironment;
};

export type ModelRuntimeConfigEnvironment = Readonly<Record<string, string | undefined>>;
export type UndergroundAiConfigEnvironment = ModelRuntimeConfigEnvironment;

export type CreateModelRuntimeEnvironmentInput = {
  readonly modelProvider?: Pick<SanitizedModelProviderConfig, "secretRef" | "model" | "baseUrl">;
  readonly informationAccess?: Pick<SanitizedInformationAccessConfig, "sourcePreference" | "web">;
};
export type CreateMcpRuntimeEnvironmentInput = {
  readonly servers?: readonly Pick<
    McpServerSettings,
    "envSecretRefs" | "headerSecretRefs" | "bearerTokenSecretRef" | "apiKeySecretRef"
  >[];
  readonly baseEnv?: ModelRuntimeConfigEnvironment;
};

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
    return toSanitizedModelProviderConfig({ settings, secretStore: this.options.secretStore });
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
    return Promise.all(settings.modelProfiles.map((profile) =>
      toSanitizedModelProfile({ profile, secretStore: this.options.secretStore })
    ));
  }

  async getModelProviderOrder(): Promise<readonly string[]> {
    const settings = await this.readOrCreateSettings();
    return settings.modelProviderOrder ?? [];
  }

  async updateModelProviderOrder(order: readonly string[]): Promise<readonly string[]> {
    const current = await this.readOrCreateSettings();
    const next = normalizeLocalSettings({
      ...current,
      version: 3,
      modelProviderOrder: order,
      updatedAt: new Date().toISOString(),
    });
    await this.options.settingsStore.writeSettings(next);
    return next.modelProviderOrder ?? [];
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
    return toSanitizedModelProfile({
      profile: next.modelProfiles.find((candidate) => candidate.profileId === profileId) ?? profile,
      secretStore: this.options.secretStore,
    });
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
    return toSanitizedModelProfile({ profile: next.modelProvider, secretStore: this.options.secretStore });
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
    return toSanitizedModelProfile({
      profile: next.modelProfiles.find((profile) => profile.profileId === updatedProfile.profileId) ?? updatedProfile,
      secretStore: this.options.secretStore,
    });
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
    const parsedCommandLine = input.commandLine === undefined ? undefined : parseMcpCommandLine(input.commandLine);
    const nextServer: McpServerSettings = {
      serverId,
      label: normalizeOptionalString(input.label) ?? existing?.label ?? serverId,
      transport: input.transport ?? existing?.transport ?? "stdio",
      command: parsedCommandLine?.command ?? normalizeOptionalString(input.command) ?? existing?.command,
      args: parsedCommandLine?.args ?? (input.args === undefined ? existing?.args ?? [] : sanitizeMcpArgs(input.args)),
      url: normalizeOptionalString(input.url) ?? existing?.url,
      envSecretRefs: input.envSecretRefs === undefined
        ? existing?.envSecretRefs ?? []
        : input.envSecretRefs.map((ref) => normalizeOptionalString(ref)).filter((ref): ref is string => ref !== undefined),
      headerSecretRefs: input.clearMcpAuth === true
        ? []
        : input.headerSecretRefs === undefined
        ? existing?.headerSecretRefs ?? []
        : input.headerSecretRefs.map((ref) => normalizeOptionalString(ref)).filter((ref): ref is string => ref !== undefined),
      bearerTokenSecretRef: input.clearMcpAuth === true ? undefined : normalizeOptionalString(input.bearerTokenSecretRef) ?? existing?.bearerTokenSecretRef,
      apiKeySecretRef: input.clearMcpAuth === true ? undefined : normalizeOptionalString(input.apiKeySecretRef) ?? existing?.apiKeySecretRef,
      apiKeyHeaderName: input.clearMcpAuth === true ? undefined : normalizeOptionalString(input.apiKeyHeaderName) ?? existing?.apiKeyHeaderName,
      confirmationMode: input.confirmationMode ?? existing?.confirmationMode ?? "never",
      toolExposureMode: input.toolExposureMode ?? existing?.toolExposureMode ?? "none",
      enabledTools: input.enabledTools === undefined
        ? existing?.enabledTools ?? []
        : [...new Set(input.enabledTools.map((tool) => normalizeOptionalString(tool)).filter((tool): tool is string => tool !== undefined))],
      autoApprovedTools: input.autoApprovedTools === undefined
        ? existing?.autoApprovedTools ?? []
        : [...new Set(input.autoApprovedTools.map((tool) => normalizeOptionalString(tool)).filter((tool): tool is string => tool !== undefined))],
      enabled: input.enabled ?? existing?.enabled ?? false,
      lastConnectedAt: existing?.lastConnectedAt,
      lastError: existing?.lastError,
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

  async deleteMcpServer(serverId: string): Promise<readonly McpServerSettings[]> {
    const current = await this.readOrCreateSettings();
    const normalized = normalizeProfileId(serverId);
    const existing = current.mcpServers ?? [];
    const nextServers = existing.filter((server) => server.serverId !== normalized);
    if (nextServers.length === existing.length) {
      throw new ConfigCenterValidationError(`MCP server not found: ${normalized}`);
    }
    const next = normalizeLocalSettings({
      ...current,
      version: 3,
      mcpServers: nextServers,
      updatedAt: new Date().toISOString(),
    });
    await this.options.settingsStore.writeSettings(next);
    return next.mcpServers ?? [];
  }

  async updateMcpServerConnectionState(input: {
    readonly serverId: string;
    readonly connectedAt?: string;
    readonly errorSummary?: string;
  }): Promise<readonly McpServerSettings[]> {
    const current = await this.readOrCreateSettings();
    const now = new Date().toISOString();
    const serverId = normalizeProfileId(input.serverId);
    const existing = (current.mcpServers ?? []).find((server) => server.serverId === serverId);
    if (existing === undefined) {
      throw new ConfigCenterValidationError(`MCP server not found: ${serverId}`);
    }
    const nextServer: McpServerSettings = {
      ...existing,
      lastConnectedAt: input.connectedAt ?? existing.lastConnectedAt,
      lastError: input.errorSummary,
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

  async writeMcpServerSecretValue(input: McpServerSecretValueInput): Promise<SanitizedMcpServerSecretMetadata> {
    const settings = await this.readOrCreateSettings();
    const serverId = normalizeProfileId(input.serverId);
    const server = (settings.mcpServers ?? []).find((item) => item.serverId === serverId);
    if (server === undefined) {
      throw new ConfigCenterValidationError(`MCP server not found: ${serverId}`);
    }
    const secretRef = normalizeRequiredConfigString(input.secretRef, "MCP secret ref");
    if (!mcpServerOwnsSecretRef(server, secretRef)) {
      throw new ConfigCenterValidationError(`MCP secret ref is not declared for server: ${serverId}`);
    }
    const value = normalizeRequiredConfigString(input.value, "MCP secret value");
    const metadata = await this.options.secretStore.writeSecret(secretRef, value);
    return { secretRef, ...metadata };
  }

  async getInformationAccessConfig(): Promise<SanitizedInformationAccessConfig> {
    const settings = await this.readOrCreateSettings();
    return toSanitizedInformationAccessConfig({ settings, secretStore: this.options.secretStore });
  }

  async getWebSearchConfig(): Promise<SanitizedWebSearchConfig> {
    const settings = await this.readOrCreateSettings();
    return toSanitizedWebSearchConfig({ settings, secretStore: this.options.secretStore });
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
    return toSanitizedInformationAccessConfig({
      settings: { ...current, informationAccess: nextInformation, updatedAt: now },
      secretStore: this.options.secretStore,
    });
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
    return toSanitizedWebSearchConfig({
      settings: { ...current, informationAccess: nextInformation, updatedAt: now },
      secretStore: this.options.secretStore,
    });
  }

  async getWorkspaceConfig(): Promise<SanitizedWorkspaceConfig> {
    const settings = await this.readOrCreateSettings();
    return toSanitizedWorkspaceConfig(settings);
  }

  async getCommandShellConfig(): Promise<SanitizedCommandShellConfig> {
    const settings = await this.readOrCreateSettings();
    return toSanitizedCommandShellConfig(settings.commandShell, { now: settings.updatedAt });
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
    return toSanitizedWorkspaceConfig(next);
  }

  async updateCommandShellConfig(input: UpdateCommandShellConfigInput): Promise<SanitizedCommandShellConfig> {
    const current = await this.readOrCreateSettings();
    const now = new Date().toISOString();
    const commandShell = normalizeCommandShellUpdate(input, now);
    const next: AgentArborLocalSettings = {
      ...current,
      version: 3,
      commandShell,
      updatedAt: now,
    };
    await this.options.settingsStore.writeSettings(next);
    return toSanitizedCommandShellConfig(commandShell, { now });
  }

  async createModelRuntimeEnvironment(
    input: CreateModelRuntimeEnvironmentInput = {}
  ): Promise<ModelRuntimeConfigEnvironment> {
    const settings = await this.readOrCreateSettings();
    const modelProvider = input.modelProvider ?? settings.modelProvider;
    const apiKey = await this.options.secretStore.readSecret(modelProvider.secretRef);
    const currentInformationAccess = normalizeInformationAccessSettings(settings.informationAccess, settings.updatedAt);
    const sourcePreference = input.informationAccess?.sourcePreference ?? currentInformationAccess.sourcePreference;
    const webProvider = input.informationAccess?.web.provider ?? currentInformationAccess.webSearch.provider;
    const tavilySecretRef = input.informationAccess?.web.secretRef ?? currentInformationAccess.tavily.secretRef;
    const tavilyMaxResults = input.informationAccess?.web.maxResults ?? currentInformationAccess.tavily.maxResults;
    const tavilyApiKey =
      webProvider === "none"
        ? undefined
        : await this.options.secretStore.readSecret(tavilySecretRef);
    return {
      AGENTARBOR_MODEL_API_KEY: apiKey,
      AGENTARBOR_MODEL_NAME: modelProvider.model,
      AGENTARBOR_MODEL_BASE_URL: normalizeBaseUrl(modelProvider.baseUrl) ?? DEFAULT_MODEL_PROVIDER_BASE_URL,
      AGENTARBOR_TAVILY_API_KEY: tavilyApiKey,
      AGENTARBOR_TAVILY_MAX_RESULTS: String(tavilyMaxResults),
      AGENTARBOR_INFORMATION_SOURCE_PREFERENCE: sourcePreference.join(","),
      TAVILY_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
    };
  }

  async createMcpRuntimeEnvironment(
    input: CreateMcpRuntimeEnvironmentInput = {}
  ): Promise<ModelRuntimeConfigEnvironment> {
    const settings = await this.readOrCreateSettings();
    const servers = input.servers ?? settings.mcpServers ?? [];
    const refs = new Set<string>();
    for (const server of servers) {
      for (const ref of server.envSecretRefs) {
        refs.add(ref);
      }
      for (const ref of server.headerSecretRefs ?? []) {
        const parsedRef = parseHeaderSecretRef(ref);
        if (parsedRef !== undefined) {
          refs.add(parsedRef.secretRef);
        }
      }
      if (server.bearerTokenSecretRef !== undefined) refs.add(server.bearerTokenSecretRef);
      if (server.apiKeySecretRef !== undefined) refs.add(server.apiKeySecretRef);
    }
    const output: Record<string, string | undefined> = { ...(input.baseEnv ?? {}) };
    for (const ref of refs) {
      output[ref] = input.baseEnv?.[ref] ?? await this.options.secretStore.readSecret(ref);
    }
    return output;
  }

  async createUndergroundAiEnvironment(
    input: CreateModelRuntimeEnvironmentInput = {}
  ): Promise<UndergroundAiConfigEnvironment> {
    return this.createModelRuntimeEnvironment(input);
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
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: DEFAULT_MODEL_PROVIDER_BASE_URL,
    defaultAiMode: current.defaultAiMode === "none" ? "none" : "openai-compatible",
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

function firstNonBlank(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    const normalized = normalizeOptionalString(value);
    if (normalized !== undefined) {
      return normalized;
    }
  }
  return undefined;
}

function mcpServerOwnsSecretRef(server: McpServerSettings, secretRef: string): boolean {
  return (
    server.envSecretRefs.includes(secretRef) ||
    (server.headerSecretRefs ?? []).some((ref) => parseHeaderSecretRef(ref)?.secretRef === secretRef || ref === secretRef) ||
    server.bearerTokenSecretRef === secretRef ||
    server.apiKeySecretRef === secretRef
  );
}

function parseHeaderSecretRef(value: string): { readonly headerName: string; readonly secretRef: string } | undefined {
  const separator = value.indexOf("=");
  if (separator <= 0) {
    return undefined;
  }
  const headerName = value.slice(0, separator).trim();
  const secretRef = value.slice(separator + 1).trim();
  return headerName.length === 0 || secretRef.length === 0 ? undefined : { headerName, secretRef };
}
