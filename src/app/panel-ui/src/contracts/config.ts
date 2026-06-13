export type ConfigResponse = {
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
  readonly capabilities?: {
    readonly activeModel?: { readonly label?: string; readonly model?: string; readonly secretConfigured?: boolean };
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

export type CommandShellKind = "cmd" | "powershell" | "pwsh" | "bash" | "sh";

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
