import {
  FakeModelProvider,
  OpenAICompatibleChatCompletionsProvider,
  OpenAIResponsesProvider,
  type FetchLike,
} from "../adapters/intelligence/index.js";
import { NativeIntelligenceChannel } from "../kernel/intelligence/channel.js";
import type { IntelligenceChannel, ModelOutputDelta } from "../domain/intelligence/index.js";
import type { InformationSourceKind } from "../domain/research/index.js";
import type { ToolStateSettings } from "../domain/config/index.js";
import type { ToolExecutionBroker } from "../domain/tools/index.js";
import type { ConfigCenter } from "./config-center.js";
import type { MinimalRuntime } from "./runtime.js";
import { createDesktopBasicToolRegistry } from "./basic-agent-runtime/builtin-tool-runtime.js";
import type { UndergroundDemoAiInput } from "./underground-demo-summary.js";

export type ModelRuntimeMode = "none" | "fake" | "openai-compatible" | "openai-responses";

export type ModelRuntimeEnvironment = Readonly<Record<string, string | undefined>>;
export type ModelRuntimeProviderFetch = FetchLike;

export type ModelRuntimeConfig =
  | {
      readonly enabled: false;
      readonly mode: "none";
      readonly summaryInput: UndergroundDemoAiInput;
    }
  | {
      readonly enabled: true;
      readonly mode: Exclude<ModelRuntimeMode, "none">;
      readonly summaryInput: UndergroundDemoAiInput;
      createIntelligenceChannel(runtime: MinimalRuntime): IntelligenceChannel;
      createToolCenter(runtime: MinimalRuntime): ToolExecutionBroker;
    };

export type ModelRuntimeConfigurationIssueCode = "ai_disabled" | "missing_api_key" | "missing_model_name";

export type UndergroundAiMode = ModelRuntimeMode;
export type UndergroundAiEnvironment = ModelRuntimeEnvironment;
export type UndergroundAiProviderFetch = ModelRuntimeProviderFetch;
export type UndergroundAiRuntimeConfig = ModelRuntimeConfig;
export type UndergroundAiConfigurationIssueCode = ModelRuntimeConfigurationIssueCode;

export class ModelRuntimeConfigurationError extends Error {
  constructor(
    readonly issue: {
      readonly code: ModelRuntimeConfigurationIssueCode;
      readonly message: string;
      readonly summaryInput: UndergroundDemoAiInput;
    }
  ) {
    super(issue.message);
    this.name = "ModelRuntimeConfigurationError";
  }
}

export { ModelRuntimeConfigurationError as UndergroundAiConfigurationError };

export function createModelRuntimeDisabledConfigurationError(
  summaryInput: UndergroundDemoAiInput = { enabled: false, mode: "none" }
): ModelRuntimeConfigurationError {
  return new ModelRuntimeConfigurationError({
    code: "ai_disabled",
    message: "Agent model runtime requires an AgentTurnRuntime-backed AI mode.",
    summaryInput,
  });
}

export const createUndergroundAiDisabledConfigurationError = createModelRuntimeDisabledConfigurationError;

const OPENAI_COMPATIBLE_PROVIDER_ID = "openai-compatible-chat-completions";
const OPENAI_COMPATIBLE_PROTOCOL = "openai_compatible_chat_completions";
const OPENAI_COMPATIBLE_DEFAULT_BASE_URL = "https://api.openai.com";

const OPENAI_RESPONSES_PROVIDER_ID = "openai-responses";
const OPENAI_RESPONSES_PROTOCOL = "openai_responses";

export function createModelRuntimeConfig(input: {
  readonly mode?: ModelRuntimeMode;
  readonly env?: ModelRuntimeEnvironment;
  readonly fetch?: FetchLike;
  readonly onModelOutputDelta?: (delta: ModelOutputDelta) => void;
}): ModelRuntimeConfig {
  const mode = input.mode ?? "none";

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
      fetch: input.fetch,
      onModelOutputDelta: input.onModelOutputDelta,
    });
  }

  return createOpenAICompatibleConfig({
    env: input.env ?? process.env,
    fetch: input.fetch,
    onModelOutputDelta: input.onModelOutputDelta,
  });
}

export const createUndergroundAiRuntimeConfig = createModelRuntimeConfig;

function createOpenAICompatibleConfig(input: {
  readonly env: ModelRuntimeEnvironment;
  readonly fetch?: FetchLike;
  readonly onModelOutputDelta?: (delta: ModelOutputDelta) => void;
}): ModelRuntimeConfig {
  const apiKey = firstNonBlank(input.env.AGENTARBOR_MODEL_API_KEY, input.env.OPENAI_API_KEY);
  const model = firstNonBlank(input.env.AGENTARBOR_MODEL_NAME);
  const baseUrl = firstNonBlank(input.env.AGENTARBOR_MODEL_BASE_URL) ?? OPENAI_COMPATIBLE_DEFAULT_BASE_URL;
  const summaryInput: UndergroundDemoAiInput = {
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
          fetch: input.fetch,
          stream: input.onModelOutputDelta !== undefined,
          onOutputDelta: input.onModelOutputDelta,
        }),
        bus: runtime.bus,
      }),
    createToolCenter: (runtime) => createDefaultToolCenter({ runtime, env: input.env, fetch: input.fetch }),
  };
}

function createOpenAIResponsesConfig(input: {
  readonly env: ModelRuntimeEnvironment;
  readonly fetch?: FetchLike;
  readonly onModelOutputDelta?: (delta: ModelOutputDelta) => void;
}): ModelRuntimeConfig {
  const apiKey = firstNonBlank(input.env.AGENTARBOR_MODEL_API_KEY, input.env.OPENAI_API_KEY);
  const model = firstNonBlank(input.env.AGENTARBOR_MODEL_NAME);
  const baseUrl = firstNonBlank(input.env.AGENTARBOR_MODEL_BASE_URL) ?? OPENAI_COMPATIBLE_DEFAULT_BASE_URL;
  const summaryInput: UndergroundDemoAiInput = {
    enabled: true,
    mode: "openai-responses",
    providerId: OPENAI_RESPONSES_PROVIDER_ID,
    providerKind: "openai",
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
  readonly fetch?: FetchLike;
  readonly sourcePreference?: readonly InformationSourceKind[];
  readonly tavilyMaxResults?: number;
  readonly workspaceRoot?: string;
  readonly playwrightAvailable?: boolean;
} = {}): ToolExecutionBroker {
  return createToolCenterFromEnvironment(input);
}

export async function createConfiguredToolCenter(
  configCenter: ConfigCenter,
  input: {
    readonly runtime?: MinimalRuntime;
    readonly env?: ModelRuntimeEnvironment;
    readonly fetch?: FetchLike;
    readonly sourcePreference?: readonly InformationSourceKind[];
    readonly tavilyMaxResults?: number;
    readonly workspaceRoot?: string;
    readonly playwrightAvailable?: boolean;
    readonly toolStates?: readonly ToolStateSettings[];
  } = {}
): Promise<ToolExecutionBroker> {
  return createToolCenterFromEnvironment({
    ...input,
    env: input.env ?? await configCenter.createUndergroundAiEnvironment(),
  });
}

export async function createConfiguredToolCenterFactory(
  configCenter: ConfigCenter,
  input: {
    readonly env?: ModelRuntimeEnvironment;
    readonly fetch?: FetchLike;
    readonly sourcePreference?: readonly InformationSourceKind[];
    readonly tavilyMaxResults?: number;
    readonly workspaceRoot?: string;
    readonly playwrightAvailable?: boolean;
    readonly toolStates?: readonly ToolStateSettings[];
  } = {}
): Promise<(runtime: MinimalRuntime) => ToolExecutionBroker> {
  const env = input.env ?? await configCenter.createUndergroundAiEnvironment();
  return (runtime) => createToolCenterFromEnvironment({ ...input, runtime, env });
}

function createToolCenterFromEnvironment(input: {
  readonly runtime?: MinimalRuntime;
  readonly env?: ModelRuntimeEnvironment;
  readonly fetch?: FetchLike;
  readonly sourcePreference?: readonly InformationSourceKind[];
  readonly tavilyMaxResults?: number;
  readonly workspaceRoot?: string;
  readonly playwrightAvailable?: boolean;
  readonly toolStates?: readonly ToolStateSettings[];
}): ToolExecutionBroker {
  return createDesktopBasicToolRegistry(input).createToolCenter("desktop-basic");
}

function firstNonBlank(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}
