import assert from "node:assert/strict";
import test from "node:test";
import type { ModelRequest } from "../domain/intelligence/index.js";
import {
  createModelRuntimeConfig,
  ModelRuntimeConfigurationError,
} from "./model-runtime/index.js";
import { createMinimalRuntime } from "./runtime.js";

test("model runtime factory exposes a disabled boundary without runtime factories", () => {
  const config = createModelRuntimeConfig({});

  assert.equal(config.enabled, false);
  assert.equal(config.mode, "none");
  assert.deepEqual(config.summaryInput, {
    enabled: false,
    mode: "none",
  });
  assert.equal("createIntelligenceChannel" in config, false);
});

test("model runtime factory creates explicit fake provider config", () => {
  const config = createModelRuntimeConfig({ mode: "fake" });

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
      createModelRuntimeConfig({
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
      assert.equal(error instanceof ModelRuntimeConfigurationError, true);
      const configError = error as ModelRuntimeConfigurationError;
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
      createModelRuntimeConfig({
        mode: "openai-compatible",
        env: {
          AGENTARBOR_MODEL_API_KEY: secret,
        },
      }),
    (error) => {
      assert.equal(error instanceof ModelRuntimeConfigurationError, true);
      const serialized = JSON.stringify(error);
      const configError = error as ModelRuntimeConfigurationError;
      assert.equal(configError.issue.code, "missing_model_name");
      assert.equal(configError.issue.message.includes(secret), false);
      assert.equal(serialized.includes(secret), false);
      return true;
    }
  );
});

test("openai-compatible AI config prefers frozen model provider facts over env model settings", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const config = createModelRuntimeConfig({
    mode: "openai-compatible",
    env: {
      AGENTARBOR_MODEL_API_KEY: "sk-test",
      AGENTARBOR_MODEL_NAME: "current-env-model",
      AGENTARBOR_MODEL_BASE_URL: "https://current.example",
    },
    modelProvider: {
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      profileId: "snapshot-profile",
      baseUrl: "https://snapshot.example",
      model: "snapshot-model",
    },
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "chatcmpl-snapshot",
          model: "snapshot-model",
          choices: [
            {
              message: { role: "assistant", content: JSON.stringify({ summary: "Snapshot model used." }) },
              finish_reason: "stop",
            },
          ],
        }),
      };
    },
  });

  assert.equal(config.enabled, true);
  if (!config.enabled) {
    throw new Error("Expected config to be enabled.");
  }

  const response = await config.createIntelligenceChannel(createMinimalRuntime()).request(createValidModelRequest());

  assert.equal(response.status, "completed");
  assert.equal(config.summaryInput.model, "snapshot-model");
  assert.equal(calls[0]?.url, "https://snapshot.example/chat/completions");
  assert.equal(calls[0]?.body.model, "snapshot-model");
});

test("openai-responses AI config prefers frozen model provider facts over env model settings", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const config = createModelRuntimeConfig({
    mode: "openai-responses",
    env: {
      AGENTARBOR_MODEL_API_KEY: "sk-test",
      AGENTARBOR_MODEL_NAME: "current-env-model",
      AGENTARBOR_MODEL_BASE_URL: "https://current.example",
    },
    modelProvider: {
      providerKind: "openai_compatible",
      protocolKind: "openai_responses",
      profileId: "snapshot-profile",
      baseUrl: "https://snapshot.example",
      model: "snapshot-responses-model",
    },
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "resp-snapshot",
          model: "snapshot-responses-model",
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: JSON.stringify({ summary: "Snapshot responses model used." }) }],
            },
          ],
        }),
      };
    },
  });

  assert.equal(config.enabled, true);
  if (!config.enabled) {
    throw new Error("Expected config to be enabled.");
  }

  const response = await config.createIntelligenceChannel(createMinimalRuntime()).request(createValidModelRequest());

  assert.equal(response.status, "completed");
  assert.equal(config.summaryInput.model, "snapshot-responses-model");
  assert.equal(calls[0]?.url, "https://snapshot.example/responses");
  assert.equal(calls[0]?.body.model, "snapshot-responses-model");
});

function createValidModelRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    requestId: "model-runtime-request-test",
    traceId: "trace-test",
    callerRef: { kind: "goal", id: "goal-test" },
    purpose: "desktop_agent",
    inputRefs: [{ kind: "goal", id: "goal-test" }],
    sanitizedMessages: [{ role: "user", content: "Use the configured model.", ref: "goal-test" }],
    outputContract: {
      contractId: "test.model-runtime.v1",
      outputKind: "explanation",
      format: "json_object",
      requiredFields: ["summary"],
      requiredStringFields: ["summary"],
    },
    constraintRefs: [],
    budget: { maxOutputTokens: 128 },
    sensitivity: "internal",
    requestedAt: "2026-06-06T00:00:00.000Z",
    ...overrides,
  };
}
