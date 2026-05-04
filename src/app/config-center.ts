import {
  FileSystemLocalDevSecretStore,
  FileSystemNormalSettingsStore,
  resolveAgentArborConfigDirectory,
  type AgentArborConfigDirectoryEnvironment,
} from "../adapters/config/index.js";
import type {
  AgentArborLocalSettings,
  ConfiguredUndergroundAiMode,
  ConfiguredWebSearchProvider,
  LocalDevSecretStore,
  NormalSettingsStore,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
  SanitizedWebSearchConfig,
  UpdateInformationAccessConfigInput,
  UpdateModelProviderConfigInput,
  UpdateWebSearchConfigInput,
} from "../domain/config/index.js";
import type { ConfiguredInformationSourceKind, InformationAccessSettings } from "../domain/config/index.js";

export const DEFAULT_MODEL_PROVIDER_BASE_URL = "https://api.openai.com";
export const MODEL_PROVIDER_SECRET_REF = "secret://local-dev/model-provider/default/api-key";
export const INFORMATION_TAVILY_SECRET_REF = "secret://local-dev/information-source/tavily/default/api-key";
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

export type ConfigCenterOptions = {
  readonly settingsStore: NormalSettingsStore;
  readonly secretStore: LocalDevSecretStore;
};

export type CreateLocalConfigCenterOptions = {
  readonly configDirectory?: string;
  readonly env?: AgentArborConfigDirectoryEnvironment;
};

export type UndergroundAiConfigEnvironment = Readonly<Record<string, string | undefined>>;

export class ConfigCenter {
  constructor(private readonly options: ConfigCenterOptions) {}

  async getModelProviderConfig(): Promise<SanitizedModelProviderConfig> {
    const settings = await this.readOrCreateSettings();
    return this.toSanitizedConfig(settings);
  }

  async updateModelProviderConfig(
    input: UpdateModelProviderConfigInput
  ): Promise<SanitizedModelProviderConfig> {
    const current = await this.readOrCreateSettings();
    const now = new Date().toISOString();
    const next: AgentArborLocalSettings = {
      version: 2,
      modelProvider: {
        ...current.modelProvider,
        baseUrl: normalizeBaseUrl(input.baseUrl) ?? current.modelProvider.baseUrl,
        model: normalizeOptionalString(input.model) ?? current.modelProvider.model,
        defaultAiMode: normalizeAiMode(input.defaultAiMode) ?? current.modelProvider.defaultAiMode,
        updatedAt: now,
      },
      informationAccess: normalizeInformationAccessSettings(current.informationAccess, now),
      updatedAt: now,
    };

    const apiKey = normalizeOptionalString(input.apiKey);
    if (apiKey !== undefined) {
      await this.options.secretStore.writeSecret(next.modelProvider.secretRef, apiKey);
    }

    await this.options.settingsStore.writeSettings(next);
    return this.toSanitizedConfig(next);
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
      version: 2,
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
      version: 2,
      informationAccess: nextInformation,
      updatedAt: now,
    });
    return this.toSanitizedWebSearchConfig({ ...current, informationAccess: nextInformation, updatedAt: now });
  }

  async createUndergroundAiEnvironment(): Promise<UndergroundAiConfigEnvironment> {
    const settings = await this.readOrCreateSettings();
    const apiKey = await this.options.secretStore.readSecret(settings.modelProvider.secretRef);
    const informationAccess = normalizeInformationAccessSettings(settings.informationAccess, settings.updatedAt);
    const tavilyApiKey =
      informationAccess.webSearch.provider === "none"
        ? undefined
        : await this.options.secretStore.readSecret(informationAccess.tavily.secretRef);
    return {
      AGENTARBOR_MODEL_API_KEY: apiKey,
      AGENTARBOR_MODEL_NAME: settings.modelProvider.model,
      AGENTARBOR_MODEL_BASE_URL: settings.modelProvider.baseUrl,
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
      return existing;
    }
    const created = createDefaultLocalSettings();
    await this.options.settingsStore.writeSettings(created);
    return created;
  }

  private async toSanitizedConfig(settings: AgentArborLocalSettings): Promise<SanitizedModelProviderConfig> {
    const secret = await this.options.secretStore.getMetadata(settings.modelProvider.secretRef);
    return {
      profileId: settings.modelProvider.profileId,
      providerKind: settings.modelProvider.providerKind,
      protocolKind: settings.modelProvider.protocolKind,
      baseUrl: settings.modelProvider.baseUrl,
      model: settings.modelProvider.model,
      defaultAiMode: settings.modelProvider.defaultAiMode,
      secretRef: settings.modelProvider.secretRef,
      secretConfigured: secret.configured,
      secretUpdatedAt: secret.updatedAt,
      updatedAt: settings.modelProvider.updatedAt,
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
  return {
    version: 2,
    modelProvider: {
      profileId: "default",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: DEFAULT_MODEL_PROVIDER_BASE_URL,
      defaultAiMode: "none",
      secretRef: MODEL_PROVIDER_SECRET_REF,
      updatedAt: now,
    },
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
