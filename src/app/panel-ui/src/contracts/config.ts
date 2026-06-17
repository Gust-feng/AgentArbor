export type ConfigResponse = {
  readonly product?: ProductInfo;
  readonly appearance?: AppearanceConfig;
  readonly config?: {
    readonly profileId?: string;
    readonly label?: string;
    readonly providerKind?: string;
    readonly protocolKind?: string;
    readonly baseUrl?: string;
    readonly model?: string;
    readonly defaultAiMode?: "none" | "fake" | "openai-compatible" | "openai-responses";
    readonly secretConfigured?: boolean;
  };
  readonly profile?: ModelProviderProfile;
  readonly profiles?: readonly ModelProviderProfile[];
  readonly modelProviderOrder?: readonly string[];
  readonly modelCatalogs?: readonly ModelProviderModelCatalog[];
  readonly modelProviderMarket?: {
    readonly presets?: readonly ModelProviderPreset[];
  };
  readonly workspace?: {
    readonly workspaceDirectory?: string;
  };
  readonly commandShell?: CommandShellConfig;
  readonly toolConfirmation?: ToolConfirmationConfig;
  readonly capabilities?: {
    readonly activeModel?: { readonly label?: string; readonly model?: string; readonly secretConfigured?: boolean };
    readonly toolConfirmation?: ToolConfirmationConfig;
    readonly modelCapabilities?: {
      readonly contextWindowTokens?: number;
      readonly maxOutputTokens?: number;
      readonly supportsToolCalling?: boolean;
      readonly supportsReasoningEffort?: boolean;
    };
    readonly warnings?: readonly string[];
  };
};

export type ModelProviderProfile = NonNullable<ConfigResponse["config"]>;

export type ProductInfo = {
  readonly name?: string;
  readonly version?: string;
  readonly defaultEntry?: string;
  readonly runtimeMode?: "agent";
  readonly runtimeModeLabel?: string;
  readonly configDirectory?: string;
  readonly runtimeDirectory?: string;
};

export type AppearanceConfig = {
  readonly source?: "builtin_panel_styles" | "user_config" | string;
  readonly themeLabel?: string;
  readonly densityLabel?: string;
  readonly colorScheme?: "light" | "dark" | string;
  readonly configurable?: boolean;
  readonly updatedAt?: string;
};

export type CommandShellKind = "cmd" | "powershell" | "pwsh" | "bash" | "sh";

export type ToolConfirmationPolicy = "prompt" | "full_access";

export type ToolConfirmationConfig = {
  readonly policy?: ToolConfirmationPolicy;
  readonly label?: string;
  readonly shellCommandConfirmation?: "prompt" | "skipped_by_full_access";
  readonly shellCommandRequiresConfirmation?: boolean;
  readonly summary?: string;
  readonly riskDisclosure?: string;
  readonly updatedAt?: string;
};

export type CommandShellConfig = {
  readonly kind?: CommandShellKind;
  readonly label?: string;
  readonly executable?: string;
  readonly syntax?: "cmd" | "powershell" | "posix";
  readonly platform?: string;
  readonly invocation?: readonly string[];
  readonly commandLineParameter?: "commandLine";
  readonly notes?: readonly string[];
  readonly updatedAt?: string;
};

export type ModelProviderPreset = {
  readonly presetId: string;
  readonly label: string;
  readonly vendor: string;
  readonly description: string;
  readonly providerKind: string;
  readonly protocolKind: string;
  readonly baseUrl: string;
  readonly modelsPath: string;
  readonly defaultModel?: string;
  readonly regionLabel?: string;
  readonly docsUrl?: string;
};

export type ModelProviderModelCatalog = {
  readonly profileId: string;
  readonly label?: string;
  readonly baseUrl: string;
  readonly modelsPath: string;
  readonly fetchedAt: string;
  readonly models: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly owner?: string;
    readonly createdAt?: string;
  }[];
};
