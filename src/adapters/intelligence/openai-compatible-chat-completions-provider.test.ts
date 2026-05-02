import assert from "node:assert/strict";
import test from "node:test";
import type { ModelRequest } from "../../domain/intelligence/index.js";
import { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import { NativeIntelligenceChannel } from "../../kernel/intelligence/channel.js";
import { InMemoryMessageBus } from "../../kernel/messages/in-memory-message-bus.js";
import { OpenAICompatibleChatCompletionsProvider, type FetchLike } from "./openai-compatible-chat-completions-provider.js";

test("OpenAI-compatible Chat Completions adapter maps request and response through stubbed fetch", async () => {
  const calls: { url: string; body: unknown; authorization?: string }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({
      url,
      body: JSON.parse(init.body),
      authorization: init.headers.authorization,
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "chatcmpl-test",
        model: "gpt-compatible-test",
        choices: [
          {
            message: { role: "assistant", content: JSON.stringify({ summary: "Mapped provider response." }) },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 11,
          completion_tokens: 7,
          total_tokens: 18,
        },
      }),
    };
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test/",
    apiKey: "sk-test-secret-token",
    model: "gpt-compatible-test",
    fetch,
  });
  const eventLog = new InMemoryEventLog();
  const channel = new NativeIntelligenceChannel({ provider, bus: new InMemoryMessageBus(eventLog) });

  const response = await channel.request(createValidModelRequest());

  assert.equal(response.status, "completed");
  assert.deepEqual(response.structuredOutput, { summary: "Mapped provider response." });
  assert.deepEqual(response.usage, {
    inputTokens: 11,
    outputTokens: 7,
    totalTokens: 18,
    latencyMs: response.usage?.latencyMs,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://llm.example.test/v1/chat/completions");
  assert.equal(calls[0]?.authorization, "Bearer sk-test-secret-token");
  assert.deepEqual(calls[0]?.body, {
    model: "gpt-compatible-test",
    messages: [{ role: "user", content: "Build a helper." }],
    response_format: { type: "json_object" },
  });
  assert.deepEqual(eventLog.types(), ["model.requested", "model.completed"]);
  assert.equal(JSON.stringify(eventLog.list()).includes("sk-test-secret-token"), false);
  assert.equal(JSON.stringify(eventLog.list()).includes("token"), false);
});

test("OpenAI-compatible adapter returns provider_config failure when fetch is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  try {
    Object.defineProperty(globalThis, "fetch", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const provider = new OpenAICompatibleChatCompletionsProvider({
      baseUrl: "https://llm.example.test",
      apiKey: "sk-test-secret-token",
      model: "gpt-compatible-test",
    });

    const response = await provider.complete(createValidModelRequest());

    assert.equal(response.status, "failed");
    assert.equal(response.failure?.kind, "provider_config");
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      value: originalFetch,
      configurable: true,
      writable: true,
    });
  }
});

function createValidModelRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    requestId: "model-request-test",
    traceId: "trace-test",
    callerRef: { kind: "goal", id: "goal-test" },
    purpose: "rootlet_candidate",
    inputRefs: [{ kind: "goal", id: "goal-test" }],
    sanitizedMessages: [{ role: "user", content: "Build a helper.", ref: "goal-test" }],
    outputContract: {
      contractId: "test.candidate.v1",
      outputKind: "candidate",
      format: "json_object",
      requiredFields: ["summary"],
      requiredStringFields: ["summary"],
    },
    constraintRefs: [],
    budget: { maxOutputTokens: 128 },
    sensitivity: "internal",
    requestedAt: "2026-05-02T00:00:00.000Z",
    ...overrides,
  };
}
