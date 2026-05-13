import assert from "node:assert/strict";
import test from "node:test";
import type { SanitizedModelProviderConfig } from "../domain/config/index.js";
import {
  CONSERVATIVE_MODEL_CAPABILITIES,
  isKnownModel,
  resolveModelCapabilities,
} from "./model-capability-registry.js";

function profile(model: string): SanitizedModelProviderConfig {
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
  const capabilities = resolveModelCapabilities({ profile: profile("deepseek-v4-pro") });

  assert.equal(isKnownModel(profile("deepseek-v4-pro")), true);
  assert.equal(capabilities.contextWindowTokens, 1_000_000);
  assert.equal(capabilities.maxOutputTokens, 384_000);
  assert.equal(capabilities.supportsToolCalling, true);
  assert.equal(capabilities.supportsParallelToolCalls, false);
  assert.equal(capabilities.supportsStructuredOutputs, true);
  assert.equal(capabilities.preferredApiStyle, "openai_compatible");
});

test("unknown models use conservative capabilities until explicitly overridden", () => {
  const unknown = profile("vendor-new-model");
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
