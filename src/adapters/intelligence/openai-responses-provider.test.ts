import assert from "node:assert/strict";
import test from "node:test";
import type { ModelRequest } from "../../domain/intelligence/index.js";
import { OpenAIResponsesProvider } from "./openai-responses-provider.js";
import type { FetchLike } from "./openai-fetch-bridge.js";
import { OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION } from "./openai-responses-continuation.js";

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
  assert.equal(response.providerKind, "openai_compatible");
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

test("OpenAI Responses adapter maps user image and file attachments to input content parts", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp-image-test",
        model: "gpt-4.1",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: JSON.stringify({ summary: "Image received." }) }],
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

  await provider.complete(createValidModelRequest({
    sanitizedMessages: [{
      role: "user",
      content: "Describe this screenshot.",
      attachments: [{
        kind: "image",
        source: { kind: "data", mimeType: "image/png", data: "aW1hZ2U=" },
        filename: "screenshot.png",
        detail: "auto",
      }, {
        kind: "file",
        source: { kind: "data", mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
        filename: "report.pdf",
        detail: "high",
      }],
    }],
  }));

  assert.deepEqual(calls[0]?.body.input, [{
    type: "message",
    role: "user",
    content: [
      { type: "input_text", text: "Describe this screenshot." },
      { type: "input_image", detail: "auto", image_url: "data:image/png;base64,aW1hZ2U=" },
      {
        type: "input_file",
        detail: "high",
        file_data: "data:application/pdf;base64,JVBERi0xLjQ=",
        filename: "report.pdf",
      },
    ],
  }]);
});

test("OpenAI Responses rejects per-file and request-wide file limits before transport", async () => {
  let fetchCalls = 0;
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("fetch should not run");
    },
  });
  const fiftyMb = 50_000_000;
  const thirtyMb = 30_000_000;

  const oversized = await provider.complete(createValidModelRequest({
    sanitizedMessages: [{
      role: "user",
      content: "Inspect this file.",
      attachments: [{
        kind: "file",
        source: { kind: "file_id", fileId: "file-oversized" },
        filename: "oversized.pdf",
        byteLength: fiftyMb,
      }],
    }],
  }));
  const aggregate = await provider.complete(createValidModelRequest({
    sanitizedMessages: [
      {
        role: "user",
        content: "Compare both files.",
        attachments: [{
          kind: "file",
          source: { kind: "file_id", fileId: "file-user" },
          filename: "user.pdf",
          byteLength: thirtyMb,
        }],
      },
      {
        role: "tool",
        toolCallId: "call-file",
        toolName: "mcp__read_file",
        content: "Tool file output.",
        attachments: [{
          kind: "file",
          source: { kind: "file_id", fileId: "file-tool" },
          filename: "tool.pdf",
          byteLength: thirtyMb,
        }],
      },
    ],
  }));

  assert.equal(fetchCalls, 0);
  assert.equal(oversized.status, "failed");
  assert.equal(oversized.failure?.kind, "request_validation");
  assert.match(oversized.failure?.message ?? "", /each file input to be smaller/);
  assert.equal(aggregate.status, "failed");
  assert.equal(aggregate.failure?.kind, "request_validation");
  assert.match(aggregate.failure?.message ?? "", /per-request limit/);
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

test("OpenAI Responses adapter preserves sanitized transport failure", async () => {
  const secret = "sk-responses-network-secret-123456";
  const fetch: FetchLike = async () => {
    throw new Error(`fetch failed ECONNRESET apiKey=${secret}`);
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
  assert.equal(response.failure?.message.includes("fetch failed ECONNRESET"), true);
  assert.equal(response.failure?.message.includes(secret), true);
  assert.equal(response.failure?.message.includes("[redacted-secret]"), false);
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
  const serializedInput = JSON.stringify(calls[0]?.body.input);
  const serializedInstructions = JSON.stringify(calls[0]?.body.instructions ?? "");
  assert.equal(serializedInput.includes("Search the web."), false);
  assert.equal(serializedInput.includes("parameters"), false);
  assert.equal(serializedInput.includes("Allowed tools"), false);
  assert.equal(serializedInstructions.includes("Search the web."), false);
  assert.equal(serializedInstructions.includes("parameters"), false);
  assert.equal(serializedInstructions.includes("Allowed tools"), false);
});

test("OpenAI Responses adapter can include provider-native web search", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp-web-search",
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
    enableWebSearch: true,
    fetch,
  });

  await provider.complete(createValidModelRequest({
    tools: [
      {
        name: "read_file",
        description: "Read a file.",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
    ],
  }));

  assert.deepEqual(calls[0]?.body.tools, [
    {
      type: "web_search",
      search_context_size: "medium",
    },
    {
      type: "function",
      name: "read_file",
      description: "Read a file.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      strict: false,
    },
  ]);
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

test("OpenAI Responses adapter replays native output items and tool attachments", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp-continuation-next",
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
  const previousOutput = [
    {
      id: "rs_1",
      type: "reasoning",
      summary: [{ type: "summary_text", text: "Need search result." }],
    },
    {
      id: "fc_1",
      type: "function_call",
      call_id: "call-old",
      name: "web_search",
      arguments: JSON.stringify({ query: "old" }),
    },
  ];
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
          protocolExtensions: {
            response_id: "resp-continuation-prev",
            [OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION]: previousOutput,
          },
          toolCalls: [{ callId: "call-old", toolName: "web_search", input: { query: "old" } }],
        },
        {
          role: "tool",
          toolCallId: "call-old",
          toolName: "web_search",
          content: JSON.stringify({ results: [] }),
          attachments: [{
            kind: "image",
            attachmentId: "ctx-image",
            filename: "screenshot.png",
            detail: "low",
            source: { kind: "data", mimeType: "image/png", data: "iVBORw0KGgo=" },
          }, {
            kind: "file",
            inputRef: "memory://report.pdf",
            filename: "report.pdf",
            detail: "high",
            source: { kind: "data", mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
          }],
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
    ...previousOutput,
    {
      type: "function_call_output",
      call_id: "call-old",
      output: [
        { type: "input_text", text: JSON.stringify({ results: [] }) },
        {
          type: "input_image",
          detail: "low",
          image_url: "data:image/png;base64,iVBORw0KGgo=",
        },
        {
          type: "input_file",
          detail: "high",
          file_data: "data:application/pdf;base64,JVBERi0xLjQ=",
          filename: "report.pdf",
        },
      ],
    },
  ]);
});

test("OpenAI Responses rejects audio attachments before transport", async () => {
  let fetchCalls = 0;
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("fetch should not run");
    },
  });

  const response = await provider.complete(createValidModelRequest({
    sanitizedMessages: [{
      role: "user",
      content: "Inspect this audio.",
      attachments: [{
        kind: "audio",
        filename: "clip.wav",
        source: { kind: "data", mimeType: "audio/wav", data: "UklGRg==" },
      }],
    }],
  }));

  assert.equal(fetchCalls, 0);
  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "request_validation");
  assert.match(response.failure?.message ?? "", /does not currently accept audio input attachments/);
  assert.match(response.failure?.message ?? "", /user-origin audio can use an audio-capable Chat Completions model/);
});

test("OpenAI Responses rejects tool-origin audio without redirecting it to Chat", async () => {
  let fetchCalls = 0;
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("fetch should not run");
    },
  });

  const response = await provider.complete(createValidModelRequest({
    sanitizedMessages: [{
      role: "assistant",
      content: "",
      toolCalls: [{ callId: "call-audio", toolName: "mcp__listen", input: {} }],
    }, {
      role: "tool",
      toolCallId: "call-audio",
      toolName: "mcp__listen",
      content: JSON.stringify({ mimeType: "audio/wav" }),
      attachments: [{
        kind: "audio",
        inputRef: "mcp-content:audio:0",
        filename: "clip.wav",
        source: { kind: "data", mimeType: "audio/wav", data: "UklGRg==" },
      }],
    }],
  }));

  assert.equal(fetchCalls, 0);
  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "request_validation");
  assert.match(response.failure?.message ?? "", /does not currently accept tool-origin audio attachments/);
  assert.match(response.failure?.message ?? "", /cannot preserve their tool-result role/);
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
        {
          type: "response.output_item.done",
          output_index: 0,
          item: {
            type: "function_call",
            call_id: "call-stream-1",
            name: "web_search",
            arguments: "{\"query\":\"test\"}",
          },
        },
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
  assert.deepEqual(response.assistantMessage?.protocolExtensions?.[OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION], [
    {
      type: "function_call",
      call_id: "call-stream-1",
      name: "web_search",
      arguments: "{\"query\":\"test\"}",
    },
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

test("OpenAI Responses adapter classifies 408 response as provider_timeout", async () => {
  const fetch: FetchLike = async () => ({
    ok: false,
    status: 408,
    json: async () => ({ error: { message: "Request Timeout" } }),
  });
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "provider_timeout");
  assert.equal(response.failure?.retryable, true);
  assert.equal(response.failure?.message, "Request Timeout");
});

test("OpenAI Responses adapter classifies 504 response as provider_timeout", async () => {
  const fetch: FetchLike = async () => ({
    ok: false,
    status: 504,
    json: async () => ({ error: { message: "Gateway Timeout" } }),
  });
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "provider_timeout");
  assert.equal(response.failure?.retryable, true);
  assert.equal(response.failure?.message, "Gateway Timeout");
});

test("OpenAI Responses adapter notifies context window overflow", async () => {
  const events: Array<{ readonly message: string; readonly status?: number }> = [];
  const fetch: FetchLike = async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      error: {
        code: "context_length_exceeded",
        message: "Input is too long. Tokens exceed the model context window.",
      },
    }),
  });
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch,
    onContextWindowExceeded: (event) => {
      events.push(event);
    },
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "provider_response");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.status, 400);
  assert.equal(events[0]?.message.includes("Input is too long"), true);
});

test("OpenAI Responses adapter normalizes timeout-like transport error as provider_timeout", async () => {
  const fetch: FetchLike = async () => {
    throw new Error("The user aborted a request, Request timed out.");
  };
  const provider = new OpenAIResponsesProvider({
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "provider_timeout");
  assert.equal(response.failure?.retryable, true);
  assert.equal(response.failure?.message.includes("timed out"), true);
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

test("OpenAI Responses adapter stores response id and output items in protocolExtensions", async () => {
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
  assert.deepEqual(response.assistantMessage?.protocolExtensions?.[OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION], [
    {
      type: "function_call",
      call_id: "call-ext",
      name: "tool_a",
      arguments: "{}",
    },
  ]);
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

test("OpenAI Responses adapter preserves official stream error details", async () => {
  const fetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    body: responseSseEvents([
      { type: "response.created", response: { id: "resp-error", model: "gpt-4.1" } },
      {
        type: "error",
        code: "server_error",
        message: "The response stream stopped unexpectedly.",
        param: null,
      },
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
  assert.equal(response.failure?.message.includes("The response stream stopped unexpectedly."), true);
});

test("OpenAI Responses adapter preserves cancellation during stream iteration", async () => {
  const controller = new AbortController();
  const fetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    body: (async function* () {
      controller.abort();
      throw new Error("stream aborted");
    })(),
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

  const response = await provider.complete(createValidModelRequest(), { abortSignal: controller.signal });

  assert.equal(response.status, "cancelled");
  assert.equal(response.failure?.retryable, false);
});

test("OpenAI Responses adapter preserves non-stream refusal text", async () => {
  const fetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: "resp-refusal",
      model: "gpt-4.1",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "refusal", refusal: "I cannot complete that request." }],
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

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.retryable, false);
  assert.equal(response.failure?.message.includes("I cannot complete that request."), true);
});

test("OpenAI Responses adapter preserves streamed refusal text", async () => {
  const fetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    body: responseSseEvents([
      { type: "response.created", response: { id: "resp-stream-refusal", model: "gpt-4.1" } },
      { type: "response.refusal.delta", output_index: 0, content_index: 0, delta: "I cannot " },
      { type: "response.refusal.delta", output_index: 0, content_index: 0, delta: "complete that request." },
      { type: "response.refusal.done", output_index: 0, content_index: 0, refusal: "I cannot complete that request." },
      { type: "response.completed", response: { id: "resp-stream-refusal", status: "completed" } },
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
  assert.equal(response.failure?.retryable, false);
  assert.equal(response.failure?.message.includes("I cannot complete that request."), true);
});

test("OpenAI Responses adapter fails a stream that ends without a terminal response event", async () => {
  const fetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    body: responseSseEvents([
      { type: "response.created", response: { id: "resp-no-terminal", model: "gpt-4.1" } },
      { type: "response.output_text.delta", output_index: 0, delta: "partial" },
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

  const response = await provider.complete(createValidModelRequest({
    outputContract: {
      contractId: "test.text.v1",
      outputKind: "explanation",
      format: "text",
    },
  }));

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.retryable, true);
  assert.equal(response.failure?.message.includes("terminal response event"), true);
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
  assert.equal(provider.providerKind, "openai_compatible");
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
