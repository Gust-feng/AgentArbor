import type {
  ToolCategory,
  ToolOperationType,
  ToolRiskLevel,
  ToolVisibleResultPolicy,
} from "../tools/index.js";

export type ConfiguredUndergroundAiMode = "none" | "fake" | "openai-compatible";

export type ConfiguredWebSearchProvider = "tavily" | "none";

export type ConfiguredModelProviderKind =
  | "openai_compatible"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "local";

export type ConfiguredModelProtocolKind =
  | "openai_compatible_chat_completions"
  | "anthropic_messages"
  | "gemini_generate_content"
  | "ollama_generate";

export type ModelPreferredApiStyle =
  | "chat_completions"
  | "responses"
  | "messages"
  | "gemini_generate_content"
  | "openai_compatible";

export type ModelStability = "stable" | "preview" | "deprecated" | "unknown";

export type ModelCapabilities = {
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly supportsToolCalling: boolean;
  readonly supportsParallelToolCalls: boolean;
  readonly supportsStructuredOutputs: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsVisionInput: boolean;
  readonly supportsReasoningEffort: boolean;
  readonly preferredApiStyle: ModelPreferredApiStyle;
  readonly stability: ModelStability;
  readonly lastVerifiedAt?: string;
};

export type ModelCapabilityOverrideSettings = {
  readonly providerKind?: ConfiguredModelProviderKind;
  readonly model: string;
  readonly capabilities: Partial<ModelCapabilities>;
  readonly updatedAt: string;
};

export type ToolStateSettings = {
  readonly name: string;
  readonly enabled: boolean;
  readonly updatedAt: string;
};

export type McpServerTransportKind = "stdio" | "http";

export type McpServerSettings = {
  readonly serverId: string;
  readonly label: string;
  readonly transport: McpServerTransportKind;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly envSecretRefs: readonly string[];
  readonly enabled: boolean;
  readonly updatedAt: string;
};

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
  readonly profileId: string;
  readonly label: string;
  readonly providerKind: ConfiguredModelProviderKind;
  readonly protocolKind: ConfiguredModelProtocolKind;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly defaultAiMode: ConfiguredUndergroundAiMode;
  readonly secretRef: string;
  readonly enabled: boolean;
  readonly updatedAt: string;
};

export type AgentArborLocalSettings = {
  readonly version: 1 | 2 | 3;
  readonly modelProvider: ModelProviderProfileSettings;
  readonly activeModelProfileId: string;
  readonly modelProfiles: readonly ModelProviderProfileSettings[];
  readonly modelCapabilityOverrides?: readonly ModelCapabilityOverrideSettings[];
  readonly toolStates?: readonly ToolStateSettings[];
  readonly mcpServers?: readonly McpServerSettings[];
  readonly informationAccess?: InformationAccessSettings;
  readonly workspaceDirectory?: string;
  readonly updatedAt: string;
};

export type SanitizedModelProviderConfig = {
  readonly profileId: string;
  readonly label?: string;
  readonly providerKind: ModelProviderProfileSettings["providerKind"];
  readonly protocolKind: ModelProviderProfileSettings["protocolKind"];
  readonly baseUrl: string;
  readonly model?: string;
  readonly defaultAiMode: ConfiguredUndergroundAiMode;
  readonly secretRef: string;
  readonly enabled?: boolean;
  readonly secretConfigured: boolean;
  readonly secretUpdatedAt?: string;
  readonly updatedAt: string;
};

export type UpdateModelProviderConfigInput = {
  readonly profileId?: string;
  readonly label?: string;
  readonly providerKind?: ConfiguredModelProviderKind;
  readonly protocolKind?: ConfiguredModelProtocolKind;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly defaultAiMode?: ConfiguredUndergroundAiMode;
  readonly enabled?: boolean;
  readonly apiKey?: string;
};

export type CreateModelProviderProfileInput = UpdateModelProviderConfigInput & {
  readonly profileId: string;
  readonly label?: string;
};

export type UpdateToolStateInput = {
  readonly name: string;
  readonly enabled: boolean;
};

export type UpsertMcpServerInput = {
  readonly serverId: string;
  readonly label?: string;
  readonly transport?: McpServerTransportKind;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly envSecretRefs?: readonly string[];
  readonly enabled?: boolean;
};

export type CapabilityToolCatalogItem = {
  readonly name: string;
  readonly description: string;
  readonly category: ToolCategory;
  readonly riskLevel: ToolRiskLevel;
  readonly operationType: ToolOperationType;
  readonly requiresConfirmation: boolean;
  readonly visibleResultPolicy: ToolVisibleResultPolicy;
  readonly enabled: boolean;
  readonly availability: "available" | "unavailable";
  readonly disabledReason?: string;
};

export type CapabilitySkillCatalogItem = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly sourcePath: string;
  readonly triggers: readonly string[];
  readonly lastUsedAt?: string;
};

export type CapabilityMcpCatalogItem = {
  readonly serverId: string;
  readonly label: string;
  readonly transport: McpServerTransportKind;
  readonly enabled: boolean;
  readonly availability: "configured" | "disabled" | "unavailable";
  readonly commandSummary?: string;
  readonly url?: string;
  readonly envSecretRefCount: number;
  readonly updatedAt: string;
};

export type BasicAgentCapabilitySnapshot = {
  readonly snapshotId: string;
  readonly createdAt: string;
  readonly activeModel: SanitizedModelProviderConfig;
  readonly modelCapabilities: ModelCapabilities;
  readonly toolCatalog: {
    readonly scope: "desktop-basic";
    readonly tools: readonly CapabilityToolCatalogItem[];
    readonly allowedTools: readonly string[];
  };
  readonly skillCatalog: readonly CapabilitySkillCatalogItem[];
  readonly mcpCatalog: readonly CapabilityMcpCatalogItem[];
  readonly workspace: SanitizedWorkspaceConfig;
  readonly securitySummary: string;
  readonly warnings: readonly string[];
};

export type RunToolExposure = {
  readonly name: string;
  readonly enabled: boolean;
  readonly modelVisible: boolean;
  readonly availability: CapabilityToolCatalogItem["availability"];
  readonly riskLevel: ToolRiskLevel;
  readonly operationType: ToolOperationType;
  readonly requiresConfirmation: boolean;
  readonly reason: string;
};

export type CapabilityDraft = {
  readonly draftId: string;
  readonly source: "mcp";
  readonly label: string;
  readonly availability: CapabilityMcpCatalogItem["availability"];
  readonly enabled: boolean;
  readonly reason: string;
};

export type RunCapabilityResolution = {
  readonly resolutionId: string;
  readonly snapshotId: string;
  readonly runMode: "agent" | "deep";
  readonly allowedTools: readonly string[];
  readonly toolExposures: readonly RunToolExposure[];
  readonly enabledSkills: readonly CapabilitySkillCatalogItem[];
  readonly mcpDrafts: readonly CapabilityDraft[];
  readonly warnings: readonly string[];
  readonly createdAt: string;
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
  readSettings(): Promise<unknown | undefined>;
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
