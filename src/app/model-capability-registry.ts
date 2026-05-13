import type {
  ConfiguredModelProviderKind,
  ModelCapabilities,
  ModelCapabilityOverrideSettings,
  SanitizedModelProviderConfig,
} from "../domain/config/index.js";

export type ModelDefinition = {
  readonly providerKind: ConfiguredModelProviderKind;
  readonly modelPattern: string;
  readonly label: string;
  readonly capabilities: ModelCapabilities;
};

const VERIFIED_AT = "2026-05-12";
const DEEPSEEK_VERIFIED_AT = "2026-05-13";

export const CONSERVATIVE_MODEL_CAPABILITIES: ModelCapabilities = {
  contextWindowTokens: 16_000,
  maxOutputTokens: 4_000,
  supportsToolCalling: false,
  supportsParallelToolCalls: false,
  supportsStructuredOutputs: false,
  supportsStreaming: true,
  supportsVisionInput: false,
  supportsReasoningEffort: false,
  preferredApiStyle: "openai_compatible",
  stability: "unknown",
  lastVerifiedAt: VERIFIED_AT,
};

const OPENAI_COMPATIBLE_DEFINITIONS: readonly ModelDefinition[] = [
  {
    providerKind: "openai_compatible",
    modelPattern: "gpt-5.5",
    label: "GPT-5.5 family",
    capabilities: {
      contextWindowTokens: 1_050_000,
      maxOutputTokens: 128_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: true,
      preferredApiStyle: "responses",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    modelPattern: "gpt-5.4-mini",
    label: "GPT-5.4 mini family",
    capabilities: {
      contextWindowTokens: 400_000,
      maxOutputTokens: 128_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: true,
      preferredApiStyle: "responses",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    modelPattern: "gpt-5.4-nano",
    label: "GPT-5.4 nano family",
    capabilities: {
      contextWindowTokens: 400_000,
      maxOutputTokens: 128_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: true,
      preferredApiStyle: "responses",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    modelPattern: "gpt-5.4",
    label: "GPT-5.4 family",
    capabilities: {
      contextWindowTokens: 1_050_000,
      maxOutputTokens: 128_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: true,
      preferredApiStyle: "responses",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    modelPattern: "gpt-5-mini",
    label: "GPT-5 mini family",
    capabilities: {
      contextWindowTokens: 400_000,
      maxOutputTokens: 128_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: true,
      preferredApiStyle: "responses",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    modelPattern: "gpt-5-nano",
    label: "GPT-5 nano family",
    capabilities: {
      contextWindowTokens: 400_000,
      maxOutputTokens: 128_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: true,
      preferredApiStyle: "responses",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    modelPattern: "gpt-5",
    label: "GPT-5 family",
    capabilities: {
      contextWindowTokens: 400_000,
      maxOutputTokens: 128_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: true,
      preferredApiStyle: "responses",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    modelPattern: "gpt-4.1",
    label: "GPT-4.1 family",
    capabilities: {
      contextWindowTokens: 1_047_576,
      maxOutputTokens: 32_768,
      supportsToolCalling: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      preferredApiStyle: "responses",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    modelPattern: "gpt-4o",
    label: "GPT-4o family",
    capabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 16_384,
      supportsToolCalling: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      preferredApiStyle: "chat_completions",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    modelPattern: "o3",
    label: "OpenAI o3 family",
    capabilities: {
      contextWindowTokens: 200_000,
      maxOutputTokens: 100_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: true,
      preferredApiStyle: "responses",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    modelPattern: "o4",
    label: "OpenAI o4 family",
    capabilities: {
      contextWindowTokens: 200_000,
      maxOutputTokens: 100_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: true,
      preferredApiStyle: "responses",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    modelPattern: "claude",
    label: "OpenAI-compatible Claude proxy",
    capabilities: {
      contextWindowTokens: 200_000,
      maxOutputTokens: 8_192,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      preferredApiStyle: "openai_compatible",
      stability: "unknown",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    modelPattern: "deepseek-v4",
    label: "DeepSeek V4 family",
    capabilities: {
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 384_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: true,
      preferredApiStyle: "openai_compatible",
      stability: "stable",
      lastVerifiedAt: DEEPSEEK_VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    modelPattern: "gemini",
    label: "OpenAI-compatible Gemini proxy",
    capabilities: {
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 65_536,
      supportsToolCalling: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      preferredApiStyle: "openai_compatible",
      stability: "unknown",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
];

export const BUILTIN_MODEL_DEFINITIONS: readonly ModelDefinition[] = [
  ...OPENAI_COMPATIBLE_DEFINITIONS,
];

export function resolveModelCapabilities(input: {
  readonly profile: SanitizedModelProviderConfig;
  readonly overrides?: readonly ModelCapabilityOverrideSettings[];
}): ModelCapabilities {
  const base = bestDefinitionFor(input.profile)?.capabilities ?? CONSERVATIVE_MODEL_CAPABILITIES;
  const override = input.overrides?.find((item) =>
    item.model.toLowerCase() === (input.profile.model ?? "").toLowerCase() &&
    (item.providerKind === undefined || item.providerKind === input.profile.providerKind)
  );
  return override === undefined ? { ...base } : mergeCapabilities(base, override.capabilities);
}

export function isKnownModel(profile: SanitizedModelProviderConfig): boolean {
  return bestDefinitionFor(profile) !== undefined;
}

function bestDefinitionFor(profile: SanitizedModelProviderConfig): ModelDefinition | undefined {
  const model = (profile.model ?? "").toLowerCase();
  if (model.length === 0) {
    return undefined;
  }
  return BUILTIN_MODEL_DEFINITIONS.find((definition) =>
    definition.providerKind === profile.providerKind &&
    model.includes(definition.modelPattern.toLowerCase())
  );
}

function mergeCapabilities(
  base: ModelCapabilities,
  override: Partial<ModelCapabilities>
): ModelCapabilities {
  return {
    contextWindowTokens: override.contextWindowTokens ?? base.contextWindowTokens,
    maxOutputTokens: override.maxOutputTokens ?? base.maxOutputTokens,
    supportsToolCalling: override.supportsToolCalling ?? base.supportsToolCalling,
    supportsParallelToolCalls: override.supportsParallelToolCalls ?? base.supportsParallelToolCalls,
    supportsStructuredOutputs: override.supportsStructuredOutputs ?? base.supportsStructuredOutputs,
    supportsStreaming: override.supportsStreaming ?? base.supportsStreaming,
    supportsVisionInput: override.supportsVisionInput ?? base.supportsVisionInput,
    supportsReasoningEffort: override.supportsReasoningEffort ?? base.supportsReasoningEffort,
    preferredApiStyle: override.preferredApiStyle ?? base.preferredApiStyle,
    stability: override.stability ?? base.stability,
    lastVerifiedAt: override.lastVerifiedAt ?? base.lastVerifiedAt,
  };
}
