export type ConfiguredUndergroundAiMode = "none" | "fake" | "openai-compatible";

export type ModelProviderProfileSettings = {
  readonly profileId: "default";
  readonly providerKind: "openai_compatible";
  readonly protocolKind: "openai_compatible_chat_completions";
  readonly baseUrl: string;
  readonly model?: string;
  readonly defaultAiMode: ConfiguredUndergroundAiMode;
  readonly secretRef: string;
  readonly updatedAt: string;
};

export type AgentArborLocalSettings = {
  readonly version: 1;
  readonly modelProvider: ModelProviderProfileSettings;
  readonly updatedAt: string;
};

export type SanitizedModelProviderConfig = {
  readonly profileId: ModelProviderProfileSettings["profileId"];
  readonly providerKind: ModelProviderProfileSettings["providerKind"];
  readonly protocolKind: ModelProviderProfileSettings["protocolKind"];
  readonly baseUrl: string;
  readonly model?: string;
  readonly defaultAiMode: ConfiguredUndergroundAiMode;
  readonly secretRef: string;
  readonly secretConfigured: boolean;
  readonly secretUpdatedAt?: string;
  readonly updatedAt: string;
};

export type UpdateModelProviderConfigInput = {
  readonly baseUrl?: string;
  readonly model?: string;
  readonly defaultAiMode?: ConfiguredUndergroundAiMode;
  readonly apiKey?: string;
};

export type NormalSettingsStore = {
  readSettings(): Promise<AgentArborLocalSettings | undefined>;
  writeSettings(settings: AgentArborLocalSettings): Promise<void>;
};

export type SecretMetadata = {
  readonly configured: boolean;
  readonly updatedAt?: string;
};

export type LocalDevSecretStore = {
  getMetadata(secretRef: string): Promise<SecretMetadata>;
  readSecret(secretRef: string): Promise<string | undefined>;
  writeSecret(secretRef: string, value: string): Promise<SecretMetadata>;
};
