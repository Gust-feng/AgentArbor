import {
  FakeModelProvider,
  OpenAICompatibleChatCompletionsProvider,
  type FetchLike,
} from "../adapters/intelligence/index.js";
import { NativeIntelligenceChannel } from "../kernel/intelligence/channel.js";
import type { IntelligenceChannel } from "../domain/intelligence/index.js";
import type { InformationSourceKind } from "../domain/research/index.js";
import type { ToolExecutionBroker } from "../domain/tools/index.js";
import type { MinimalRuntime } from "./runtime.js";
import {
  createDefaultResearchRuntime,
  createResearchReadTool,
  createResearchSearchTool,
  type PageFetchLike,
} from "./research/index.js";
import { ToolCenter } from "./tool-center/index.js";
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
      createToolCenter: (runtime) => createDefaultToolCenter({ runtime, env: input.env ?? process.env, fetch: input.fetch }),
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
    createToolCenter: (runtime) => createDefaultToolCenter({ runtime, env: input.env, fetch: input.fetch }),
  };
}

export function createDefaultToolCenter(input: {
  readonly runtime?: MinimalRuntime;
  readonly env?: UndergroundAiEnvironment;
  readonly fetch?: FetchLike;
  readonly sourcePreference?: readonly InformationSourceKind[];
  readonly tavilyMaxResults?: number;
} = {}): ToolExecutionBroker {
  const env = input.env ?? process.env;
  const center = new ToolCenter();
  const researchRuntime = createDefaultResearchRuntime({
    env,
    tavilyFetch: input.fetch,
    pageFetch: input.fetch as unknown as PageFetchLike,
    constraints: input.runtime?.constraints,
    sourcePreference: input.sourcePreference ?? parseInformationSourcePreference(env.AGENTARBOR_INFORMATION_SOURCE_PREFERENCE),
    tavilyMaxResults: input.tavilyMaxResults ?? positiveIntegerFromString(env.AGENTARBOR_TAVILY_MAX_RESULTS),
  });
  center.register(createResearchSearchTool(researchRuntime));
  center.register(createResearchReadTool(researchRuntime));
  return center;
}

function parseInformationSourcePreference(value: string | undefined): readonly InformationSourceKind[] | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const sources = [...new Set(value.split(",").map((item) => informationSourceOrUndefined(item.trim())))].filter(
    (source): source is InformationSourceKind => source !== undefined
  );
  return sources.length === 0 ? undefined : sources;
}

function informationSourceOrUndefined(value: string): InformationSourceKind | undefined {
  if (
    value === "web" ||
    value === "page" ||
    value === "codebase" ||
    value === "soil" ||
    value === "run_memory" ||
    value === "docs" ||
    value === "packages" ||
    value === "github"
  ) {
    return value;
  }
  return undefined;
}

function positiveIntegerFromString(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : undefined;
}

function firstNonBlank(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}
