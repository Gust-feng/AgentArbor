import assert from "node:assert/strict";
import test from "node:test";
import type { SanitizedModelProviderConfig } from "../../domain/config/index.js";
import {
  BUILTIN_MODEL_DEFINITIONS,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  PROTOCOL_BASELINE_MODEL_CAPABILITIES,
  hasModelCapabilityOverride,
  resolveModelCapabilities,
  resolveProtocolToolCallCapabilities,
} from "./model-capability-registry.js";

function profile(
  model: string,
  overrides: Partial<SanitizedModelProviderConfig> = {}
): SanitizedModelProviderConfig {
  return {
    profileId: "default",
    label: "Default",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://api.openai.com",
    model,
    defaultAiMode: "openai-compatible",
    secretRef: "secret://local-dev/model-provider/default/api-key",
    enabled: true,
    secretConfigured: false,
    updatedAt: "2026-05-12T00:00:00.000Z",
    ...overrides,
  };
}

test("protocol capability registry describes tool-call round trips by adapter", () => {
  assert.deepEqual(resolveProtocolToolCallCapabilities("openai_compatible_chat_completions"), {
    protocolKind: "openai_compatible_chat_completions",
    canSendToolDefinitions: true,
    canReceiveToolCalls: true,
    canRoundTripToolResults: true,
  });
  assert.deepEqual(resolveProtocolToolCallCapabilities("openai_responses"), {
    protocolKind: "openai_responses",
    canSendToolDefinitions: true,
    canReceiveToolCalls: true,
    canRoundTripToolResults: true,
  });
});

test("unknown OpenAI-compatible models inherit protocol tools but do not assume vision", () => {
  const chat = resolveModelCapabilities({
    profile: profile("custom-frontier-chat-model", {
      profileId: "custom-chat",
      label: "Custom Chat",
      baseUrl: "https://custom.example/v1",
    }),
  });
  const responses = resolveModelCapabilities({
    profile: profile("custom-frontier-responses-model", {
      profileId: "custom-responses",
      label: "Custom Responses",
      protocolKind: "openai_responses",
      defaultAiMode: "openai-responses",
      baseUrl: "https://responses.example/v1",
    }),
  });

  assert.equal(chat.supportsToolCalling, true);
  assert.equal(chat.supportsParallelToolCalls, false);
  assert.equal(chat.supportsVisionInput, false);
  assert.deepEqual(chat.imageInput?.status, "unknown");
  assert.deepEqual(chat.imageInput?.source, "protocol_default");
  assert.equal(chat.preferredApiStyle, "chat_completions");
  assert.equal(responses.supportsToolCalling, true);
  assert.equal(responses.supportsParallelToolCalls, false);
  assert.equal(responses.supportsVisionInput, false);
  assert.equal(responses.preferredApiStyle, "responses");
});

test("model capability override can still close protocol tool support", () => {
  const resolved = resolveModelCapabilities({
    profile: profile("custom-no-tools-model", {
      profileId: "custom-no-tools",
      label: "Custom No Tools",
      baseUrl: "https://custom.example/v1",
    }),
    overrides: [
      {
        profileId: "custom-no-tools",
        providerKind: "openai_compatible",
        model: "custom-no-tools-model",
        capabilities: {
          supportsToolCalling: false,
          supportsParallelToolCalls: false,
        },
        updatedAt: "2026-06-20T00:00:00.000Z",
      },
    ],
  });

  assert.equal(resolved.supportsToolCalling, false);
  assert.equal(resolved.supportsParallelToolCalls, false);
});

test("all built-in model definitions declare positive context windows", () => {
  const invalidDefinitions = BUILTIN_MODEL_DEFINITIONS
    .filter((definition) => definition.capabilities.contextWindowTokens <= 0)
    .map((definition) => definition.label);

  assert.deepEqual(invalidDefinitions, []);
  assert.equal(PROTOCOL_BASELINE_MODEL_CAPABILITIES.contextWindowTokens, DEFAULT_CONTEXT_WINDOW_TOKENS);
});

test("model capability registry resolves current OpenAI-compatible model families", () => {
  const capabilities = resolveModelCapabilities({ profile: profile("gpt-5.5") });

  assert.equal(capabilities.contextWindowTokens, 1_050_000);
  assert.equal(capabilities.maxOutputTokens, 128_000);
  assert.equal(capabilities.supportsToolCalling, true);
  assert.equal(capabilities.supportsStructuredOutputs, true);
  assert.equal(capabilities.supportsReasoningEffort, true);
  assert.equal(capabilities.supportsReasoningOutput, true);
  assert.equal(capabilities.preferredApiStyle, "responses");
});

test("model capability registry resolves the GPT-5.6 model line from exact IDs", () => {
  for (const model of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
    const capabilities = resolveModelCapabilities({ profile: profile(model) });
    assert.equal(capabilities.contextWindowTokens, 1_050_000);
    assert.equal(capabilities.maxOutputTokens, 128_000);
    assert.equal(capabilities.preferredApiStyle, "responses");
  }
});

test("model capability registry matches specific compact families before broad GPT-5", () => {
  const capabilities = resolveModelCapabilities({ profile: profile("gpt-5.4-mini") });

  assert.equal(capabilities.contextWindowTokens, 400_000);
  assert.equal(capabilities.maxOutputTokens, 128_000);
  assert.equal(capabilities.supportsToolCalling, true);
  assert.equal(capabilities.supportsReasoningEffort, true);
});

test("model capability registry enables tools for current DeepSeek V4 OpenAI-compatible models", () => {
  const deepseekProfile = profile("deepseek-v4-pro", {
    profileId: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
  });
  const capabilities = resolveModelCapabilities({ profile: deepseekProfile });

  assert.equal(capabilities.contextWindowTokens, 1_000_000);
  assert.equal(capabilities.maxOutputTokens, 384_000);
  assert.equal(capabilities.supportsToolCalling, true);
  assert.equal(capabilities.supportsParallelToolCalls, false);
  assert.equal(capabilities.supportsStructuredOutputs, true);
  assert.equal(capabilities.supportsVisionInput, false);
  assert.equal(capabilities.preferredApiStyle, "openai_compatible");
});

test("model capability registry resolves legacy DeepSeek context windows explicitly", () => {
  const chat = resolveModelCapabilities({
    profile: profile("deepseek-chat", {
      profileId: "deepseek",
      label: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
    }),
  });
  const reasoner = resolveModelCapabilities({
    profile: profile("deepseek-reasoner", {
      profileId: "deepseek",
      label: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
    }),
  });

  assert.equal(chat.contextWindowTokens, 64_000);
  assert.equal(chat.maxOutputTokens, 8_000);
  assert.equal(chat.supportsVisionInput, false);
  assert.equal(reasoner.contextWindowTokens, 64_000);
  assert.equal(reasoner.maxOutputTokens, 64_000);
  assert.equal(reasoner.supportsToolCalling, false);
  assert.equal(reasoner.supportsReasoningOutput, true);
});

test("model capability registry does not infer provider ownership from shared model ids", () => {
  const routedProfile = profile("deepseek-v4-pro", {
    profileId: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
  });
  const routedGptProfile = profile("gpt-5.5", {
    profileId: "gateway",
    label: "Gateway",
    baseUrl: "https://gateway.example/v1",
  });
  const capabilities = resolveModelCapabilities({ profile: routedProfile });
  const gptCapabilities = resolveModelCapabilities({ profile: routedGptProfile });

  assert.equal(capabilities.protocolProfileId, "openai_compatible");
  assert.equal(capabilities.contextWindowTokens, PROTOCOL_BASELINE_MODEL_CAPABILITIES.contextWindowTokens);
  assert.equal(capabilities.maxOutputTokens, PROTOCOL_BASELINE_MODEL_CAPABILITIES.maxOutputTokens);
  assert.equal(capabilities.supportsToolCalling, true);
  assert.equal(capabilities.supportsVisionInput, false);
  assert.equal(capabilities.supportsReasoningEffort, false);
  assert.equal(gptCapabilities.contextWindowTokens, PROTOCOL_BASELINE_MODEL_CAPABILITIES.contextWindowTokens);
  assert.equal(gptCapabilities.maxOutputTokens, PROTOCOL_BASELINE_MODEL_CAPABILITIES.maxOutputTokens);
  assert.equal(gptCapabilities.supportsToolCalling, true);
  assert.equal(gptCapabilities.supportsVisionInput, false);
  assert.equal(gptCapabilities.supportsReasoningEffort, false);
});

test("model capability registry keeps provider-specific reasoning controls conservative", () => {
  const kimiK3 = resolveModelCapabilities({
    profile: profile("kimi-k3", {
      profileId: "moonshot",
      label: "Kimi",
      baseUrl: "https://api.moonshot.cn/v1",
    }),
  });
  const kimi = resolveModelCapabilities({
    profile: profile("kimi-k2.6", {
      profileId: "moonshot",
      label: "Kimi",
      baseUrl: "https://api.moonshot.cn/v1",
    }),
  });
  const glm = resolveModelCapabilities({
    profile: profile("glm-4.5", {
      profileId: "glm",
      label: "GLM",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    }),
  });
  const glm51 = resolveModelCapabilities({
    profile: profile("glm-5.1", {
      profileId: "glm",
      label: "GLM",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    }),
  });
  const glm47 = resolveModelCapabilities({
    profile: profile("glm-4.7", {
      profileId: "glm",
      label: "GLM",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    }),
  });
  const minimax = resolveModelCapabilities({
    profile: profile("MiniMax-M2", {
      profileId: "minimax",
      label: "MiniMax",
      baseUrl: "https://api.minimaxi.com/v1",
    }),
  });

  assert.equal(kimiK3.reasoningControl, "kimi_k3_reasoning_effort");
  assert.equal(kimiK3.supportsReasoningOutput, true);
  assert.equal(kimi.reasoningControl, "thinking_enabled_disabled");
  assert.equal(kimi.supportsReasoningEffort, false);
  assert.equal(kimi.supportsReasoningOutput, true);
  assert.equal(kimi.supportsStreaming, true);
  assert.equal(kimi.contextWindowTokens, 256_000);
  assert.equal(kimi.maxOutputTokens, 32_768);
  assert.equal(kimi.supportsVisionInput, true);
  assert.equal(glm.reasoningControl, "thinking_disabled");
  assert.equal(glm.supportsReasoningEffort, false);
  assert.equal(glm.supportsReasoningOutput, false);
  assert.equal(glm.supportsStreaming, false);
  assert.equal(glm51.reasoningControl, "thinking_enabled_disabled");
  assert.equal(glm51.supportsReasoningEffort, false);
  assert.equal(glm51.supportsReasoningOutput, true);
  assert.equal(glm51.supportsStreaming, true);
  assert.equal(glm51.supportsVisionInput, false);
  assert.equal(glm47.reasoningControl, "thinking_enabled_disabled");
  assert.equal(glm47.supportsReasoningOutput, true);
  assert.equal(glm47.supportsStreaming, true);
  assert.equal(minimax.reasoningControl, "reasoning_split");
  assert.equal(minimax.supportsReasoningEffort, false);
  assert.equal(minimax.supportsReasoningOutput, true);
  assert.equal(minimax.supportsStreaming, true);
  assert.equal(minimax.supportsVisionInput, false);
});

test("model capability registry resolves Kimi K3 before the generic Kimi family", () => {
  const kimiK3 = resolveModelCapabilities({
    profile: profile("kimi-k3", {
      profileId: "moonshot",
      label: "Kimi",
      baseUrl: "https://api.moonshot.ai/v1",
    }),
  });

  assert.equal(kimiK3.contextWindowTokens, 1_048_576);
  assert.equal(kimiK3.maxOutputTokens, 128_000);
  assert.equal(kimiK3.supportsToolCalling, true);
  assert.equal(kimiK3.supportsStructuredOutputs, true);
  assert.equal(kimiK3.supportsVisionInput, true);
  assert.equal(kimiK3.supportsReasoningEffort, false);
  assert.equal(kimiK3.reasoningControl, "kimi_k3_reasoning_effort");
});

test("model capability registry keeps MiniMax M2 and M3 multimodal metadata separate", () => {
  const minimaxM2 = resolveModelCapabilities({
    profile: profile("MiniMax-M2", {
      profileId: "minimax",
      label: "MiniMax",
      baseUrl: "https://api.minimaxi.com/v1",
    }),
  });
  const minimaxM3 = resolveModelCapabilities({
    profile: profile("MiniMax-M3", {
      profileId: "minimax",
      label: "MiniMax",
      baseUrl: "https://api.minimaxi.com/v1",
    }),
  });

  assert.equal(minimaxM2.contextWindowTokens, 204_800);
  assert.equal(minimaxM2.maxOutputTokens, 204_800);
  assert.equal(minimaxM2.supportsVisionInput, false);
  assert.equal(minimaxM3.protocolProfileId, "minimax");
  assert.equal(minimaxM3.contextWindowTokens, 1_000_000);
  assert.equal(minimaxM3.maxOutputTokens, 524_288);
  assert.equal(minimaxM3.supportsVisionInput, true);
  assert.equal(minimaxM3.preferredApiStyle, "chat_completions");
});

test("protocol baseline models keep tool calling while budgets stay conservative", () => {
  const chatProfile = profile("vendor-new-model", {
    profileId: "vendor",
    label: "Vendor",
    baseUrl: "https://vendor.example/v1",
  });
  const responsesProfile = profile("vendor-responses-model", {
    profileId: "vendor-responses",
    label: "Vendor Responses",
    protocolKind: "openai_responses",
    defaultAiMode: "openai-responses",
    baseUrl: "https://responses.example/v1",
  });
  const chatBaseline = resolveModelCapabilities({ profile: chatProfile });
  const responsesBaseline = resolveModelCapabilities({ profile: responsesProfile });
  const overridden = resolveModelCapabilities({
    profile: chatProfile,
    overrides: [
      {
        providerKind: "openai_compatible",
        model: "vendor-new-model",
        capabilities: {
          contextWindowTokens: 96_000,
          maxOutputTokens: 12_000,
          supportsToolCalling: true,
          supportsStructuredOutputs: true,
        },
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
    ],
  });
  const overrideApplied = hasModelCapabilityOverride({
    profile: chatProfile,
    overrides: [
      {
        providerKind: "openai_compatible",
        model: "vendor-new-model",
        capabilities: {
          supportsToolCalling: true,
        },
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
    ],
  });

  assert.equal(overrideApplied, true);
  assert.equal(PROTOCOL_BASELINE_MODEL_CAPABILITIES.contextWindowTokens, 256_000);
  assert.equal(PROTOCOL_BASELINE_MODEL_CAPABILITIES.maxOutputTokens, 32_768);
  assert.equal(chatBaseline.contextWindowTokens, PROTOCOL_BASELINE_MODEL_CAPABILITIES.contextWindowTokens);
  assert.equal(chatBaseline.maxOutputTokens, PROTOCOL_BASELINE_MODEL_CAPABILITIES.maxOutputTokens);
  assert.equal(chatBaseline.supportsToolCalling, true);
  assert.equal(chatBaseline.supportsParallelToolCalls, false);
  assert.equal(chatBaseline.supportsStructuredOutputs, false);
  assert.equal(chatBaseline.supportsVisionInput, false);
  assert.equal(chatBaseline.preferredApiStyle, "chat_completions");
  assert.equal(responsesBaseline.supportsToolCalling, true);
  assert.equal(responsesBaseline.supportsVisionInput, false);
  assert.equal(responsesBaseline.preferredApiStyle, "responses");
  assert.equal(overridden.contextWindowTokens, 96_000);
  assert.equal(overridden.maxOutputTokens, 12_000);
  assert.equal(overridden.supportsToolCalling, true);
  assert.equal(overridden.supportsStructuredOutputs, true);
  assert.equal(JSON.stringify(overridden).includes("secret"), false);
});

test("model capability registry scopes overrides to the selected profile before global fallback", () => {
  const firstProfile = profile("shared-route-model", {
    profileId: "custom-a",
    label: "Custom A",
    baseUrl: "https://a.example/v1",
  });
  const secondProfile = profile("shared-route-model", {
    profileId: "custom-b",
    label: "Custom B",
    baseUrl: "https://b.example/v1",
  });
  const overrides = [
    {
      profileId: "custom-a",
      providerKind: "openai_compatible" as const,
      model: "shared-route-model",
      capabilities: {
        supportsToolCalling: true,
        contextWindowTokens: 64_000,
      },
      updatedAt: "2026-06-20T00:00:00.000Z",
    },
    {
      providerKind: "openai_compatible" as const,
      model: "shared-route-model",
      capabilities: {
        supportsToolCalling: false,
        contextWindowTokens: 8_000,
      },
      updatedAt: "2026-06-20T00:00:00.000Z",
    },
  ];

  const first = resolveModelCapabilities({ profile: firstProfile, overrides });
  const second = resolveModelCapabilities({ profile: secondProfile, overrides });

  assert.equal(first.supportsToolCalling, true);
  assert.equal(first.contextWindowTokens, 64_000);
  assert.equal(second.supportsToolCalling, false);
  assert.equal(second.contextWindowTokens, 8_000);
});

test("model capability registry merges profile context fallback with provider-level model overrides", () => {
  const selectedProfile = profile("shared-route-model", {
    profileId: "custom-a",
    label: "Custom A",
    baseUrl: "https://a.example/v1",
  });
  const resolved = resolveModelCapabilities({
    profile: selectedProfile,
    overrides: [
      {
        providerKind: "openai_compatible" as const,
        model: "shared-route-model",
        capabilities: {
          supportsToolCalling: false,
          supportsVisionInput: false,
          maxOutputTokens: 12_000,
        },
        updatedAt: "2026-06-20T00:00:00.000Z",
      },
      {
        profileId: "custom-a",
        providerKind: "openai_compatible" as const,
        model: "shared-route-model",
        capabilities: {
          contextWindowTokens: 128_000,
        },
        updatedAt: "2026-06-20T00:01:00.000Z",
      },
    ],
  });

  assert.equal(resolved.contextWindowTokens, 128_000);
  assert.equal(resolved.maxOutputTokens, 12_000);
  assert.equal(resolved.supportsToolCalling, false);
  assert.equal(resolved.supportsVisionInput, false);
  assert.deepEqual(resolved.imageInput, { status: "unsupported", source: "override" });
});
