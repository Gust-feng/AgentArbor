import {
  createOpenAIAgentsLoop,
  type OpenAIAgentsLoopConfig,
} from "../../adapters/intelligence/openai-agents-loop.js";
import type { SanitizedModelProviderConfig } from "../../domain/config/index.js";
import type { AgentLoop } from "./agent-loop.js";
import type { ModelRuntimeMode } from "./contracts.js";
import {
  ModelRuntimeConfigurationError,
  resolveOpenAIModelRuntimeConfig,
  type ModelRuntimeEnvironment,
  type ModelRuntimeProviderFetch,
  type ModelRuntimeSummaryInput,
  type OpenAIModelRuntimeMode,
} from "./factory.js";

type AgentLoopModelProvider = Pick<
  SanitizedModelProviderConfig,
  "providerKind" | "protocolKind" | "profileId" | "baseUrl" | "model" | "openAI"
>;

export type CreateModelRuntimeAgentLoopInput = {
  readonly mode?: ModelRuntimeMode;
  readonly env?: ModelRuntimeEnvironment;
  readonly modelProvider?: AgentLoopModelProvider;
  readonly providerFetch?: ModelRuntimeProviderFetch;
  /** Fake execution is test-only and must be supplied explicitly. */
  readonly fakeAgentLoop?: AgentLoop;
};

export type ModelRuntimeAgentLoopFactoryDependencies = {
  readonly createOpenAILoop?: (config: OpenAIAgentsLoopConfig) => AgentLoop;
};

/**
 * Creates the provider-neutral model/tool loop from frozen model configuration.
 * Feature state, persistence, tools, and business completion remain outside this factory.
 */
export function createModelRuntimeAgentLoop(
  input: CreateModelRuntimeAgentLoopInput,
  dependencies: ModelRuntimeAgentLoopFactoryDependencies = {},
): AgentLoop {
  const mode = resolveRequestedMode(input.mode, input.modelProvider);

  if (mode === "none") {
    throw new ModelRuntimeConfigurationError({
      code: "ai_disabled",
      message: "AgentLoop cannot be created while the model runtime mode is none.",
      summaryInput: { enabled: false, mode },
    });
  }
  if (mode === "fake") {
    if (input.fakeAgentLoop !== undefined) {
      return input.fakeAgentLoop;
    }
    throw unsupportedConfigurationError(
      mode,
      input.modelProvider,
      "Fake AgentLoop execution must be injected explicitly for tests.",
    );
  }

  assertSupportedProfile(mode, input.modelProvider);
  const resolved = resolveOpenAIModelRuntimeConfig({
    mode,
    env: input.env ?? process.env,
    modelProvider: input.modelProvider,
  });
  return (dependencies.createOpenAILoop ?? createOpenAIAgentsLoop)({
    protocol: resolved.protocol,
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    model: resolved.model,
    requestSettings: resolved.requestSettings,
    fetch: input.providerFetch,
  });
}

function resolveRequestedMode(
  requested: ModelRuntimeMode | undefined,
  provider: AgentLoopModelProvider | undefined,
): ModelRuntimeMode {
  if (requested !== undefined) {
    return requested;
  }
  if (provider === undefined) {
    return "none";
  }
  const inferred = openAIModeForProfile(provider);
  if (inferred === undefined) {
    throw unsupportedConfigurationError(
      "none",
      provider,
      `AgentLoop does not support provider protocol ${provider.providerKind}/${provider.protocolKind}.`,
    );
  }
  return inferred;
}

function assertSupportedProfile(
  mode: OpenAIModelRuntimeMode,
  provider: AgentLoopModelProvider | undefined,
): void {
  if (provider === undefined) {
    return;
  }
  const profileMode = openAIModeForProfile(provider);
  if (profileMode === undefined) {
    throw unsupportedConfigurationError(
      mode,
      provider,
      `AgentLoop does not support provider protocol ${provider.providerKind}/${provider.protocolKind}.`,
    );
  }
  if (profileMode !== mode) {
    throw unsupportedConfigurationError(
      mode,
      provider,
      `AgentLoop mode ${mode} does not match provider protocol ${provider.protocolKind}.`,
    );
  }
}

function openAIModeForProfile(provider: Pick<AgentLoopModelProvider, "providerKind" | "protocolKind">): OpenAIModelRuntimeMode | undefined {
  if (provider.providerKind !== "openai_compatible") {
    return undefined;
  }
  if (provider.protocolKind === "openai_responses") {
    return "openai-responses";
  }
  if (provider.protocolKind === "openai_compatible_chat_completions") {
    return "openai-compatible";
  }
  return undefined;
}

function unsupportedConfigurationError(
  mode: ModelRuntimeMode,
  provider: AgentLoopModelProvider | undefined,
  message: string,
): ModelRuntimeConfigurationError {
  const summaryInput: ModelRuntimeSummaryInput = {
    enabled: mode !== "none" || provider !== undefined,
    mode,
    providerId: provider?.profileId,
    providerKind: provider?.providerKind,
    protocolKind: provider?.protocolKind,
    model: provider?.model,
  };
  return new ModelRuntimeConfigurationError({
    code: "unsupported_provider_protocol",
    message,
    summaryInput,
  });
}
