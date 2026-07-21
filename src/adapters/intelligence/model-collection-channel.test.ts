import assert from "node:assert/strict";
import test from "node:test";
import {
  fauxAssistantMessage,
  fauxProvider,
  type ProviderStreams,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import type { ModelRequest } from "../../domain/intelligence/index.js";
import { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import { InMemoryMessageBus } from "../../kernel/messages/in-memory-message-bus.js";
import { createModelCollectionChannel } from "./model-collection-channel.js";
import { createModelProviderBinding } from "./model-provider-binding.js";

test("model collection channel returns validated JSON through Pi with per-request API keys", async () => {
  const faux = fauxProvider();
  faux.setResponses([
    fauxAssistantMessage('{"selectedSkillIds":["review"],"confidence":0.9}', { responseId: "response-1" }),
    fauxAssistantMessage('{"selectedSkillIds":["writer"],"confidence":0.8}', { responseId: "response-2" }),
  ]);
  const apiKeys = ["token-one", "token-two"];
  const observedApiKeys: string[] = [];
  let apiKeyIndex = 0;
  const binding = createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: "https://responses.example/v1",
    profileId: "skill-routing-responses-profile",
    model: "router-model",
    resolveApiKey: () => apiKeys[apiKeyIndex++],
  }, {
    createResponsesTransport: () => observingStreams(faux.provider, observedApiKeys),
  });
  const eventLog = new InMemoryEventLog();
  const channel = createModelCollectionChannel({
    ...binding,
    bus: new InMemoryMessageBus(eventLog),
    supportedPurposes: ["skill_routing"],
  });

  const first = await channel.request(skillRoutingRequest("request-1"));
  const second = await channel.request(skillRoutingRequest("request-2"));

  assert.equal(first.status, "completed");
  assert.deepEqual(first.structuredOutput, { selectedSkillIds: ["review"], confidence: 0.9 });
  assert.equal(second.status, "completed");
  assert.deepEqual(second.structuredOutput, { selectedSkillIds: ["writer"], confidence: 0.8 });
  assert.deepEqual(observedApiKeys, apiKeys);
  assert.deepEqual(eventLog.types(), ["model.requested", "model.completed", "model.requested", "model.completed"]);
});

test("model collection channel fails closed before Pi dispatch for unsupported requests", async () => {
  const faux = fauxProvider();
  faux.setResponses([fauxAssistantMessage("must not be called")]);
  const binding = createModelProviderBinding({
    protocol: "openai_compatible_chat_completions",
    baseUrl: "https://chat.example/v1",
    profileId: "skill-routing-chat-profile",
    apiKey: "key",
    model: "router-model",
  }, { createChatCompletionsTransport: () => providerStreams(faux.provider) });
  const channel = createModelCollectionChannel({
    ...binding,
    bus: new InMemoryMessageBus(new InMemoryEventLog()),
    supportedPurposes: ["skill_routing"],
  });

  const response = await channel.request({
    ...skillRoutingRequest("unsupported-request"),
    purpose: "deep_synthesis",
  });

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "request_validation");
  assert.match(response.failure?.message ?? "", /does not support model purpose deep_synthesis/u);
  const unsupportedBudget = await channel.request({
    ...skillRoutingRequest("unsupported-budget"),
    budget: { maxOutputTokens: 200, maxCostUsd: 0.01 },
  });
  assert.equal(unsupportedBudget.status, "failed");
  assert.match(unsupportedBudget.failure?.message ?? "", /cannot enforce input, total-token, or cost budgets/u);
  assert.equal(faux.state.callCount, 0);
});

function skillRoutingRequest(requestId: string): ModelRequest {
  return {
    requestId,
    traceId: `${requestId}-trace`,
    callerRef: "skill-router",
    purpose: "skill_routing",
    inputRefs: [],
    sanitizedMessages: [
      { role: "system", content: "Return a JSON object." },
      { role: "user", content: "Select one skill." },
    ],
    tools: [],
    toolChoice: "none",
    outputContract: {
      contractId: "skill-router.selection.v1",
      outputKind: "candidate",
      format: "json_object",
      requiredFields: ["selectedSkillIds"],
    },
    constraintRefs: [],
    budget: { maxOutputTokens: 600, maxLatencyMs: 30_000 },
    sensitivity: "internal",
    requestedAt: "2026-07-21T00:00:00.000Z",
  };
}

function observingStreams(
  provider: ReturnType<typeof fauxProvider>["provider"],
  observedApiKeys: string[],
): ProviderStreams {
  const base = providerStreams(provider);
  return {
    stream(model, context, options) {
      observeApiKey(options, observedApiKeys);
      return base.stream(model, context, options);
    },
    streamSimple(model, context, options) {
      observeApiKey(options, observedApiKeys);
      return base.streamSimple(model, context, options);
    },
  };
}

function providerStreams(provider: ReturnType<typeof fauxProvider>["provider"]): ProviderStreams {
  return {
    stream: provider.stream.bind(provider),
    streamSimple: provider.streamSimple.bind(provider),
  };
}

function observeApiKey(options: StreamOptions | undefined, observedApiKeys: string[]): void {
  observedApiKeys.push(options?.apiKey ?? "missing");
}
