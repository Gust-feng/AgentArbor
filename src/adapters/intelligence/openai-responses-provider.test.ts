import assert from "node:assert/strict";
import test from "node:test";
import type { ModelRequest } from "../../domain/intelligence/index.js";
import { OpenAIResponsesProvider } from "./openai-responses-provider.js";
import type { FetchLike } from "./openai-fetch-bridge.js";

test("OpenAI Responses adapter maps messages to input items and returns text output", async () => {
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
        id: "resp-001",
        model: "gpt-4.1",
        status: "completed",
        output: [
          {
            type: "reasoning",
            summary: [{ type: "summary_text", text: "Checked the requirement before answering." }],
          },
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: JSON.stringify({ summary: "Hello from Responses API." }) }],
          },
        ],
        usage: {
          input_tokens: 20,
          output_tokens: 10,
          total_tokens: 30,
        },
      }),
    };
  };
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com/",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    requestSettings: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 64,
      reasoningEffort: "medium",
      reasoningSummary: "auto",
      textVerbosity: "low",
      serviceTier: "default",
      truncation: "auto",
      parallelToolCalls: false,
      store: false,
    },
    fetch,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "completed");
  assert.deepEqual(response.structuredOutput, { summary: "Hello from Responses API." });
  assert.equal(response.textOutput, JSON.stringify({ summary: "Hello from Responses API." }));
  assert.deepEqual(response.reasoningOutput, {
    source: "openai_responses_reasoning_summary",
    content: "Checked the requirement before answering.",
    truncated: false,
  });
  assert.deepEqual(response.usage, {
    inputTokens: 20,
    outputTokens: 10,
    totalTokens: 30,
    latencyMs: response.usage?.latencyMs,
  });
  assert.equal(response.protocolKind, "openai_responses");
  assert.equal(response.providerKind, "openai");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.openai.com/v1/responses");
  assert.equal(calls[0]?.authorization, "Bearer sk-test-key");
  assert.deepEqual(calls[0]?.body, {
    model: "gpt-4.1",
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Build a helper." }],
      },
    ],
    temperature: 0.2,
    top_p: 0.9,
    max_output_tokens: 64,
    reasoning: {
      effort: "medium",
      summary: "auto",
    },
    text: {
      verbosity: "low",
    },
    service_tier: "default",
    truncation: "auto",
    parallel_tool_calls: false,
    store: false,
  });
});

test("OpenAI Responses adapter maps system message to instructions", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp-002",
        model: "gpt-4.1",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Done." }],
          },
        ],
      }),
    };
  };
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch,
  });

  await provider.complete(
    createValidModelRequest({
      sanitizedMessages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello." },
      ],
    })
  );

  assert.equal(calls[0]?.body.instructions, "You are a helpful assistant.");
  assert.deepEqual(calls[0]?.body.input, [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Hello." }],
    },
  ]);
});

test("OpenAI Responses adapter maps tools to function format and extracts tool calls from output", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp-003",
        model: "gpt-4.1",
        status: "completed",
        output: [
          {
            type: "function_call",
            id: "fc-001",
            call_id: "call-search",
            name: "web_search",
            arguments: JSON.stringify({ query: "AgentArbor" }),
          },
        ],
      }),
    };
  };
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
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
    })
  );

  assert.deepEqual(response.toolCalls, [
    { callId: "call-search", toolName: "web_search", input: { query: "AgentArbor" } },
  ]);
  assert.equal(response.finishReason, "tool_call");
  assert.equal(response.assistantMessage?.role, "assistant");
  assert.deepEqual(response.assistantMessage?.toolCalls, response.toolCalls);
  assert.deepEqual(calls[0]?.body.tools, [
    {
      type: "function",
      name: "web_search",
      description: "Search the web.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      strict: false,
    },
  ]);
  assert.equal(calls[0]?.body.tool_choice, "auto");
});

test("OpenAI Responses adapter gates parallel tool calls by visible tool risk", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp-parallel-tools",
        model: "gpt-4.1",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: JSON.stringify({ summary: "ok" }) }],
          },
        ],
      }),
    };
  };
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    requestSettings: {
      parallelToolCalls: true,
    },
    fetch,
  });

  await provider.complete(createValidModelRequest({
    tools: [
      {
        name: "read_file",
        description: "Read a file.",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        metadata: {
          category: "filesystem",
          riskLevel: "low",
          operationType: "read-only",
          requiresConfirmation: false,
          visibleResultPolicy: {
            userVisible: "summary-only",
            maxPreviewChars: 800,
            omitRawOutput: true,
          },
        },
      },
    ],
    toolChoice: "auto",
  }));
  await provider.complete(createValidModelRequest({
    tools: [
      {
        name: "shell_command",
        description: "Run a shell command.",
        inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
        metadata: {
          category: "terminal",
          riskLevel: "high",
          operationType: "execute",
          requiresConfirmation: true,
          visibleResultPolicy: {
            userVisible: "summary-only",
            maxPreviewChars: 800,
            omitRawOutput: true,
          },
        },
      },
    ],
    toolChoice: "auto",
  }));

  assert.equal(calls[0]?.body.parallel_tool_calls, true);
  assert.equal(calls[1]?.body.parallel_tool_calls, false);
});

test("OpenAI Responses adapter converts tool choice to named function format", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp-004",
        model: "gpt-4.1",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "ok" }],
          },
        ],
      }),
    };
  };
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch,
  });

  await provider.complete(
    createValidModelRequest({
      toolChoice: { type: "function", function: { name: "web_search" } },
    })
  );

  assert.deepEqual(calls[0]?.body.tool_choice, { type: "function", name: "web_search" });
});

test("OpenAI Responses adapter maps tool results to function_call_output format", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp-005",
        model: "gpt-4.1",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Search complete." }],
          },
        ],
      }),
    };
  };
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch,
  });

  await provider.complete(
    createValidModelRequest({
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
          content: JSON.stringify({ results: [] }),
        },
      ],
    })
  );

  const input = calls[0]?.body.input as unknown[];
  assert.deepEqual(input, [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Search first." }],
    },
    {
      type: "function_call",
      call_id: "call-old",
      name: "web_search",
      arguments: JSON.stringify({ query: "old" }),
    },
    {
      type: "function_call_output",
      call_id: "call-old",
      output: JSON.stringify({ results: [] }),
    },
  ]);
});

test("OpenAI Responses adapter handles assistant message with both text and tool calls", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp-006",
        model: "gpt-4.1",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "ok" }],
          },
        ],
      }),
    };
  };
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch,
  });

  await provider.complete(
    createValidModelRequest({
      sanitizedMessages: [
        { role: "user", content: "Do something." },
        {
          role: "assistant",
          content: "Let me look that up.",
          toolCalls: [{ callId: "call-1", toolName: "search", input: { q: "test" } }],
        },
      ],
    })
  );

  const input = calls[0]?.body.input as unknown[];
  assert.deepEqual(input, [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Do something." }],
    },
    {
      type: "function_call",
      call_id: "call-1",
      name: "search",
      arguments: JSON.stringify({ q: "test" }),
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Let me look that up." }],
    },
  ]);
});

test("OpenAI Responses adapter streams text deltas and tool call arguments", async () => {
  const deltas: Array<{ purpose: string | undefined; delta: string }> = [];
  const fetch: FetchLike = async (_url, _init) => {
    return {
      ok: true,
      status: 200,
      body: responseSseEvents([
        { type: "response.created", response: { id: "resp-stream-001", status: "in_progress" } },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "message", role: "assistant" },
        },
        { type: "response.output_text.delta", output_index: 0, delta: "{\"summary\":\"" },
        { type: "response.output_text.delta", output_index: 0, delta: "Streamed response" },
        { type: "response.output_text.delta", output_index: 0, delta: ".\"}" },
        { type: "response.output_text.done", output_index: 0 },
        { type: "response.output_item.done", output_index: 0 },
        { type: "response.completed", response: { id: "resp-stream-001", status: "completed" } },
      ]),
      json: async () => {
        throw new Error("Streaming response should not be read through json().");
      },
    };
  };
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch,
    stream: true,
    onOutputDelta: (delta) => {
      deltas.push({ purpose: delta.purpose, delta: delta.delta });
    },
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "completed");
  assert.deepEqual(response.structuredOutput, { summary: "Streamed response." });
  assert.equal(response.textOutput, "{\"summary\":\"Streamed response.\"}");
  assert.deepEqual(deltas, [
    { purpose: "rootlet_candidate", delta: "Streamed response" },
    { purpose: "rootlet_candidate", delta: "." },
  ]);
  assert.equal(JSON.stringify(deltas).includes("{\"summary\""), false);
});

test("OpenAI Responses adapter streams tool call arguments", async () => {
  const fetch: FetchLike = async (_url, _init) => {
    return {
      ok: true,
      status: 200,
      body: responseSseEvents([
        { type: "response.created", response: { id: "resp-stream-002", status: "in_progress" } },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "function_call", call_id: "call-stream-1", name: "web_search" },
        },
        { type: "response.function_call_arguments.delta", output_index: 0, delta: "{\"qu" },
        { type: "response.function_call_arguments.delta", output_index: 0, delta: "ery\":" },
        { type: "response.function_call_arguments.delta", output_index: 0, delta: "\"test\"}" },
        { type: "response.output_item.done", output_index: 0 },
        { type: "response.completed", response: { id: "resp-stream-002", status: "completed" } },
      ]),
      json: async () => {
        throw new Error("Streaming response should not be read through json().");
      },
    };
  };
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch,
    stream: true,
  });

  const response = await provider.complete(
    createValidModelRequest({
      tools: [
        {
          name: "web_search",
          description: "Search the web.",
          inputSchema: { type: "object", properties: { query: { type: "string" } } },
        },
      ],
    })
  );

  assert.deepEqual(response.toolCalls, [
    { callId: "call-stream-1", toolName: "web_search", input: { query: "test" } },
  ]);
  assert.equal(response.finishReason, "tool_call");
});

test("OpenAI Responses adapter returns provider_config failure when fetch is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  try {
    Object.defineProperty(globalThis, "fetch", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const provider = new OpenAIResponsesProvider({
      baseUrl: "https://api.openai.com",
      apiKey: "sk-test-key",
      model: "gpt-4.1",
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

test("OpenAI Responses adapter returns provider_auth failure on 401", async () => {
  const fetch: FetchLike = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: { message: "Invalid API key" } }),
  });
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-bad-key",
    model: "gpt-4.1",
    fetch,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "provider_auth");
  assert.equal(response.failure?.retryable, false);
  assert.equal(response.failure?.message, "Invalid API key");
});

test("OpenAI Responses adapter returns provider_rate_limit failure on 429", async () => {
  const fetch: FetchLike = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: { message: "Rate limit exceeded" } }),
  });
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "provider_rate_limit");
  assert.equal(response.failure?.retryable, true);
  assert.equal(response.failure?.message, "Rate limit exceeded");
});

test("OpenAI Responses adapter preserves plain text provider errors", async () => {
  const fetch: FetchLike = async () => ({
    ok: false,
    status: 404,
    text: async () => "Cannot POST /v1/responses",
    json: async () => {
      throw new Error("body is not json");
    },
  });
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.example.test",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "provider_response");
  assert.equal(response.failure?.message, "Cannot POST /v1/responses");
});

test("OpenAI Responses adapter does not expose SDK no-body wrapper as provider error", async () => {
  const fetch: FetchLike = async () => ({
    ok: false,
    status: 404,
    text: async () => "",
    json: async () => {
      throw new Error("body is empty");
    },
  });
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.example.test",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "provider_response");
  assert.equal(response.failure?.message, "HTTP 404");
});

test("OpenAI Responses adapter returns cancelled status on abort signal", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetch: FetchLike = async () => {
    throw new Error("Should not be called");
  };
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch,
  });

  const response = await provider.complete(createValidModelRequest(), { abortSignal: controller.signal });

  assert.equal(response.status, "cancelled");
  assert.equal(response.failure?.kind, "provider_network");
  assert.equal(response.failure?.retryable, false);
});

test("OpenAI Responses adapter returns provider_network failure on fetch error", async () => {
  const fetch: FetchLike = async () => {
    throw new Error("Network error");
  };
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "provider_network");
  assert.equal(response.failure?.retryable, true);
});

test("OpenAI Responses adapter stores response id in protocolExtensions", async () => {
  const fetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: "resp-extensions",
      model: "gpt-4.1",
      status: "completed",
      output: [
        {
          type: "function_call",
          call_id: "call-ext",
          name: "tool_a",
          arguments: "{}",
        },
      ],
    }),
  });
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.assistantMessage?.protocolExtensions?.response_id, "resp-extensions");
});

test("OpenAI Responses adapter handles response.incomplete status", async () => {
  const fetch: FetchLike = async (_url, _init) => ({
    ok: true,
    status: 200,
    body: responseSseEvents([
      { type: "response.created", response: { id: "resp-inc", status: "in_progress" } },
      { type: "response.incomplete", response: { id: "resp-inc", status: "incomplete" } },
    ]),
    json: async () => {
      throw new Error("Should not use json");
    },
  });
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch,
    stream: true,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.finishReason, "error");
  assert.equal(response.failure?.kind, "provider_response");
  assert.equal(response.failure?.retryable, true);
});

test("OpenAI Responses adapter handles stream failure event", async () => {
  const fetch: FetchLike = async (_url, _init) => ({
    ok: true,
    status: 200,
    body: responseSseEvents([
      { type: "response.created", response: { id: "resp-fail", status: "in_progress" } },
      { type: "response.failed", response: { id: "resp-fail", status: "failed" } },
    ]),
    json: async () => {
      throw new Error("Should not use json");
    },
  });
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch,
    stream: true,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "provider_response");
});

test("OpenAI Responses adapter uses custom providerId", async () => {
  const fetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: "resp-custom",
      model: "gpt-4.1",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "ok" }],
        },
      ],
    }),
  });
  const provider = new OpenAIResponsesProvider({
    providerId: "my-custom-provider",
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch,
  });

  assert.equal(provider.providerId, "my-custom-provider");
  assert.equal(provider.protocolKind, "openai_responses");
  assert.equal(provider.providerKind, "openai");
});

function responseSseEvents(events: readonly unknown[]): AsyncGenerator<string> {
  return (async function* () {
    for (const event of events) {
      yield `data: ${JSON.stringify(event)}\n\n`;
    }
    yield "data: [DONE]\n\n";
  })();
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
