import {
  FakeModelProvider,
  OpenAICompatibleChatCompletionsProvider,
  OpenAIResponsesProvider,
  fetchAnthropicModelCatalog,
  fetchOpenAICompatibleModelCatalog,
  type ModelCatalogFetchLike,
} from "../../adapters/intelligence/index.js";
import { NativeIntelligenceChannel } from "../../kernel/intelligence/channel.js";
import type { InMemoryMessageBus } from "../../kernel/messages/in-memory-message-bus.js";
import type { IntelligenceChannel, ModelOutputDelta } from "../../domain/intelligence/index.js";
import type {
  ModelProviderModelCatalog,
  ProviderProtocolProfileId,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type { ModelRuntimeMode } from "./contracts.js";

export type ModelRuntimeStreamingMode = "respect_profile" | "force_live";

export type ModelRuntimeEnvironment = Readonly<Record<string, string | undefined>>;
export type ModelRuntimeProviderFetch = (
  url: string,
  init: {
    readonly method: "GET" | "POST";
    readonly headers: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  }
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
  readonly text?: () => Promise<string>;
}>;
export type ModelRuntimeModelCatalogFetch = ModelCatalogFetchLike;
export type ModelRuntimeChannelContext = {
  readonly bus: InMemoryMessageBus;
};
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
      createIntelligenceChannel(context: ModelRuntimeChannelContext): IntelligenceChannel;
    };

export type ModelRuntimeConfigurationIssueCode =
  | "ai_disabled"
  | "missing_api_key"
  | "missing_model_name"
  | "unsupported_provider_protocol";

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

export type OpenAIModelRuntimeMode = "openai-compatible" | "openai-responses";

export type ResolvedOpenAIModelRuntimeConfig = {
  readonly mode: OpenAIModelRuntimeMode;
  readonly protocol: typeof OPENAI_COMPATIBLE_PROTOCOL | typeof OPENAI_RESPONSES_PROTOCOL;
  readonly providerId: typeof OPENAI_COMPATIBLE_PROVIDER_ID | typeof OPENAI_RESPONSES_PROVIDER_ID;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly requestSettings?: SanitizedModelProviderConfig["openAI"];
  readonly summaryInput: ModelRuntimeSummaryInput;
};

/** Shared OpenAI connection resolution for both IntelligenceChannel and AgentLoop factories. */
export function resolveOpenAIModelRuntimeConfig(input: {
  readonly mode: OpenAIModelRuntimeMode;
  readonly env: ModelRuntimeEnvironment;
  readonly modelProvider?: Pick<SanitizedModelProviderConfig, "baseUrl" | "model" | "openAI">;
}): ResolvedOpenAIModelRuntimeConfig {
  const apiKey = firstNonBlank(input.env.AGENTARBOR_MODEL_API_KEY, input.env.OPENAI_API_KEY);
  const model = firstNonBlank(input.modelProvider?.model, input.env.AGENTARBOR_MODEL_NAME);
  const baseUrl =
    firstNonBlank(input.modelProvider?.baseUrl, input.env.AGENTARBOR_MODEL_BASE_URL) ??
    OPENAI_COMPATIBLE_DEFAULT_BASE_URL;
  const responses = input.mode === "openai-responses";
  const providerId = responses ? OPENAI_RESPONSES_PROVIDER_ID : OPENAI_COMPATIBLE_PROVIDER_ID;
  const protocol = responses ? OPENAI_RESPONSES_PROTOCOL : OPENAI_COMPATIBLE_PROTOCOL;
  const summaryInput: ModelRuntimeSummaryInput = {
    enabled: true,
    mode: input.mode,
    providerId,
    providerKind: "openai_compatible",
    protocolKind: protocol,
    model,
  };

  if (apiKey === undefined) {
    throw new ModelRuntimeConfigurationError({
      code: "missing_api_key",
      message:
        `--ai ${input.mode} requires AGENTARBOR_MODEL_API_KEY or OPENAI_API_KEY; no network request was attempted.`,
      summaryInput,
    });
  }

  if (model === undefined) {
    throw new ModelRuntimeConfigurationError({
      code: "missing_model_name",
      message: `--ai ${input.mode} requires AGENTARBOR_MODEL_NAME; no network request was attempted.`,
      summaryInput,
    });
  }

  return {
    mode: input.mode,
    protocol,
    providerId,
    baseUrl,
    apiKey,
    model,
    requestSettings: input.modelProvider?.openAI,
    summaryInput,
  };
}

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
  const resolved = resolveOpenAIModelRuntimeConfig({
    mode: "openai-compatible",
    env: input.env,
    modelProvider: input.modelProvider,
  });

  return {
    enabled: true,
    mode: "openai-compatible",
    summaryInput: resolved.summaryInput,
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new OpenAICompatibleChatCompletionsProvider({
          providerId: resolved.providerId,
          baseUrl: resolved.baseUrl,
          apiKey: resolved.apiKey,
          model: resolved.model,
          providerProfileId: providerProfileIdFromConfig(input.modelProvider?.profileId),
          fetch: input.fetch,
          stream: input.onModelOutputDelta !== undefined,
          forceStreaming: input.streamingMode === "force_live" && input.onModelOutputDelta !== undefined,
          requestSettings: resolved.requestSettings,
          onContextWindowExceeded: (event) =>
            input.onContextWindowExceeded?.({
              profileId: input.modelProvider?.profileId,
              providerKind: "openai_compatible",
              protocolKind: OPENAI_COMPATIBLE_PROTOCOL,
              model: resolved.model,
              message: event.message,
            }),
          onOutputDelta: input.onModelOutputDelta,
        }),
        bus: runtime.bus,
      }),
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
  const resolved = resolveOpenAIModelRuntimeConfig({
    mode: "openai-responses",
    env: input.env,
    modelProvider: input.modelProvider,
  });

  return {
    enabled: true,
    mode: "openai-responses",
    summaryInput: resolved.summaryInput,
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new OpenAIResponsesProvider({
          providerId: resolved.providerId,
          baseUrl: resolved.baseUrl,
          apiKey: resolved.apiKey,
          model: resolved.model,
          fetch: input.fetch,
          stream: input.onModelOutputDelta !== undefined,
          forceStreaming: input.streamingMode === "force_live" && input.onModelOutputDelta !== undefined,
          requestSettings: resolved.requestSettings,
          enableWebSearch: enabledFlag(input.env.AGENTARBOR_MODEL_BUILTIN_WEB_SEARCH),
          onContextWindowExceeded: (event) =>
            input.onContextWindowExceeded?.({
              profileId: input.modelProvider?.profileId,
              providerKind: "openai_compatible",
              protocolKind: OPENAI_RESPONSES_PROTOCOL,
              model: resolved.model,
              message: event.message,
            }),
          onOutputDelta: input.onModelOutputDelta,
        }),
        bus: runtime.bus,
      }),
  };
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
