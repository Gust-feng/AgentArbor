import assert from "node:assert/strict";
import test from "node:test";
import type { OpenAIAgentsLoopConfig } from "../../adapters/intelligence/openai-agents-loop.js";
import type { AgentLoop } from "./agent-loop.js";
import {
  createModelRuntimeAgentLoop,
  ModelRuntimeConfigurationError,
  type ModelRuntimeProviderFetch,
} from "./index.js";

const unusedLoop: AgentLoop = {
  execute: async () => {
    throw new Error("The observable factory seam must not execute the loop.");
  },
  release: async () => undefined,
};

test("AgentLoop factory resolves an OpenAI Responses profile through the shared configuration rules", () => {
  const providerFetch: ModelRuntimeProviderFetch = async () => {
    throw new Error("Configuration must not perform a provider request.");
  };
  let captured: OpenAIAgentsLoopConfig | undefined;

  const loop = createModelRuntimeAgentLoop(
    {
      env: {
        OPENAI_API_KEY: "env-key",
        AGENTARBOR_MODEL_NAME: "env-model",
        AGENTARBOR_MODEL_BASE_URL: "https://env.example/v1",
      },
      modelProvider: {
        profileId: "responses-profile",
        providerKind: "openai_compatible",
        protocolKind: "openai_responses",
        baseUrl: "https://responses.example/v1",
        model: "gpt-responses",
        openAI: { serviceTier: "flex", reasoningEffort: "medium" },
      },
      providerFetch,
    },
    {
      createOpenAILoop: (config) => {
        captured = config;
        return unusedLoop;
      },
    },
  );

  assert.equal(loop, unusedLoop);
  assert.deepEqual(captured, {
    protocol: "openai_responses",
    baseUrl: "https://responses.example/v1",
    apiKey: "env-key",
    model: "gpt-responses",
    requestSettings: { serviceTier: "flex", reasoningEffort: "medium" },
    fetch: providerFetch,
  });
});

test("AgentLoop factory resolves OpenAI-compatible Chat Completions from explicit environment configuration", () => {
  let captured: OpenAIAgentsLoopConfig | undefined;

  createModelRuntimeAgentLoop(
    {
      mode: "openai-compatible",
      env: {
        AGENTARBOR_MODEL_API_KEY: "agentarbor-key",
        OPENAI_API_KEY: "fallback-key",
        AGENTARBOR_MODEL_NAME: "chat-model",
      },
    },
    {
      createOpenAILoop: (config) => {
        captured = config;
        return unusedLoop;
      },
    },
  );

  assert.deepEqual(captured, {
    protocol: "openai_compatible_chat_completions",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "agentarbor-key",
    model: "chat-model",
    requestSettings: undefined,
    fetch: undefined,
  });
});

test("AgentLoop factory fails clearly when the model runtime is disabled", () => {
  assert.throws(
    () => createModelRuntimeAgentLoop({ mode: "none" }),
    configurationIssue("ai_disabled"),
  );
});

test("AgentLoop factory requires an explicit fake loop instead of constructing production fake behavior", () => {
  assert.throws(
    () => createModelRuntimeAgentLoop({ mode: "fake" }),
    configurationIssue("unsupported_provider_protocol"),
  );
  assert.equal(
    createModelRuntimeAgentLoop({ mode: "fake", fakeAgentLoop: unusedLoop }),
    unusedLoop,
  );
});

test("AgentLoop factory rejects a mode that disagrees with the frozen profile protocol", () => {
  assert.throws(
    () => createModelRuntimeAgentLoop({
      mode: "openai-compatible",
      env: { AGENTARBOR_MODEL_API_KEY: "key" },
      modelProvider: {
        profileId: "responses-profile",
        providerKind: "openai_compatible",
        protocolKind: "openai_responses",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-responses",
      },
    }),
    configurationIssue("unsupported_provider_protocol"),
  );
});

test("AgentLoop factory reports missing credentials and model before adapter creation", () => {
  let factoryCalls = 0;
  const dependencies = {
    createOpenAILoop: (_config: OpenAIAgentsLoopConfig) => {
      factoryCalls += 1;
      return unusedLoop;
    },
  };

  assert.throws(
    () => createModelRuntimeAgentLoop({
      mode: "openai-responses",
      env: { AGENTARBOR_MODEL_NAME: "gpt" },
    }, dependencies),
    configurationIssue("missing_api_key"),
  );
  assert.throws(
    () => createModelRuntimeAgentLoop({
      mode: "openai-responses",
      env: { OPENAI_API_KEY: "key" },
    }, dependencies),
    configurationIssue("missing_model_name"),
  );
  assert.equal(factoryCalls, 0);
});

function configurationIssue(code: ModelRuntimeConfigurationError["issue"]["code"]) {
  return (error: unknown): boolean => {
    assert.equal(error instanceof ModelRuntimeConfigurationError, true);
    assert.equal((error as ModelRuntimeConfigurationError).issue.code, code);
    return true;
  };
}
