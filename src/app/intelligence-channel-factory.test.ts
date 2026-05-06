import assert from "node:assert/strict";
import test from "node:test";
import {
  createUndergroundAiRuntimeConfig,
  UndergroundAiConfigurationError,
} from "./intelligence-channel-factory.js";

test("underground AI factory exposes a disabled boundary without runtime factories", () => {
  const config = createUndergroundAiRuntimeConfig({});

  assert.equal(config.enabled, false);
  assert.equal(config.mode, "none");
  assert.deepEqual(config.summaryInput, {
    enabled: false,
    mode: "none",
  });
  assert.equal("createIntelligenceChannel" in config, false);
});

test("underground AI factory creates explicit fake provider config", () => {
  const config = createUndergroundAiRuntimeConfig({ mode: "fake" });

  assert.equal(config.enabled, true);
  if (!config.enabled) {
    throw new Error("Expected fake config to be enabled.");
  }
  assert.equal(config.summaryInput.providerKind, "fake");
  assert.equal(config.summaryInput.protocolKind, "openai_compatible_chat_completions");
  assert.equal(config.summaryInput.model, "fake-deterministic-model");
});

test("openai-compatible AI config fails before network when API key is missing", () => {
  const fetchCalls: string[] = [];

  assert.throws(
    () =>
      createUndergroundAiRuntimeConfig({
        mode: "openai-compatible",
        env: {
          AGENTARBOR_MODEL_NAME: "test-model",
        },
        fetch: async (url) => {
          fetchCalls.push(url);
          throw new Error("fetch must not be called during configuration validation.");
        },
      }),
    (error) => {
      assert.equal(error instanceof UndergroundAiConfigurationError, true);
      const configError = error as UndergroundAiConfigurationError;
      assert.equal(configError.issue.code, "missing_api_key");
      assert.equal(configError.issue.summaryInput.enabled, true);
      assert.equal(configError.issue.summaryInput.model, "test-model");
      assert.equal(configError.issue.message.includes("no network request was attempted"), true);
      return true;
    }
  );
  assert.deepEqual(fetchCalls, []);
});

test("openai-compatible AI config does not leak API key in model-name failure", () => {
  const secret = "sk-test-secret-token";

  assert.throws(
    () =>
      createUndergroundAiRuntimeConfig({
        mode: "openai-compatible",
        env: {
          AGENTARBOR_MODEL_API_KEY: secret,
        },
      }),
    (error) => {
      assert.equal(error instanceof UndergroundAiConfigurationError, true);
      const serialized = JSON.stringify(error);
      const configError = error as UndergroundAiConfigurationError;
      assert.equal(configError.issue.code, "missing_model_name");
      assert.equal(configError.issue.message.includes(secret), false);
      assert.equal(serialized.includes(secret), false);
      return true;
    }
  );
});
