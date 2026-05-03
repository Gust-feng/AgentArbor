import {
  FileSystemLocalDevSecretStore,
  FileSystemNormalSettingsStore,
  resolveAgentArborConfigDirectory,
  type AgentArborConfigDirectoryEnvironment,
} from "../adapters/config/index.js";
import type {
  AgentArborLocalSettings,
  ConfiguredUndergroundAiMode,
  LocalDevSecretStore,
  NormalSettingsStore,
  SanitizedModelProviderConfig,
  UpdateModelProviderConfigInput,
} from "../domain/config/index.js";

export const DEFAULT_MODEL_PROVIDER_BASE_URL = "https://api.openai.com";
export const MODEL_PROVIDER_SECRET_REF = "secret://local-dev/model-provider/default/api-key";

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
      version: 1,
      modelProvider: {
        ...current.modelProvider,
        baseUrl: normalizeBaseUrl(input.baseUrl) ?? current.modelProvider.baseUrl,
        model: normalizeOptionalString(input.model) ?? current.modelProvider.model,
        defaultAiMode: normalizeAiMode(input.defaultAiMode) ?? current.modelProvider.defaultAiMode,
        updatedAt: now,
      },
      updatedAt: now,
    };

    const apiKey = normalizeOptionalString(input.apiKey);
    if (apiKey !== undefined) {
      await this.options.secretStore.writeSecret(next.modelProvider.secretRef, apiKey);
    }

    await this.options.settingsStore.writeSettings(next);
    return this.toSanitizedConfig(next);
  }

  async createUndergroundAiEnvironment(): Promise<UndergroundAiConfigEnvironment> {
    const settings = await this.readOrCreateSettings();
    const apiKey = await this.options.secretStore.readSecret(settings.modelProvider.secretRef);
    return {
      AGENTARBOR_MODEL_API_KEY: apiKey,
      AGENTARBOR_MODEL_NAME: settings.modelProvider.model,
      AGENTARBOR_MODEL_BASE_URL: settings.modelProvider.baseUrl,
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
    version: 1,
    modelProvider: {
      profileId: "default",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: DEFAULT_MODEL_PROVIDER_BASE_URL,
      defaultAiMode: "none",
      secretRef: MODEL_PROVIDER_SECRET_REF,
      updatedAt: now,
    },
    updatedAt: now,
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
