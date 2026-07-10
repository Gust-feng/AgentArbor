import {
  FakeModelProvider,
  OpenAICompatibleChatCompletionsProvider,
  OpenAIResponsesProvider,
  fetchAnthropicModelCatalog,
  fetchOpenAICompatibleModelCatalog,
  type ModelCatalogFetchLike,
} from "../../adapters/intelligence/index.js";
import { NativeIntelligenceChannel } from "../../kernel/intelligence/channel.js";
import type { IntelligenceChannel, ModelOutputDelta } from "../../domain/intelligence/index.js";
import type { InformationSourceKind } from "../../domain/research/index.js";
import type { TaskSoil } from "../../domain/soil/index.js";
import type {
  CapabilityToolAvailability,
  ModelCapabilities,
  ModelProviderModelCatalog,
  ProviderProtocolProfileId,
  SanitizedCommandShellConfig,
  SanitizedModelProviderConfig,
  ToolStateSettings,
} from "../../domain/config/index.js";
import type { ToolExecutionBroker } from "../../domain/tools/index.js";
import type { ConfigCenter } from "../config-center/index.js";
import type { MinimalRuntime } from "../runtime.js";
import { createDesktopBasicToolRegistry, type ToolRegistryFetchLike } from "../basic-agent-runtime/builtin-tool-runtime.js";
import type { McpToolExecutorProvider } from "../basic-agent-runtime/builtin-tool-runtime.js";
import type { ToolRegistryScope } from "../basic-agent-runtime/tool-registry.js";
import type { DesktopAgentSkillContext } from "../desktop-agent-contracts.js";
import type { LocalCommandProcessRegistry } from "../tool-center/adapters/local-workspace-command-tools.js";

export type ModelRuntimeMode = "none" | "fake" | "openai-compatible" | "openai-responses";
export type ModelRuntimeStreamingMode = "respect_profile" | "force_live";

export type ModelRuntimeEnvironment = Readonly<Record<string, string | undefined>>;
export type ModelRuntimeProviderFetch = ToolRegistryFetchLike;
export type ModelRuntimeModelCatalogFetch = ModelCatalogFetchLike;
export type ModelRuntimeSummaryInput = {
  readonly enabled: boolean;
  readonly mode: ModelRuntimeMode;
  readonly providerId?: string;
  readonly providerKind?: string;
  readonly protocolKind?: string;
  readonly model?: string;
  readonly configurationError?: {
    readonly code: string;
    readonly message: string;
  };
};

export type ModelRuntimeContextWindowExceededEvent = {
  readonly profileId?: string;
  readonly providerKind: "openai_compatible";
  readonly protocolKind: "openai_compatible_chat_completions" | "openai_responses";
  readonly model?: string;
  readonly message: string;
};

export type ModelRuntimeConfig =
  | {
      readonly enabled: false;
      readonly mode: "none";
      readonly summaryInput: ModelRuntimeSummaryInput;
    }
  | {
      readonly enabled: true;
      readonly mode: Exclude<ModelRuntimeMode, "none">;
      readonly summaryInput: ModelRuntimeSummaryInput;
      createIntelligenceChannel(runtime: MinimalRuntime): IntelligenceChannel;
      createToolCenter(runtime: MinimalRuntime): ToolExecutionBroker;
    };

export type ModelRuntimeConfigurationIssueCode = "ai_disabled" | "missing_api_key" | "missing_model_name";

export class ModelRuntimeConfigurationError extends Error {
  constructor(
    readonly issue: {
      readonly code: ModelRuntimeConfigurationIssueCode;
      readonly message: string;
      readonly summaryInput: ModelRuntimeSummaryInput;
    }
  ) {
    super(issue.message);
    this.name = "ModelRuntimeConfigurationError";
  }
}

export function createModelRuntimeDisabledConfigurationError(
  summaryInput: ModelRuntimeSummaryInput = { enabled: false, mode: "none" }
): ModelRuntimeConfigurationError {
  return new ModelRuntimeConfigurationError({
    code: "ai_disabled",
    message: "Agent model runtime requires an AgentTurnRuntime-backed AI mode.",
    summaryInput,
  });
}

const OPENAI_COMPATIBLE_PROVIDER_ID = "openai-compatible-chat-completions";
const OPENAI_COMPATIBLE_PROTOCOL = "openai_compatible_chat_completions";
const OPENAI_COMPATIBLE_DEFAULT_BASE_URL = "https://api.openai.com/v1";

const OPENAI_RESPONSES_PROVIDER_ID = "openai-responses";
const OPENAI_RESPONSES_PROTOCOL = "openai_responses";

export function createModelRuntimeConfig(input: {
  readonly mode?: ModelRuntimeMode;
  readonly env?: ModelRuntimeEnvironment;
  readonly modelProvider?: Pick<
    SanitizedModelProviderConfig,
    "providerKind" | "protocolKind" | "profileId" | "baseUrl" | "model" | "openAI"
  >;
  readonly fetch?: ModelRuntimeProviderFetch;
  readonly onModelOutputDelta?: (delta: ModelOutputDelta) => void;
  readonly onContextWindowExceeded?: (event: ModelRuntimeContextWindowExceededEvent) => void | Promise<void>;
  readonly streamingMode?: ModelRuntimeStreamingMode;
}): ModelRuntimeConfig {
  const mode = input.mode ?? modelRuntimeModeForProfile(input.modelProvider) ?? "none";

  if (mode === "none") {
    return {
      enabled: false,
      mode,
      summaryInput: {
        enabled: false,
        mode,
      },
    };
  }

  if (mode === "fake") {
    return {
      enabled: true,
      mode,
      summaryInput: {
        enabled: true,
        mode,
        providerId: "fake-model-provider",
        providerKind: "fake",
        protocolKind: OPENAI_COMPATIBLE_PROTOCOL,
        model: "fake-deterministic-model",
      },
      createIntelligenceChannel: (runtime) =>
        new NativeIntelligenceChannel({
          provider: new FakeModelProvider({ onOutputDelta: input.onModelOutputDelta }),
          bus: runtime.bus,
        }),
      createToolCenter: (runtime) => createDefaultToolCenter({ runtime, env: input.env ?? process.env, fetch: input.fetch }),
    };
  }

  if (mode === "openai-responses") {
    return createOpenAIResponsesConfig({
      env: input.env ?? process.env,
      modelProvider: input.modelProvider,
      fetch: input.fetch,
      onModelOutputDelta: input.onModelOutputDelta,
      onContextWindowExceeded: input.onContextWindowExceeded,
      streamingMode: input.streamingMode,
    });
  }

  return createOpenAICompatibleConfig({
    env: input.env ?? process.env,
    modelProvider: input.modelProvider,
    fetch: input.fetch,
    onModelOutputDelta: input.onModelOutputDelta,
    onContextWindowExceeded: input.onContextWindowExceeded,
    streamingMode: input.streamingMode,
  });
}

export async function fetchModelRuntimeModelCatalog(input: {
  readonly profile: Pick<SanitizedModelProviderConfig, "profileId" | "label" | "baseUrl" | "providerKind" | "protocolKind">;
  readonly apiKey: string;
  readonly fetch?: ModelRuntimeModelCatalogFetch;
  readonly abortSignal?: AbortSignal;
}): Promise<ModelProviderModelCatalog> {
  if (input.profile.providerKind === "anthropic" && input.profile.protocolKind === "anthropic_messages") {
    return fetchAnthropicModelCatalog(input);
  }
  return fetchOpenAICompatibleModelCatalog(input);
}

function createOpenAICompatibleConfig(input: {
  readonly env: ModelRuntimeEnvironment;
  readonly modelProvider?: Pick<SanitizedModelProviderConfig, "profileId" | "baseUrl" | "model" | "openAI">;
  readonly fetch?: ModelRuntimeProviderFetch;
  readonly onModelOutputDelta?: (delta: ModelOutputDelta) => void;
  readonly onContextWindowExceeded?: (event: ModelRuntimeContextWindowExceededEvent) => void | Promise<void>;
  readonly streamingMode?: ModelRuntimeStreamingMode;
}): ModelRuntimeConfig {
  const apiKey = firstNonBlank(input.env.AGENTARBOR_MODEL_API_KEY, input.env.OPENAI_API_KEY);
  const model = firstNonBlank(input.modelProvider?.model, input.env.AGENTARBOR_MODEL_NAME);
  const baseUrl =
    firstNonBlank(input.modelProvider?.baseUrl, input.env.AGENTARBOR_MODEL_BASE_URL) ??
    OPENAI_COMPATIBLE_DEFAULT_BASE_URL;
  const summaryInput: ModelRuntimeSummaryInput = {
    enabled: true,
    mode: "openai-compatible",
    providerId: OPENAI_COMPATIBLE_PROVIDER_ID,
    providerKind: "openai_compatible",
    protocolKind: OPENAI_COMPATIBLE_PROTOCOL,
    model,
  };

  if (apiKey === undefined) {
    throw new ModelRuntimeConfigurationError({
      code: "missing_api_key",
      message:
        "--ai openai-compatible requires AGENTARBOR_MODEL_API_KEY or OPENAI_API_KEY; no network request was attempted.",
      summaryInput,
    });
  }

  if (model === undefined) {
    throw new ModelRuntimeConfigurationError({
      code: "missing_model_name",
      message:
        "--ai openai-compatible requires AGENTARBOR_MODEL_NAME; no network request was attempted.",
      summaryInput,
    });
  }

  return {
    enabled: true,
    mode: "openai-compatible",
    summaryInput,
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new OpenAICompatibleChatCompletionsProvider({
          providerId: OPENAI_COMPATIBLE_PROVIDER_ID,
          baseUrl,
          apiKey,
          model,
          providerProfileId: providerProfileIdFromConfig(input.modelProvider?.profileId),
          fetch: input.fetch,
          stream: input.onModelOutputDelta !== undefined,
          forceStreaming: input.streamingMode === "force_live" && input.onModelOutputDelta !== undefined,
          requestSettings: input.modelProvider?.openAI,
          onContextWindowExceeded: (event) =>
            input.onContextWindowExceeded?.({
              profileId: input.modelProvider?.profileId,
              providerKind: "openai_compatible",
              protocolKind: OPENAI_COMPATIBLE_PROTOCOL,
              model,
              message: event.message,
            }),
          onOutputDelta: input.onModelOutputDelta,
        }),
        bus: runtime.bus,
      }),
    createToolCenter: (runtime) => createDefaultToolCenter({ runtime, env: input.env, fetch: input.fetch }),
  };
}

function createOpenAIResponsesConfig(input: {
  readonly env: ModelRuntimeEnvironment;
  readonly modelProvider?: Pick<SanitizedModelProviderConfig, "profileId" | "baseUrl" | "model" | "openAI">;
  readonly fetch?: ModelRuntimeProviderFetch;
  readonly onModelOutputDelta?: (delta: ModelOutputDelta) => void;
  readonly onContextWindowExceeded?: (event: ModelRuntimeContextWindowExceededEvent) => void | Promise<void>;
  readonly streamingMode?: ModelRuntimeStreamingMode;
}): ModelRuntimeConfig {
  const apiKey = firstNonBlank(input.env.AGENTARBOR_MODEL_API_KEY, input.env.OPENAI_API_KEY);
  const model = firstNonBlank(input.modelProvider?.model, input.env.AGENTARBOR_MODEL_NAME);
  const baseUrl =
    firstNonBlank(input.modelProvider?.baseUrl, input.env.AGENTARBOR_MODEL_BASE_URL) ??
    OPENAI_COMPATIBLE_DEFAULT_BASE_URL;
  const summaryInput: ModelRuntimeSummaryInput = {
    enabled: true,
    mode: "openai-responses",
    providerId: OPENAI_RESPONSES_PROVIDER_ID,
    providerKind: "openai_compatible",
    protocolKind: OPENAI_RESPONSES_PROTOCOL,
    model,
  };

  if (apiKey === undefined) {
    throw new ModelRuntimeConfigurationError({
      code: "missing_api_key",
      message:
        "--ai openai-responses requires AGENTARBOR_MODEL_API_KEY or OPENAI_API_KEY; no network request was attempted.",
      summaryInput,
    });
  }

  if (model === undefined) {
    throw new ModelRuntimeConfigurationError({
      code: "missing_model_name",
      message:
        "--ai openai-responses requires AGENTARBOR_MODEL_NAME; no network request was attempted.",
      summaryInput,
    });
  }

  return {
    enabled: true,
    mode: "openai-responses",
    summaryInput,
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new OpenAIResponsesProvider({
          providerId: OPENAI_RESPONSES_PROVIDER_ID,
          baseUrl,
          apiKey,
          model,
          fetch: input.fetch,
          stream: input.onModelOutputDelta !== undefined,
          forceStreaming: input.streamingMode === "force_live" && input.onModelOutputDelta !== undefined,
          requestSettings: input.modelProvider?.openAI,
          enableWebSearch: enabledFlag(input.env.AGENTARBOR_MODEL_BUILTIN_WEB_SEARCH),
          onContextWindowExceeded: (event) =>
            input.onContextWindowExceeded?.({
              profileId: input.modelProvider?.profileId,
              providerKind: "openai_compatible",
              protocolKind: OPENAI_RESPONSES_PROTOCOL,
              model,
              message: event.message,
            }),
          onOutputDelta: input.onModelOutputDelta,
        }),
        bus: runtime.bus,
      }),
    createToolCenter: (runtime) => createDefaultToolCenter({ runtime, env: input.env, fetch: input.fetch }),
  };
}

export function createDefaultToolCenter(input: {
  readonly runtime?: MinimalRuntime;
  readonly env?: ModelRuntimeEnvironment;
  readonly fetch?: ModelRuntimeProviderFetch;
  readonly sourcePreference?: readonly InformationSourceKind[];
  readonly tavilyMaxResults?: number;
  readonly workspaceRoot?: string;
  readonly playwrightAvailable?: boolean;
  readonly toolStates?: readonly ToolStateSettings[];
  readonly toolCatalogNames?: readonly string[];
  readonly toolCatalogAvailability?: readonly CapabilityToolAvailability[];
  readonly mcpManager?: McpToolExecutorProvider;
  readonly toolRegistryScopes?: readonly ToolRegistryScope[];
  readonly commandShell?: SanitizedCommandShellConfig;
  readonly processRegistry?: LocalCommandProcessRegistry;
  readonly skillContexts?: readonly DesktopAgentSkillContext[];
  readonly includeSkillResourceToolCatalog?: boolean;
  readonly taskSoil?: TaskSoil;
  readonly modelCapabilities?: ModelCapabilities;
} = {}): ToolExecutionBroker {
  return createToolCenterFromEnvironment(input);
}

export async function createConfiguredToolCenter(
  configCenter: ConfigCenter,
  input: {
    readonly runtime?: MinimalRuntime;
    readonly env?: ModelRuntimeEnvironment;
    readonly fetch?: ModelRuntimeProviderFetch;
    readonly sourcePreference?: readonly InformationSourceKind[];
    readonly tavilyMaxResults?: number;
    readonly workspaceRoot?: string;
    readonly playwrightAvailable?: boolean;
    readonly toolStates?: readonly ToolStateSettings[];
    readonly toolCatalogNames?: readonly string[];
    readonly toolCatalogAvailability?: readonly CapabilityToolAvailability[];
    readonly mcpManager?: McpToolExecutorProvider;
    readonly toolRegistryScopes?: readonly ToolRegistryScope[];
    readonly commandShell?: SanitizedCommandShellConfig;
    readonly processRegistry?: LocalCommandProcessRegistry;
    readonly skillContexts?: readonly DesktopAgentSkillContext[];
    readonly includeSkillResourceToolCatalog?: boolean;
    readonly taskSoil?: TaskSoil;
    readonly modelCapabilities?: ModelCapabilities;
  } = {}
): Promise<ToolExecutionBroker> {
  return createToolCenterFromEnvironment({
    ...input,
    env: input.env ?? await configCenter.createModelRuntimeEnvironment(),
  });
}

export async function createConfiguredToolCenterFactory(
  configCenter: ConfigCenter,
  input: {
    readonly env?: ModelRuntimeEnvironment;
    readonly fetch?: ModelRuntimeProviderFetch;
    readonly sourcePreference?: readonly InformationSourceKind[];
    readonly tavilyMaxResults?: number;
    readonly workspaceRoot?: string;
    readonly playwrightAvailable?: boolean;
    readonly toolStates?: readonly ToolStateSettings[];
    readonly toolCatalogNames?: readonly string[];
    readonly toolCatalogAvailability?: readonly CapabilityToolAvailability[];
    readonly mcpManager?: McpToolExecutorProvider;
    readonly toolRegistryScopes?: readonly ToolRegistryScope[];
    readonly commandShell?: SanitizedCommandShellConfig;
    readonly processRegistry?: LocalCommandProcessRegistry;
    readonly skillContexts?: readonly DesktopAgentSkillContext[];
    readonly includeSkillResourceToolCatalog?: boolean;
    readonly taskSoil?: TaskSoil;
    readonly modelCapabilities?: ModelCapabilities;
  } = {}
): Promise<(runtime: MinimalRuntime) => ToolExecutionBroker> {
  const env = input.env ?? await configCenter.createModelRuntimeEnvironment();
  return (runtime) => createToolCenterFromEnvironment({ ...input, runtime, env });
}

function createToolCenterFromEnvironment(input: {
  readonly runtime?: MinimalRuntime;
  readonly env?: ModelRuntimeEnvironment;
  readonly fetch?: ModelRuntimeProviderFetch;
  readonly sourcePreference?: readonly InformationSourceKind[];
  readonly tavilyMaxResults?: number;
  readonly workspaceRoot?: string;
  readonly playwrightAvailable?: boolean;
  readonly toolStates?: readonly ToolStateSettings[];
  readonly toolCatalogNames?: readonly string[];
  readonly toolCatalogAvailability?: readonly CapabilityToolAvailability[];
  readonly mcpManager?: McpToolExecutorProvider;
  readonly toolRegistryScopes?: readonly ToolRegistryScope[];
  readonly commandShell?: SanitizedCommandShellConfig;
  readonly processRegistry?: LocalCommandProcessRegistry;
  readonly skillContexts?: readonly DesktopAgentSkillContext[];
  readonly includeSkillResourceToolCatalog?: boolean;
  readonly taskSoil?: TaskSoil;
  readonly modelCapabilities?: ModelCapabilities;
}): ToolExecutionBroker {
  return createDesktopBasicToolRegistry(input).createToolCenterForScopes(input.toolRegistryScopes ?? ["desktop-basic"]);
}

function firstNonBlank(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function enabledFlag(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function providerProfileIdFromConfig(value: string | undefined): ProviderProtocolProfileId | undefined {
  if (
    value === "openai" ||
    value === "anthropic" ||
    value === "gemini" ||
    value === "deepseek" ||
    value === "moonshot" ||
    value === "glm" ||
    value === "minimax" ||
    value === "openai_compatible"
  ) {
    return value;
  }
  return undefined;
}

function modelRuntimeModeForProfile(
  profile: Pick<SanitizedModelProviderConfig, "providerKind" | "protocolKind"> | undefined
): ModelRuntimeMode | undefined {
  if (profile?.providerKind !== "openai_compatible") {
    return undefined;
  }
  return profile.protocolKind === "openai_compatible_chat_completions" ? "openai-compatible" : "openai-responses";
}
