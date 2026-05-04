import {
  FakeModelProvider,
  OpenAICompatibleChatCompletionsProvider,
  type FetchLike,
} from "../adapters/intelligence/index.js";
import { NativeIntelligenceChannel } from "../kernel/intelligence/channel.js";
import type { IntelligenceChannel } from "../domain/intelligence/index.js";
import type { ToolExecutionBroker } from "../domain/tools/index.js";
import type { MinimalRuntime } from "./runtime.js";
import { ToolCenter, createWebSearchTool } from "./tool-center/index.js";
import type { UndergroundDemoAiInput } from "./underground-demo-summary.js";

export type UndergroundAiMode = "none" | "fake" | "openai-compatible";

export type UndergroundAiEnvironment = Readonly<Record<string, string | undefined>>;

export type UndergroundAiRuntimeConfig =
  | {
      readonly enabled: false;
      readonly mode: "none";
      readonly summaryInput: UndergroundDemoAiInput;
    }
  | {
      readonly enabled: true;
      readonly mode: Exclude<UndergroundAiMode, "none">;
      readonly summaryInput: UndergroundDemoAiInput;
      createIntelligenceChannel(runtime: MinimalRuntime): IntelligenceChannel;
      createToolCenter(runtime: MinimalRuntime): ToolExecutionBroker;
    };

export type UndergroundAiConfigurationIssueCode = "missing_api_key" | "missing_model_name";

export class UndergroundAiConfigurationError extends Error {
  constructor(
    readonly issue: {
      readonly code: UndergroundAiConfigurationIssueCode;
      readonly message: string;
      readonly summaryInput: UndergroundDemoAiInput;
    }
  ) {
    super(issue.message);
    this.name = "UndergroundAiConfigurationError";
  }
}

const OPENAI_COMPATIBLE_PROVIDER_ID = "openai-compatible-chat-completions";
const OPENAI_COMPATIBLE_PROTOCOL = "openai_compatible_chat_completions";
const OPENAI_COMPATIBLE_DEFAULT_BASE_URL = "https://api.openai.com";

export function createUndergroundAiRuntimeConfig(input: {
  readonly mode?: UndergroundAiMode;
  readonly env?: UndergroundAiEnvironment;
  readonly fetch?: FetchLike;
}): UndergroundAiRuntimeConfig {
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
          provider: new FakeModelProvider(),
          bus: runtime.bus,
        }),
      createToolCenter: () => createDefaultToolCenter({ env: input.env ?? process.env, fetch: input.fetch }),
    };
  }

  return createOpenAICompatibleConfig({
    env: input.env ?? process.env,
    fetch: input.fetch,
  });
}

function createOpenAICompatibleConfig(input: {
  readonly env: UndergroundAiEnvironment;
  readonly fetch?: FetchLike;
}): UndergroundAiRuntimeConfig {
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
    throw new UndergroundAiConfigurationError({
      code: "missing_api_key",
      message:
        "--ai openai-compatible requires AGENTARBOR_MODEL_API_KEY or OPENAI_API_KEY; no network request was attempted.",
      summaryInput,
    });
  }

  if (model === undefined) {
    throw new UndergroundAiConfigurationError({
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
        }),
        bus: runtime.bus,
      }),
    createToolCenter: () => createDefaultToolCenter({ env: input.env, fetch: input.fetch }),
  };
}

export function createDefaultToolCenter(input: {
  readonly env?: UndergroundAiEnvironment;
  readonly fetch?: FetchLike;
} = {}): ToolExecutionBroker {
  const env = input.env ?? process.env;
  const center = new ToolCenter();
  center.register(
    createWebSearchTool({
      apiKey: firstNonBlank(env.AGENTARBOR_TAVILY_API_KEY, env.TAVILY_API_KEY),
      fetch: input.fetch,
    })
  );
  return center;
}

function firstNonBlank(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}
