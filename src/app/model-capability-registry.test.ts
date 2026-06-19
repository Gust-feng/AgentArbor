import assert from "node:assert/strict";
import test from "node:test";
import type { SanitizedModelProviderConfig } from "../domain/config/index.js";
import {
  CONSERVATIVE_MODEL_CAPABILITIES,
  isKnownModel,
  resolveModelCapabilities,
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

test("model capability registry resolves current OpenAI-compatible model families", () => {
  const capabilities = resolveModelCapabilities({ profile: profile("gpt-5.5") });

  assert.equal(isKnownModel(profile("gpt-5.5")), true);
  assert.equal(capabilities.contextWindowTokens, 1_050_000);
  assert.equal(capabilities.maxOutputTokens, 128_000);
  assert.equal(capabilities.supportsToolCalling, true);
  assert.equal(capabilities.supportsStructuredOutputs, true);
  assert.equal(capabilities.supportsReasoningEffort, true);
  assert.equal(capabilities.supportsReasoningOutput, true);
  assert.equal(capabilities.preferredApiStyle, "responses");
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

  assert.equal(isKnownModel(deepseekProfile), true);
  assert.equal(capabilities.contextWindowTokens, 1_000_000);
  assert.equal(capabilities.maxOutputTokens, 384_000);
  assert.equal(capabilities.supportsToolCalling, true);
  assert.equal(capabilities.supportsParallelToolCalls, false);
  assert.equal(capabilities.supportsStructuredOutputs, true);
  assert.equal(capabilities.preferredApiStyle, "openai_compatible");
});

test("model capability registry does not infer provider ownership from shared model ids", () => {
  const routedProfile = profile("deepseek-v4-pro", {
    profileId: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
  });
  const capabilities = resolveModelCapabilities({ profile: routedProfile });

  assert.equal(isKnownModel(routedProfile), false);
  assert.equal(capabilities.protocolProfileId, "custom_openai_chat");
  assert.equal(capabilities.contextWindowTokens, CONSERVATIVE_MODEL_CAPABILITIES.contextWindowTokens);
  assert.equal(capabilities.maxOutputTokens, CONSERVATIVE_MODEL_CAPABILITIES.maxOutputTokens);
});

test("model capability registry keeps provider-specific reasoning controls conservative", () => {
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
  const minimax = resolveModelCapabilities({
    profile: profile("MiniMax-M2", {
      profileId: "minimax",
      label: "MiniMax",
      baseUrl: "https://api.minimaxi.com/v1",
    }),
  });

  assert.equal(kimi.reasoningControl, "thinking_enabled_disabled");
  assert.equal(kimi.supportsReasoningEffort, false);
  assert.equal(kimi.supportsReasoningOutput, true);
  assert.equal(kimi.supportsStreaming, true);
  assert.equal(glm.reasoningControl, "thinking_disabled");
  assert.equal(glm.supportsReasoningEffort, false);
  assert.equal(glm.supportsReasoningOutput, false);
  assert.equal(glm.supportsStreaming, false);
  assert.equal(glm51.reasoningControl, "thinking_enabled_disabled");
  assert.equal(glm51.supportsReasoningEffort, false);
  assert.equal(glm51.supportsReasoningOutput, true);
  assert.equal(glm51.supportsStreaming, true);
  assert.equal(minimax.reasoningControl, "reasoning_split");
  assert.equal(minimax.supportsReasoningEffort, false);
  assert.equal(minimax.supportsReasoningOutput, true);
  assert.equal(minimax.supportsStreaming, true);
});

test("unknown models use conservative capabilities until explicitly overridden", () => {
  const unknown = profile("vendor-new-model", {
    profileId: "vendor",
    label: "Vendor",
    baseUrl: "https://vendor.example/v1",
  });
  const fallback = resolveModelCapabilities({ profile: unknown });
  const overridden = resolveModelCapabilities({
    profile: unknown,
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

  assert.equal(isKnownModel(unknown), false);
  assert.deepEqual(fallback, CONSERVATIVE_MODEL_CAPABILITIES);
  assert.equal(overridden.contextWindowTokens, 96_000);
  assert.equal(overridden.maxOutputTokens, 12_000);
  assert.equal(overridden.supportsToolCalling, true);
  assert.equal(overridden.supportsStructuredOutputs, true);
  assert.equal(JSON.stringify(overridden).includes("secret"), false);
});
