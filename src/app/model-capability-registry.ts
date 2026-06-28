import type {
  ConfiguredModelProtocolKind,
  ConfiguredModelProviderKind,
  ModelCapabilities,
  ModelCapabilityOverrideSettings,
  ModelReasoningControlKind,
  ProtocolToolCallCapabilities,
  RunCapabilityPlan,
  ProviderProtocolProfileId,
  SanitizedModelProviderConfig,
} from "../domain/config/index.js";

export type ModelDefinition = {
  readonly providerKind: ConfiguredModelProviderKind;
  readonly protocolKind?: ConfiguredModelProtocolKind;
  readonly providerProfileId?: ProviderProtocolProfileId;
  readonly modelPattern: string;
  readonly label: string;
  readonly reasoningControl?: ModelReasoningControlKind;
  readonly capabilities: ModelCapabilities;
};

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 256_000;
export const CONTEXT_WINDOW_FALLBACK_TOKENS = 128_000;

const VERIFIED_AT = "2026-06-28";
const OPENAI_FORMAT_PROVIDER_VERIFIED_AT = "2026-06-28";

export const PROTOCOL_BASELINE_MODEL_CAPABILITIES: ModelCapabilities = {
  contextWindowTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
  maxOutputTokens: 4_000,
  supportsToolCalling: false,
  supportsParallelToolCalls: false,
  supportsStructuredOutputs: false,
  supportsStreaming: true,
  // Generic OpenAI-compatible routes are user-controlled; explicit capability overrides can close image input.
  supportsVisionInput: true,
  supportsReasoningEffort: false,
  supportsReasoningOutput: false,
  preferredApiStyle: "openai_compatible",
  stability: "stable",
  protocolProfileId: "openai_compatible",
  reasoningControl: "none",
  lastVerifiedAt: VERIFIED_AT,
};

const PROTOCOL_TOOL_CALL_CAPABILITIES: Record<ConfiguredModelProtocolKind, ProtocolToolCallCapabilities> = {
  openai_compatible_chat_completions: {
    protocolKind: "openai_compatible_chat_completions",
    canSendToolDefinitions: true,
    canReceiveToolCalls: true,
    canRoundTripToolResults: true,
  },
  openai_responses: {
    protocolKind: "openai_responses",
    canSendToolDefinitions: true,
    canReceiveToolCalls: true,
    canRoundTripToolResults: true,
  },
  anthropic_messages: {
    protocolKind: "anthropic_messages",
    canSendToolDefinitions: false,
    canReceiveToolCalls: false,
    canRoundTripToolResults: false,
  },
  gemini_generate_content: {
    protocolKind: "gemini_generate_content",
    canSendToolDefinitions: false,
    canReceiveToolCalls: false,
    canRoundTripToolResults: false,
  },
  ollama_generate: {
    protocolKind: "ollama_generate",
    canSendToolDefinitions: false,
    canReceiveToolCalls: false,
    canRoundTripToolResults: false,
  },
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
      supportsReasoningOutput: true,
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
      supportsReasoningOutput: true,
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
      supportsReasoningOutput: true,
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
      supportsReasoningOutput: true,
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
      supportsReasoningOutput: true,
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
      supportsReasoningOutput: true,
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
      supportsReasoningOutput: true,
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
      supportsReasoningOutput: true,
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
      supportsReasoningOutput: true,
      preferredApiStyle: "responses",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    providerProfileId: "deepseek",
    protocolKind: "openai_compatible_chat_completions",
    modelPattern: "deepseek-v4",
    label: "DeepSeek V4 family",
    reasoningControl: "deepseek_reasoning_effort",
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
      supportsReasoningOutput: true,
      lastVerifiedAt: OPENAI_FORMAT_PROVIDER_VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    providerProfileId: "deepseek",
    protocolKind: "openai_compatible_chat_completions",
    modelPattern: "deepseek-reasoner",
    label: "DeepSeek Reasoner family",
    reasoningControl: "deepseek_reasoning_effort",
    capabilities: {
      contextWindowTokens: 64_000,
      maxOutputTokens: 64_000,
      supportsToolCalling: false,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "openai_compatible",
      stability: "deprecated",
      supportsReasoningOutput: true,
      lastVerifiedAt: OPENAI_FORMAT_PROVIDER_VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    providerProfileId: "deepseek",
    protocolKind: "openai_compatible_chat_completions",
    modelPattern: "deepseek-chat",
    label: "DeepSeek Chat family",
    reasoningControl: "none",
    capabilities: {
      contextWindowTokens: 64_000,
      maxOutputTokens: 8_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "openai_compatible",
      stability: "deprecated",
      supportsReasoningOutput: false,
      lastVerifiedAt: OPENAI_FORMAT_PROVIDER_VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    providerProfileId: "moonshot",
    protocolKind: "openai_compatible_chat_completions",
    modelPattern: "vision",
    label: "Moonshot vision family",
    reasoningControl: "none",
    capabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 32_768,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      preferredApiStyle: "chat_completions",
      stability: "stable",
      supportsReasoningOutput: false,
      lastVerifiedAt: OPENAI_FORMAT_PROVIDER_VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    providerProfileId: "moonshot",
    protocolKind: "openai_compatible_chat_completions",
    modelPattern: "kimi",
    label: "Kimi / Moonshot family",
    reasoningControl: "thinking_enabled_disabled",
    capabilities: {
      contextWindowTokens: 256_000,
      maxOutputTokens: 32_768,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      preferredApiStyle: "chat_completions",
      stability: "stable",
      supportsReasoningOutput: true,
      lastVerifiedAt: OPENAI_FORMAT_PROVIDER_VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    providerProfileId: "glm",
    protocolKind: "openai_compatible_chat_completions",
    modelPattern: "glm-4.7",
    label: "GLM 4.7 family",
    reasoningControl: "thinking_disabled",
    capabilities: {
      contextWindowTokens: 200_000,
      maxOutputTokens: 128_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "chat_completions",
      stability: "stable",
      supportsReasoningOutput: false,
      lastVerifiedAt: OPENAI_FORMAT_PROVIDER_VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    providerProfileId: "glm",
    protocolKind: "openai_compatible_chat_completions",
    modelPattern: "glm-4.5-air",
    label: "GLM 4.5 Air family",
    reasoningControl: "thinking_disabled",
    capabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 96_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: true,
      supportsStreaming: false,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "chat_completions",
      stability: "stable",
      supportsReasoningOutput: false,
      lastVerifiedAt: OPENAI_FORMAT_PROVIDER_VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    providerProfileId: "glm",
    protocolKind: "openai_compatible_chat_completions",
    modelPattern: "glm-5.2",
    label: "GLM 5.2 family",
    reasoningControl: "thinking_enabled_disabled",
    capabilities: {
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 128_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "chat_completions",
      stability: "stable",
      supportsReasoningOutput: true,
      lastVerifiedAt: OPENAI_FORMAT_PROVIDER_VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    providerProfileId: "glm",
    protocolKind: "openai_compatible_chat_completions",
    modelPattern: "glm-5.1",
    label: "GLM 5.1 family",
    reasoningControl: "thinking_enabled_disabled",
    capabilities: {
      contextWindowTokens: 200_000,
      maxOutputTokens: 128_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "chat_completions",
      stability: "stable",
      supportsReasoningOutput: true,
      lastVerifiedAt: OPENAI_FORMAT_PROVIDER_VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    providerProfileId: "glm",
    protocolKind: "openai_compatible_chat_completions",
    modelPattern: "glm-4.5v",
    label: "GLM 4.5V family",
    reasoningControl: "thinking_disabled",
    capabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 32_768,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: true,
      supportsStreaming: false,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      preferredApiStyle: "chat_completions",
      stability: "stable",
      supportsReasoningOutput: false,
      lastVerifiedAt: OPENAI_FORMAT_PROVIDER_VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    providerProfileId: "glm",
    protocolKind: "openai_compatible_chat_completions",
    modelPattern: "glm",
    label: "GLM / Z.AI family",
    reasoningControl: "thinking_disabled",
    capabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 32_768,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: true,
      supportsStreaming: false,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "chat_completions",
      stability: "stable",
      supportsReasoningOutput: false,
      lastVerifiedAt: OPENAI_FORMAT_PROVIDER_VERIFIED_AT,
    },
  },
  {
    providerKind: "openai_compatible",
    providerProfileId: "minimax",
    protocolKind: "openai_compatible_chat_completions",
    modelPattern: "minimax-m3",
    label: "MiniMax M3 family",
    reasoningControl: "reasoning_split",
    capabilities: {
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 524_288,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      preferredApiStyle: "chat_completions",
      stability: "stable",
      supportsReasoningOutput: true,
      lastVerifiedAt: "2026-06-28",
    },
  },
  {
    providerKind: "openai_compatible",
    providerProfileId: "minimax",
    protocolKind: "openai_compatible_chat_completions",
    modelPattern: "minimax",
    label: "MiniMax M2 family",
    reasoningControl: "reasoning_split",
    capabilities: {
      contextWindowTokens: 204_800,
      maxOutputTokens: 204_800,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "chat_completions",
      stability: "stable",
      supportsReasoningOutput: true,
      lastVerifiedAt: OPENAI_FORMAT_PROVIDER_VERIFIED_AT,
    },
  },
];

const ANTHROPIC_DEFINITIONS: readonly ModelDefinition[] = [
  {
    providerKind: "anthropic",
    providerProfileId: "anthropic",
    protocolKind: "anthropic_messages",
    modelPattern: "claude-fable-5",
    label: "Claude Fable 5 family",
    reasoningControl: "vendor_specific",
    capabilities: {
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 128_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      supportsReasoningOutput: true,
      preferredApiStyle: "messages",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "anthropic",
    providerProfileId: "anthropic",
    protocolKind: "anthropic_messages",
    modelPattern: "claude-mythos-5",
    label: "Claude Mythos 5 family",
    reasoningControl: "vendor_specific",
    capabilities: {
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 128_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      supportsReasoningOutput: true,
      preferredApiStyle: "messages",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "anthropic",
    providerProfileId: "anthropic",
    protocolKind: "anthropic_messages",
    modelPattern: "claude-opus-4.8",
    label: "Claude Opus 4.8 family",
    reasoningControl: "vendor_specific",
    capabilities: {
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 128_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      supportsReasoningOutput: true,
      preferredApiStyle: "messages",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "anthropic",
    providerProfileId: "anthropic",
    protocolKind: "anthropic_messages",
    modelPattern: "claude-haiku-4.5",
    label: "Claude Haiku 4.5 family",
    reasoningControl: "vendor_specific",
    capabilities: {
      contextWindowTokens: 200_000,
      maxOutputTokens: 64_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      supportsReasoningOutput: true,
      preferredApiStyle: "messages",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "anthropic",
    providerProfileId: "anthropic",
    protocolKind: "anthropic_messages",
    modelPattern: "claude-sonnet-4.6",
    label: "Claude Sonnet 4.6 family",
    reasoningControl: "vendor_specific",
    capabilities: {
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 128_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      supportsReasoningOutput: true,
      preferredApiStyle: "messages",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "anthropic",
    providerProfileId: "anthropic",
    protocolKind: "anthropic_messages",
    modelPattern: "claude-opus-4",
    label: "Claude Opus 4 family",
    reasoningControl: "vendor_specific",
    capabilities: {
      contextWindowTokens: 200_000,
      maxOutputTokens: 32_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      supportsReasoningOutput: true,
      preferredApiStyle: "messages",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "anthropic",
    providerProfileId: "anthropic",
    protocolKind: "anthropic_messages",
    modelPattern: "claude-sonnet-4",
    label: "Claude Sonnet 4 family",
    reasoningControl: "vendor_specific",
    capabilities: {
      contextWindowTokens: 200_000,
      maxOutputTokens: 32_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      supportsReasoningOutput: true,
      preferredApiStyle: "messages",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "anthropic",
    providerProfileId: "anthropic",
    protocolKind: "anthropic_messages",
    modelPattern: "claude-3",
    label: "Claude 3 family",
    reasoningControl: "vendor_specific",
    capabilities: {
      contextWindowTokens: 200_000,
      maxOutputTokens: 8_192,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      supportsReasoningOutput: false,
      preferredApiStyle: "messages",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
];

const GEMINI_DEFINITIONS: readonly ModelDefinition[] = [
  {
    providerKind: "gemini",
    providerProfileId: "gemini",
    protocolKind: "gemini_generate_content",
    modelPattern: "gemini-3.5",
    label: "Gemini 3.5 family",
    reasoningControl: "vendor_specific",
    capabilities: {
      contextWindowTokens: 1_048_576,
      maxOutputTokens: 65_536,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      supportsReasoningOutput: true,
      preferredApiStyle: "gemini_generate_content",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "gemini",
    providerProfileId: "gemini",
    protocolKind: "gemini_generate_content",
    modelPattern: "gemini-3.1",
    label: "Gemini 3.1 family",
    reasoningControl: "vendor_specific",
    capabilities: {
      contextWindowTokens: 1_048_576,
      maxOutputTokens: 65_536,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      supportsReasoningOutput: true,
      preferredApiStyle: "gemini_generate_content",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "gemini",
    providerProfileId: "gemini",
    protocolKind: "gemini_generate_content",
    modelPattern: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro family",
    reasoningControl: "vendor_specific",
    capabilities: {
      contextWindowTokens: 1_048_576,
      maxOutputTokens: 65_536,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      supportsReasoningOutput: true,
      preferredApiStyle: "gemini_generate_content",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "gemini",
    providerProfileId: "gemini",
    protocolKind: "gemini_generate_content",
    modelPattern: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash family",
    reasoningControl: "vendor_specific",
    capabilities: {
      contextWindowTokens: 1_048_576,
      maxOutputTokens: 65_536,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      supportsReasoningOutput: true,
      preferredApiStyle: "gemini_generate_content",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
  {
    providerKind: "gemini",
    providerProfileId: "gemini",
    protocolKind: "gemini_generate_content",
    modelPattern: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash family",
    reasoningControl: "vendor_specific",
    capabilities: {
      contextWindowTokens: 1_048_576,
      maxOutputTokens: 8_192,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: true,
      supportsReasoningEffort: false,
      supportsReasoningOutput: false,
      preferredApiStyle: "gemini_generate_content",
      stability: "stable",
      lastVerifiedAt: VERIFIED_AT,
    },
  },
];

export const BUILTIN_MODEL_DEFINITIONS: readonly ModelDefinition[] = [
  ...OPENAI_COMPATIBLE_DEFINITIONS,
  ...ANTHROPIC_DEFINITIONS,
  ...GEMINI_DEFINITIONS,
];

export function resolveModelCapabilities(input: {
  readonly profile: SanitizedModelProviderConfig;
  readonly overrides?: readonly ModelCapabilityOverrideSettings[];
}): ModelCapabilities {
  const definition = bestDefinitionFor(input.profile);
  const protocolCapabilities = resolveProtocolToolCallCapabilities(input.profile.protocolKind);
  const base = constrainCapabilitiesToProtocolToolCalling(
    definition === undefined
      ? fallbackCapabilitiesForProfile(input.profile)
      : capabilitiesForDefinition(definition),
    protocolCapabilities
  );
  const override = bestOverrideFor(input.profile, input.overrides);
  const resolved = override === undefined ? { ...base } : mergeCapabilities(base, override.capabilities);
  return constrainCapabilitiesToProtocolToolCalling(resolved, protocolCapabilities);
}

export function resolveProtocolToolCallCapabilities(
  protocolKind: ConfiguredModelProtocolKind
): ProtocolToolCallCapabilities {
  return PROTOCOL_TOOL_CALL_CAPABILITIES[protocolKind];
}

export function supportsProtocolToolCalling(capabilities: ProtocolToolCallCapabilities): boolean {
  return capabilities.canSendToolDefinitions &&
    capabilities.canReceiveToolCalls &&
    capabilities.canRoundTripToolResults;
}

export function createRunCapabilityPlan(input: {
  readonly profile: SanitizedModelProviderConfig;
  readonly modelCapabilities: ModelCapabilities;
  readonly allowedTools?: readonly string[];
  readonly fileOperationTools?: readonly string[];
  readonly uiVisibleToolNames?: readonly string[];
  readonly warnings?: readonly string[];
}): RunCapabilityPlan {
  const protocolToolCallCapabilities = resolveProtocolToolCallCapabilities(input.profile.protocolKind);
  const canExposeModelTools = input.modelCapabilities.supportsToolCalling &&
    supportsProtocolToolCalling(protocolToolCallCapabilities);
  const allowedTools = input.allowedTools ?? [];
  const fileOperationTools = input.fileOperationTools ?? [];
  const uiVisibleToolNames = input.uiVisibleToolNames ?? allowedTools;
  return {
    protocolToolCallCapabilities,
    modelCapabilities: input.modelCapabilities,
    canExposeModelTools,
    tools: {
      canExposeToModel: canExposeModelTools,
      allowedTools,
    },
    fileOperations: {
      canReadWorkspace: fileOperationTools.includes("read-only") ||
        fileOperationTools.includes("read-write") ||
        fileOperationTools.includes("execute"),
      canWriteWorkspace: fileOperationTools.includes("read-write"),
      canDeleteWorkspace: fileOperationTools.includes("delete"),
      canExecuteCommands: fileOperationTools.includes("execute"),
    },
    uiDisplay: {
      canShowStreamingOutput: input.modelCapabilities.supportsStreaming,
      canShowToolCards: uiVisibleToolNames.length > 0,
      visibleToolNames: uiVisibleToolNames,
    },
    allowedTools,
    warnings: input.warnings ?? [],
  };
}

export function hasModelCapabilityOverride(input: {
  readonly profile: SanitizedModelProviderConfig;
  readonly overrides?: readonly ModelCapabilityOverrideSettings[];
}): boolean {
  return bestOverrideFor(input.profile, input.overrides) !== undefined;
}

function bestDefinitionFor(profile: SanitizedModelProviderConfig): ModelDefinition | undefined {
  const model = (profile.model ?? "").toLowerCase();
  if (model.length === 0) {
    return undefined;
  }
  const providerProfileId = providerProtocolProfileIdFor(profile);
  return BUILTIN_MODEL_DEFINITIONS.find((definition) =>
    definition.providerKind === profile.providerKind &&
    (definition.protocolKind === undefined || definition.protocolKind === profile.protocolKind) &&
    (definition.providerProfileId ?? "openai") === providerProfileId &&
    model.includes(definition.modelPattern.toLowerCase())
  );
}

function capabilitiesForDefinition(definition: ModelDefinition): ModelCapabilities {
  const protocolProfileId = definition.providerProfileId ?? "openai";
  return {
    ...definition.capabilities,
    protocolProfileId,
    reasoningControl: definition.reasoningControl ?? definition.capabilities.reasoningControl ?? "none",
  };
}

function fallbackCapabilitiesForProfile(profile: SanitizedModelProviderConfig): ModelCapabilities {
  const protocolCapabilities = resolveProtocolToolCallCapabilities(profile.protocolKind);
  return {
    ...PROTOCOL_BASELINE_MODEL_CAPABILITIES,
    protocolProfileId: providerProtocolProfileIdFor(profile),
    preferredApiStyle: preferredApiStyleForProtocol(profile.protocolKind),
    supportsToolCalling: supportsProtocolToolCalling(protocolCapabilities),
  };
}

function constrainCapabilitiesToProtocolToolCalling(
  capabilities: ModelCapabilities,
  protocolCapabilities: ProtocolToolCallCapabilities
): ModelCapabilities {
  if (supportsProtocolToolCalling(protocolCapabilities)) {
    return capabilities;
  }
  return {
    ...capabilities,
    supportsToolCalling: false,
    supportsParallelToolCalls: false,
  };
}

function preferredApiStyleForProtocol(protocolKind: ConfiguredModelProtocolKind): ModelCapabilities["preferredApiStyle"] {
  switch (protocolKind) {
    case "openai_compatible_chat_completions":
      return "chat_completions";
    case "openai_responses":
      return "responses";
    case "anthropic_messages":
      return "messages";
    case "gemini_generate_content":
      return "gemini_generate_content";
    case "ollama_generate":
      return "openai_compatible";
  }
}

function bestOverrideFor(
  profile: SanitizedModelProviderConfig,
  overrides: readonly ModelCapabilityOverrideSettings[] | undefined
): ModelCapabilityOverrideSettings | undefined {
  if (overrides === undefined || profile.model === undefined) {
    return undefined;
  }
  const model = profile.model.toLowerCase();
  const matchingModel = overrides.filter((item) => item.model.toLowerCase() === model);
  const profileSpecific = matchingModel.find((item) =>
    item.profileId === profile.profileId &&
    (item.providerKind === undefined || item.providerKind === profile.providerKind)
  );
  const providerScoped = matchingModel.find((item) =>
    item.profileId === undefined &&
    (item.providerKind === undefined || item.providerKind === profile.providerKind)
  );
  if (profileSpecific === undefined || providerScoped === undefined) {
    return profileSpecific ?? providerScoped;
  }
  return {
    ...providerScoped,
    ...profileSpecific,
    capabilities: mergePartialCapabilities(providerScoped.capabilities, profileSpecific.capabilities),
  };
}

function providerProtocolProfileIdFor(profile: SanitizedModelProviderConfig): ProviderProtocolProfileId {
  if (profile.providerKind === "anthropic") return "anthropic";
  if (profile.providerKind === "gemini") return "gemini";
  const profileId = (profile.profileId ?? "").toLowerCase();
  const label = (profile.label ?? "").toLowerCase();
  const baseUrl = (profile.baseUrl ?? "").replace(/\/+$/, "").toLowerCase();
  if (baseUrl === "https://api.openai.com" || baseUrl === "https://api.openai.com/v1") return "openai";
  const signals = `${profileId} ${label} ${baseUrl}`;
  if (signals.includes("deepseek")) return "deepseek";
  if (signals.includes("moonshot") || signals.includes("kimi")) return "moonshot";
  if (signals.includes("bigmodel") || signals.includes("z.ai") || signals.includes("zhipu") || signals.includes("glm")) return "glm";
  if (signals.includes("minimax") || signals.includes("minimaxi")) return "minimax";
  if (baseUrl.length === 0 && (profileId === "default" || profileId === "openai")) return "openai";
  return "openai_compatible";
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
    supportsReasoningOutput: override.supportsReasoningOutput ?? base.supportsReasoningOutput,
    preferredApiStyle: override.preferredApiStyle ?? base.preferredApiStyle,
    stability: override.stability ?? base.stability,
    protocolProfileId: override.protocolProfileId ?? base.protocolProfileId,
    reasoningControl: override.reasoningControl ?? base.reasoningControl,
    lastVerifiedAt: override.lastVerifiedAt ?? base.lastVerifiedAt,
  };
}

function mergePartialCapabilities(
  ...capabilities: readonly Partial<ModelCapabilities>[]
): Partial<ModelCapabilities> {
  return Object.assign(
    {},
    ...capabilities.map((item) =>
      Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined))
    )
  ) as Partial<ModelCapabilities>;
}
