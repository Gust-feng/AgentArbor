import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderStreams } from "@earendil-works/pi-ai";
import { fauxProvider } from "@earendil-works/pi-ai";
import { createModelProviderBinding } from "./model-provider-binding.js";

test("model provider binding maps both supported protocols without model-name gates", () => {
  const chat = createModelProviderBinding({
    protocol: "openai_compatible_chat_completions",
    baseUrl: "https://chat.example/v1",
    profileId: "chat-profile",
    apiKey: "chat-key",
    model: "unknown-chat-model",
    contextWindow: 200_000,
    maxOutputTokens: 20_000,
  }, { createChatCompletionsTransport: fauxStreams });
  const responses = createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: "https://responses.example/v1",
    profileId: "responses-profile",
    apiKey: "responses-key",
    model: "unknown-responses-model",
    providerProfileId: "openai",
  }, { createResponsesTransport: fauxStreams });

  assert.deepEqual({
    api: chat.selectedModel.api,
    baseUrl: chat.selectedModel.baseUrl,
    contextWindow: chat.selectedModel.contextWindow,
    maxTokens: chat.selectedModel.maxTokens,
  }, {
    api: "openai-completions",
    baseUrl: "https://chat.example/v1",
    contextWindow: 200_000,
    maxTokens: 20_000,
  });
  assert.deepEqual(chat.selectedModel.input, ["text"]);
  assert.deepEqual(responses.selectedModel.input, ["text"]);
  assert.equal(responses.selectedModel.api, "openai-responses");
  assert.equal(responses.selectedModel.provider, "agentarbor-responses-profile");
});

test("model provider binding does not infer native tool search from a provider profile", () => {
  const officialOpenAI = createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: "https://api.openai.com/v1",
    profileId: "official-openai-responses",
    providerProfileId: "openai",
    apiKey: "key",
    model: "gpt-5",
  }, { createResponsesTransport: fauxStreams });
  const compatible = createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: "https://compatible.example/v1",
    profileId: "compatible-responses",
    providerProfileId: "openai_compatible",
    apiKey: "key",
    model: "compatible-model",
  }, { createResponsesTransport: fauxStreams });
  const unclassified = createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: "https://api.openai.com/v1",
    profileId: "unclassified-responses",
    apiKey: "key",
    model: "gpt-5",
  }, { createResponsesTransport: fauxStreams });

  assert.equal(officialOpenAI.selectedModel.compat, undefined);
  assert.equal(compatible.selectedModel.compat, undefined);
  assert.equal(unclassified.selectedModel.compat, undefined);
});

test("model provider binding preserves the frozen vision capability in the Pi model", () => {
  const vision = createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: "https://responses.example/v1",
    profileId: "vision-profile",
    apiKey: "key",
    model: "vision-model",
    supportsVisionInput: true,
  }, { createResponsesTransport: fauxStreams });
  const textOnly = createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: "https://responses.example/v1",
    profileId: "text-only-profile",
    apiKey: "key",
    model: "text-model",
    supportsVisionInput: false,
  }, { createResponsesTransport: fauxStreams });

  assert.deepEqual(vision.selectedModel.input, ["text", "image"]);
  assert.deepEqual(textOnly.selectedModel.input, ["text"]);
});

test("model provider binding maps the explicit Chat provider dialect into Pi compat", () => {
  const deepseek = createModelProviderBinding({
    protocol: "openai_compatible_chat_completions",
    baseUrl: "https://proxy.example/v1",
    profileId: "deepseek-dialect-profile",
    providerProfileId: "deepseek",
    apiKey: "key",
    model: "deepseek-v4-pro",
    requestSettings: { reasoningEffort: "high", temperature: 0.2, topP: 0.8 },
  }, { createChatCompletionsTransport: fauxStreams });

  assert.deepEqual(deepseek.selectedModel.compat, {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: true,
    supportsUsageInStreaming: true,
    normalizeCumulativeDeltas: false,
    requiresReasoningContentOnAssistantMessages: true,
    thinkingFormat: "deepseek",
  });
  const transformed = deepseek.transformProviderPayload?.({
    model: deepseek.selectedModel,
    payload: { model: "deepseek-v4-pro", stream: true, reasoning_effort: "high" },
    tools: [],
  }) as Record<string, unknown>;
  assert.deepEqual(transformed, {
    model: "deepseek-v4-pro",
    stream: true,
    reasoning_effort: "high",
    thinking: { type: "enabled" },
  });
});

test("model provider binding does not infer deferred tool loading from a Kimi model name", () => {
  const kimi = createModelProviderBinding({
    protocol: "openai_compatible_chat_completions",
    baseUrl: "https://api.moonshot.cn/v1",
    profileId: "moonshot-profile",
    providerProfileId: "moonshot",
    apiKey: "key",
    model: "kimi-k3",
  }, { createChatCompletionsTransport: fauxStreams });

  assert.equal(
    (kimi.selectedModel.compat as { readonly requiresReasoningContentOnAssistantMessages?: boolean })
      .requiresReasoningContentOnAssistantMessages,
    true,
  );
  assert.equal(
    (kimi.selectedModel.compat as { readonly deferredToolsMode?: unknown }).deferredToolsMode,
    undefined,
  );
});

test("model provider binding keeps unconditional Chat dialect controls without request settings", () => {
  const legacyGlm = createModelProviderBinding({
    protocol: "openai_compatible_chat_completions",
    baseUrl: "https://proxy.example/v1",
    profileId: "glm-dialect-profile",
    providerProfileId: "glm",
    apiKey: "key",
    model: "glm-4.5",
  }, { createChatCompletionsTransport: fauxStreams });
  const minimax = createModelProviderBinding({
    protocol: "openai_compatible_chat_completions",
    baseUrl: "https://proxy.example/v1",
    profileId: "minimax-dialect-profile",
    providerProfileId: "minimax",
    apiKey: "key",
    model: "MiniMax-M2.7",
  }, { createChatCompletionsTransport: fauxStreams });

  assert.deepEqual(legacyGlm.transformProviderPayload?.({
    model: legacyGlm.selectedModel,
    payload: { model: "glm-4.5", stream: true },
    tools: [],
  }), {
    model: "glm-4.5",
    stream: true,
    thinking: { type: "disabled" },
  });
  assert.deepEqual(minimax.transformProviderPayload?.({
    model: minimax.selectedModel,
    payload: { model: "MiniMax-M2.7", stream: true },
    tools: [],
  }), {
    model: "MiniMax-M2.7",
    stream: true,
    reasoning_split: true,
  });
  assert.equal(
    (minimax.selectedModel.compat as { readonly normalizeCumulativeDeltas?: boolean } | undefined)
      ?.normalizeCumulativeDeltas,
    true,
  );
});

test("model provider binding preserves non-streaming and hosted web search in provider payloads", () => {
  const chat = createModelProviderBinding({
    protocol: "openai_compatible_chat_completions",
    baseUrl: "https://chat.example/v1",
    profileId: "non-streaming-profile",
    apiKey: "key",
    model: "legacy-model",
    requestSettings: { stream: false },
  }, { createChatCompletionsTransport: fauxStreams });
  assert.deepEqual(chat.transformProviderPayload?.({
    model: chat.selectedModel,
    payload: { model: "legacy-model", stream: true, stream_options: { include_usage: true } },
    tools: [],
  }), {
    model: "legacy-model",
    stream: false,
    stream_options: { include_usage: true },
  });

  const responses = createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: "https://responses.example/v1",
    profileId: "web-search-profile",
    apiKey: "key",
    model: "search-model",
    requestSettings: { stream: false },
    enableWebSearch: true,
  }, { createResponsesTransport: fauxStreams });
  assert.deepEqual(responses.transformProviderPayload?.({
    model: responses.selectedModel,
    payload: {
      model: "search-model",
      stream: true,
      tools: [{ type: "function", name: "read" }],
    },
    tools: [],
  }), {
    model: "search-model",
    stream: false,
    tools: [
      { type: "function", name: "read" },
      { type: "web_search", search_context_size: "medium" },
    ],
  });
});

test("model provider binding resolves the dynamic API key for every request-time auth lookup", async () => {
  const observed = ["token-one", "token-two", undefined];
  let calls = 0;
  const binding = createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: "https://responses.example/v1",
    profileId: "dynamic-profile",
    model: "dynamic-auth-model",
    resolveApiKey: () => observed[calls++],
  }, { createResponsesTransport: fauxStreams });

  assert.equal((await binding.modelRegistry.getAuth(binding.selectedModel))?.auth.apiKey, "token-one");
  assert.equal((await binding.modelRegistry.getAuth(binding.selectedModel))?.auth.apiKey, "token-two");
  assert.equal(await binding.modelRegistry.getAuth(binding.selectedModel), undefined);
  assert.equal(calls, 3);
});

test("model provider binding uses frozen reasoning capability independently from effort controls", () => {
  const reasoningModel = createModelProviderBinding({
    protocol: "openai_compatible_chat_completions",
    baseUrl: "https://chat.example/v1",
    profileId: "reasoning-profile",
    apiKey: "key",
    model: "reasoning-without-effort-control",
    supportsReasoningOutput: true,
  }, { createChatCompletionsTransport: fauxStreams });
  const plainModel = createModelProviderBinding({
    protocol: "openai_compatible_chat_completions",
    baseUrl: "https://chat.example/v1",
    profileId: "plain-profile",
    apiKey: "key",
    model: "plain-model",
    supportsReasoningOutput: false,
    requestSettings: { reasoningEffort: "high" },
  }, { createChatCompletionsTransport: fauxStreams });

  assert.equal(reasoningModel.selectedModel.reasoning, true);
  assert.equal(plainModel.selectedModel.reasoning, false);
});

test("model provider binding maps frozen reasoning effort to Pi thinking levels", () => {
  const off = createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: "https://responses.example/v1",
    profileId: "off-profile",
    apiKey: "key",
    model: "plain-model",
    requestSettings: { reasoningEffort: "none" },
  }, { createResponsesTransport: fauxStreams });
  const high = createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: "https://responses.example/v1",
    profileId: "high-profile",
    apiKey: "key",
    model: "reasoning-model",
    requestSettings: { reasoningEffort: "high" },
  }, { createResponsesTransport: fauxStreams });

  assert.equal(off.thinkingLevel, "off");
  assert.equal(high.thinkingLevel, "high");
});

test("model provider binding preserves supported request settings through Pi payload hooks", () => {
  const chat = createModelProviderBinding({
    protocol: "openai_compatible_chat_completions",
    baseUrl: "https://chat.example/v1",
    profileId: "settings-chat-profile",
    apiKey: "key",
    model: "chat-model",
    requestSettings: { temperature: 0.2, topP: 0.7 },
  }, { createChatCompletionsTransport: fauxStreams });
  const chatPayload = { model: "chat-model", stream: true };
  const chatTransformed = chat.transformProviderPayload?.({
    model: chat.selectedModel,
    payload: chatPayload,
    tools: [],
  }) as Record<string, unknown>;
  assert.deepEqual(chatTransformed, {
    model: "chat-model",
    stream: true,
    temperature: 0.2,
    top_p: 0.7,
  });
  assert.deepEqual(chatPayload, { model: "chat-model", stream: true });

  const responses = createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: "https://responses.example/v1",
    profileId: "settings-responses-profile",
    apiKey: "key",
    model: "responses-model",
    requestSettings: {
      temperature: 0.3,
      topP: 0.8,
      reasoningEffort: "high",
      reasoningSummary: "detailed",
      textVerbosity: "low",
      serviceTier: "priority",
      truncation: "auto",
      parallelToolCalls: true,
      store: true,
    },
  }, { createResponsesTransport: fauxStreams });
  const transformed = responses.transformProviderPayload?.({
    model: responses.selectedModel,
    payload: { model: "responses-model", reasoning: { effort: "high" } },
    tools: [],
  }) as Record<string, unknown>;
  assert.deepEqual(transformed, {
    model: "responses-model",
    reasoning: { effort: "high", summary: "detailed" },
    temperature: 0.3,
    top_p: 0.8,
    service_tier: "priority",
    truncation: "auto",
    parallel_tool_calls: true,
    store: true,
    text: { verbosity: "low" },
  });
});

test("model provider binding rejects invalid frozen token limits before provider registration", () => {
  assert.throws(() => createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: "https://responses.example/v1",
    profileId: "invalid-limits-profile",
    apiKey: "key",
    model: "model",
    contextWindow: 0,
}, { createResponsesTransport: fauxStreams }), /contextWindow must be a positive safe integer/);
});

test("model provider binding isolates profile identity from protocol dialect identity", async () => {
  const first = createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: "https://responses.example/v1",
    profileId: "profile-one",
    providerProfileId: "openai_compatible",
    model: "same-model",
    apiKey: "first-key",
  }, { createResponsesTransport: fauxStreams });
  const second = createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: "https://responses.example/v1",
    profileId: "profile-two",
    providerProfileId: "openai_compatible",
    model: "same-model",
    apiKey: "second-key",
  }, { createResponsesTransport: fauxStreams });

  assert.notEqual(first.selectedModel.provider, second.selectedModel.provider);
  assert.equal((await first.modelRegistry.getAuth(first.selectedModel))?.auth.apiKey, "first-key");
  assert.equal((await second.modelRegistry.getAuth(second.selectedModel))?.auth.apiKey, "second-key");
});

test("model provider binding rejects a blank profile identity", () => {
  assert.throws(() => createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: "https://responses.example/v1",
    profileId: "  ",
    model: "model",
    apiKey: "key",
  }, { createResponsesTransport: fauxStreams }), /profileId must not be blank/);
});

function fauxStreams(): ProviderStreams {
  const faux = fauxProvider();
  return {
    stream: faux.provider.stream.bind(faux.provider),
    streamSimple: faux.provider.streamSimple.bind(faux.provider),
  };
}
