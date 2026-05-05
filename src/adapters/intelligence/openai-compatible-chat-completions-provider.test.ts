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

test("OpenAI-compatible Chat Completions adapter streams safe output deltas", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const deltas: string[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      body: sseChunks([
        {
          model: "gpt-compatible-test",
          choices: [{ delta: { content: "{\"summary\":\"" }, finish_reason: null }],
        },
        {
          model: "gpt-compatible-test",
          choices: [{ delta: { content: "Streamed provider response." }, finish_reason: null }],
        },
        {
          model: "gpt-compatible-test",
          choices: [{ delta: { content: "\"}" }, finish_reason: "stop" }],
        },
      ]),
      json: async () => {
        throw new Error("Streaming response should not be read through json().");
      },
    };
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test",
    apiKey: "sk-test-secret-token",
    model: "gpt-compatible-test",
    fetch,
    stream: true,
    onOutputDelta: (delta) => {
      deltas.push(delta.delta);
    },
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "completed");
  assert.deepEqual(response.structuredOutput, { summary: "Streamed provider response." });
  assert.equal(response.textOutput, "{\"summary\":\"Streamed provider response.\"}");
  assert.equal(response.finishReason, "stop");
  assert.deepEqual(deltas, ["{\"summary\":\"", "Streamed provider response.", "\"}"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.body.stream, true);
  assert.equal(JSON.stringify(deltas).includes("sk-test-secret-token"), false);
});

test("OpenAI-compatible adapter maps tools, tool results, and provider tool calls", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "chatcmpl-tool-test",
        model: "gpt-compatible-test",
        choices: [
          {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call-search",
                  type: "function",
                  function: {
                    name: "web_search",
                    arguments: JSON.stringify({ query: "AgentArbor tools" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    };
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test",
    apiKey: "sk-test-secret-token",
    model: "gpt-compatible-test",
    fetch,
  });

  const response = await provider.complete(
    createValidModelRequest({
      tools: [
        {
          name: "web_search",
          description: "Search the web.",
          inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        },
      ],
      toolChoice: "auto",
      sanitizedMessages: [
        { role: "user", content: "Search first." },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ callId: "call-old", toolName: "web_search", input: { query: "old" } }],
        },
        {
          role: "tool",
          toolCallId: "call-old",
          toolName: "web_search",
          content: JSON.stringify({ status: "completed", output: { results: [] } }),
        },
      ],
    })
  );

  assert.deepEqual(response.toolCalls, [
    { callId: "call-search", toolName: "web_search", input: { query: "AgentArbor tools" } },
  ]);
  assert.equal(response.finishReason, "tool_call");
  assert.deepEqual(calls[0]?.body.tools, [
    {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web.",
        parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
    },
  ]);
  assert.equal(calls[0]?.body.tool_choice, "auto");
  assert.deepEqual(calls[0]?.body.messages, [
    { role: "user", content: "Search first." },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call-old",
          type: "function",
          function: { name: "web_search", arguments: JSON.stringify({ query: "old" }) },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call-old",
      name: "web_search",
      content: JSON.stringify({ status: "completed", output: { results: [] } }),
    },
  ]);
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

async function* sseChunks(chunks: readonly unknown[]): AsyncGenerator<string> {
  for (const chunk of chunks) {
    yield `data: ${JSON.stringify(chunk)}\n\n`;
  }
  yield "data: [DONE]\n\n";
}

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
