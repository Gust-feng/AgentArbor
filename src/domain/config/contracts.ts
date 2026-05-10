export type ConfiguredUndergroundAiMode = "none" | "fake" | "openai-compatible";

export type ConfiguredWebSearchProvider = "tavily" | "none";

export type ConfiguredInformationSourceKind =
  | "web"
  | "page"
  | "codebase"
  | "soil"
  | "run_memory"
  | "docs"
  | "packages"
  | "github";

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
  readonly version: 1 | 2;
  readonly modelProvider: ModelProviderProfileSettings;
  readonly informationAccess?: InformationAccessSettings;
  readonly workspaceDirectory?: string;
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

export type InformationAccessSettings = {
  readonly sourcePreference: readonly ConfiguredInformationSourceKind[];
  readonly webSearch: {
    readonly provider: ConfiguredWebSearchProvider;
    readonly updatedAt: string;
  };
  readonly tavily: {
    readonly providerKind: "tavily";
    readonly maxResults: number;
    readonly secretRef: string;
    readonly updatedAt: string;
  };
};

export type SanitizedInformationAccessConfig = {
  readonly sourcePreference: readonly ConfiguredInformationSourceKind[];
  readonly web: {
    readonly provider: ConfiguredWebSearchProvider;
    readonly providerKind: "tavily";
    readonly maxResults: number;
    readonly secretRef: string;
    readonly secretConfigured: boolean;
    readonly secretUpdatedAt?: string;
    readonly status: "ready" | "no-provider" | "disabled";
    readonly updatedAt: string;
  };
  readonly stubs: Readonly<Record<"docs" | "packages" | "github" | "run_memory", "stub" | "readonly_stub">>;
};

export type SanitizedWebSearchConfig = {
  readonly provider: ConfiguredWebSearchProvider;
  readonly maxResults: number;
  readonly secretRef: string;
  readonly secretConfigured: boolean;
  readonly secretUpdatedAt?: string;
  readonly status: "ready" | "no-provider" | "disabled";
  readonly updatedAt: string;
};

export type UpdateInformationAccessConfigInput = {
  readonly sourcePreference?: readonly ConfiguredInformationSourceKind[];
  readonly tavilyMaxResults?: number;
  readonly tavilyApiKey?: string;
};

export type UpdateWebSearchConfigInput = {
  readonly provider?: ConfiguredWebSearchProvider;
  readonly apiKey?: string;
  readonly tavilyApiKey?: string;
  readonly maxResults?: number;
  readonly tavilyMaxResults?: number;
};

export type SanitizedWorkspaceConfig = {
  readonly workspaceDirectory: string;
  readonly updatedAt: string;
};

export type UpdateWorkspaceConfigInput = {
  readonly workspaceDirectory: string;
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
