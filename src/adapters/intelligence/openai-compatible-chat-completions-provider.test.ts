import assert from "node:assert/strict";
import test from "node:test";
import type { ModelRequest } from "../../domain/intelligence/index.js";
import type { ToolInputSchema } from "../../domain/tools/index.js";
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
    requestSettings: {
      temperature: 0.3,
      topP: 0.85,
      maxOutputTokens: 64,
      reasoningEffort: "low",
      serviceTier: "default",
      parallelToolCalls: true,
      store: false,
    },
    fetch,
  });
  const eventLog = new InMemoryEventLog();
  const channel = new NativeIntelligenceChannel({ provider, bus: new InMemoryMessageBus(eventLog) });

  const response = await channel.request(createValidModelRequest());

  assert.equal(response.status, "completed");
  assert.deepEqual(response.structuredOutput, { summary: "Mapped provider response." });
  assert.deepEqual(response.usage, {
    requestCount: 1,
    inputTokens: 11,
    outputTokens: 7,
    totalTokens: 18,
    latencyMs: response.usage?.latencyMs,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://llm.example.test/chat/completions");
  assert.equal(calls[0]?.authorization, "Bearer sk-test-secret-token");
  assert.deepEqual(calls[0]?.body, {
    model: "gpt-compatible-test",
    messages: [{ role: "user", content: "Build a helper." }],
    response_format: { type: "json_object" },
    temperature: 0.3,
    top_p: 0.85,
    max_completion_tokens: 64,
  });
  assert.deepEqual(eventLog.types(), ["model.requested", "model.completed"]);
  assert.equal(JSON.stringify(eventLog.list()).includes("sk-test-secret-token"), false);
  assert.equal(JSON.stringify(eventLog.list()).includes("token"), false);
});

test("official OpenAI Chat requests include a stable prompt cache key", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "chatcmpl-cache-key",
        model: "gpt-4.1",
        choices: [{ message: { role: "assistant", content: "Done." }, finish_reason: "stop" }],
      }),
    };
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
    fetch,
  });
  const request = createValidModelRequest({
    sanitizedMessages: [
      { role: "system", content: "Stable root.", ref: "context:system:desktop-agent" },
      { role: "user", content: "First request." },
    ],
  });

  await provider.complete(request);
  await provider.complete({
    ...request,
    requestId: "model-request-cache-key-2",
    sanitizedMessages: [...request.sanitizedMessages, { role: "assistant", content: "First answer." }, { role: "user", content: "Continue." }],
  });

  assert.equal(typeof calls[0]?.body.prompt_cache_key, "string");
  assert.equal(calls[0]?.body.prompt_cache_key, calls[1]?.body.prompt_cache_key);
});

test("OpenAI-compatible Chat Completions adapter maps user image and file attachments to provider content parts", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "chatcmpl-image-test",
        model: "gpt-compatible-test",
        choices: [
          {
            message: { role: "assistant", content: JSON.stringify({ summary: "Image received." }) },
            finish_reason: "stop",
          },
        ],
      }),
    };
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test/",
    apiKey: "sk-test-secret-token",
    model: "gpt-compatible-test",
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
      }],
    }],
  }));

  assert.deepEqual(calls[0]?.body.messages, [{
    role: "user",
    content: [
      { type: "text", text: "Describe this screenshot." },
      { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=", detail: "auto" } },
      { type: "file", file: { file_data: "data:application/pdf;base64,JVBERi0xLjQ=", filename: "report.pdf" } },
    ],
  }]);
});

test("OpenAI-compatible Chat Completions rejects URL-backed user file attachments before transport", async () => {
  let fetchCalls = 0;
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test/",
    apiKey: "sk-test-secret-token",
    model: "gpt-compatible-test",
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("fetch should not run");
    },
  });

  const response = await provider.complete(createValidModelRequest({
    sanitizedMessages: [{
      role: "user",
      content: "Inspect this report.",
      attachments: [{
        kind: "file",
        filename: "report.pdf",
        source: { kind: "url", url: "https://files.example.test/report.pdf" },
      }],
    }],
  }));

  assert.equal(fetchCalls, 0);
  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "request_validation");
  assert.match(response.failure?.message ?? "", /does not support URL-backed file attachments/);
});

test("OpenAI-compatible Chat Completions maps user wav and mp3 attachments to input_audio", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "chatcmpl-audio-test",
        model: "gpt-compatible-test",
        choices: [{
          message: { role: "assistant", content: "Audio received." },
          finish_reason: "stop",
        }],
      }),
    };
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test/",
    apiKey: "sk-test-secret-token",
    model: "gpt-compatible-test",
    fetch,
  });

  await provider.complete(createValidModelRequest({
    sanitizedMessages: [{
      role: "user",
      content: "Compare these clips.",
      attachments: [{
        kind: "audio",
        filename: "first.wav",
        source: { kind: "data", mimeType: "audio/wav", data: "UklGRg==" },
      }, {
        kind: "audio",
        filename: "second.mp3",
        source: { kind: "data", mimeType: "audio/mpeg", data: "SUQz" },
      }],
    }],
  }));

  assert.deepEqual(calls[0]?.body.messages, [{
    role: "user",
    content: [
      { type: "text", text: "Compare these clips." },
      { type: "input_audio", input_audio: { data: "UklGRg==", format: "wav" } },
      { type: "input_audio", input_audio: { data: "SUQz", format: "mp3" } },
    ],
  }]);
});

test("OpenAI-compatible Chat Completions adapter maps MiniMax image auto detail to default", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "chatcmpl-minimax-image-test",
        model: "MiniMax-M3",
        choices: [
          {
            message: { role: "assistant", content: JSON.stringify({ summary: "Image received." }) },
            finish_reason: "stop",
          },
        ],
      }),
    };
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://api.minimaxi.com/v1",
    apiKey: "sk-test-secret-token",
    model: "MiniMax-M3",
    providerProfileId: "minimax",
    fetch,
  });

  await provider.complete(createValidModelRequest({
    sanitizedMessages: [{
      role: "user",
      content: "Describe this image.",
      attachments: [{
        kind: "image",
        source: { kind: "data", mimeType: "image/png", data: "aW1hZ2U=" },
        filename: "image.png",
        detail: "auto",
      }],
    }],
  }));

  assert.deepEqual(calls[0]?.body.messages, [{
    role: "user",
    content: [
      { type: "text", text: "Describe this image." },
      { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=", detail: "default" } },
    ],
  }]);
});

test("OpenAI-compatible Chat Completions rejects mixed tool-origin media when audio has no role-preserving transport", async () => {
  let fetchCalls = 0;
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test/",
    apiKey: "sk-test-secret-token",
    model: "gpt-compatible-test",
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("fetch should not run");
    },
  });

  const response = await provider.complete(createValidModelRequest({
    sanitizedMessages: [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { callId: "call-file", toolName: "mcp__read", input: {} },
          { callId: "call-status", toolName: "mcp__status", input: {} },
        ],
      },
      {
        role: "tool",
        toolCallId: "call-file",
        toolName: "mcp__read",
        content: JSON.stringify({ content: [{ type: "resource", uri: "memory://report.pdf" }] }),
        attachments: [{
          kind: "image",
          inputRef: "mcp-content:image:0",
          filename: "preview.png",
          source: { kind: "data", mimeType: "image/png", data: "aW1hZ2U=" },
        }, {
          kind: "file",
          inputRef: "memory://report.pdf",
          filename: "report.pdf",
          source: { kind: "data", mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
        }, {
          kind: "audio",
          inputRef: "mcp-content:audio:0",
          filename: "clip.wav",
          source: { kind: "data", mimeType: "audio/wav", data: "UklGRg==" },
        }],
      },
      {
        role: "tool",
        toolCallId: "call-status",
        toolName: "mcp__status",
        content: JSON.stringify({ status: "ready" }),
      },
    ],
  }));

  assert.equal(fetchCalls, 0);
  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "request_validation");
  assert.match(response.failure?.message ?? "", /tool-origin audio/);
  assert.match(response.failure?.message ?? "", /Responses adapter supports tool-origin image and file attachments, but not audio/);
});

test("OpenAI-compatible Chat Completions does not recommend Responses for tool-origin audio", async () => {
  let fetchCalls = 0;
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test/",
    apiKey: "sk-test-secret-token",
    model: "gpt-compatible-test",
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("fetch should not run");
    },
  });

  const response = await provider.complete(createValidModelRequest({
    sanitizedMessages: [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ callId: "call-audio", toolName: "mcp__listen", input: {} }],
      },
      {
        role: "tool",
        toolCallId: "call-audio",
        toolName: "mcp__listen",
        content: JSON.stringify({ content: [{ type: "audio", mimeType: "audio/wav" }] }),
        attachments: [{
          kind: "audio",
          inputRef: "mcp-content:audio:0",
          filename: "clip.wav",
          source: { kind: "data", mimeType: "audio/wav", data: "UklGRg==" },
        }],
      },
    ],
  }));

  assert.equal(fetchCalls, 0);
  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "request_validation");
  assert.match(response.failure?.message ?? "", /no OpenAI role-preserving transport for tool-origin audio/);
  assert.doesNotMatch(response.failure?.message ?? "", /use the Responses protocol/);
});

test("OpenAI-compatible Chat Completions rejects URL-backed tool attachments without role promotion", async () => {
  let fetchCalls = 0;
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test/",
    apiKey: "sk-test-secret-token",
    model: "gpt-compatible-test",
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("fetch should not run");
    },
  });

  const response = await provider.complete(createValidModelRequest({
    sanitizedMessages: [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ callId: "call-file-url", toolName: "mcp__read", input: {} }],
      },
      {
        role: "tool",
        toolCallId: "call-file-url",
        toolName: "mcp__read",
        content: JSON.stringify({ resource: "https://files.example.test/report.pdf" }),
        attachments: [{
          kind: "file",
          inputRef: "https://files.example.test/report.pdf",
          filename: "report.pdf",
          source: { kind: "url", url: "https://files.example.test/report.pdf" },
        }],
      },
    ],
  }));

  assert.equal(fetchCalls, 0);
  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "request_validation");
  assert.match(response.failure?.message ?? "", /use the Responses protocol/);
});

test("OpenAI-compatible Chat Completions rejects unsupported audio formats before transport", async () => {
  let fetchCalls = 0;
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test/",
    apiKey: "sk-test-secret-token",
    model: "gpt-compatible-test",
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
        filename: "clip.ogg",
        source: { kind: "data", mimeType: "audio/ogg", data: "T2dnUw==" },
      }],
    }],
  }));

  assert.equal(fetchCalls, 0);
  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "request_validation");
  assert.match(response.failure?.message ?? "", /only accepts wav or mp3 audio input/);
});

test("OpenAI-compatible Chat Completions adapter appends /v1 only for bare OpenAI base URL", async () => {
  const calls: { url: string }[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push({ url });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "chatcmpl-openai-base",
        model: "gpt-test",
        choices: [
          {
            message: { role: "assistant", content: JSON.stringify({ summary: "OpenAI base URL normalized." }) },
            finish_reason: "stop",
          },
        ],
      }),
    };
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://api.openai.com/",
    apiKey: "sk-test-secret-token",
    model: "gpt-test",
    fetch,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "completed");
  assert.equal(calls[0]?.url, "https://api.openai.com/v1/chat/completions");
});

test("OpenAI-compatible Chat adapter preserves transport failure detail", async () => {
  const secret = "sk-adapter-network-secret-123456";
  const fetch: FetchLike = async () => {
    throw new Error(`fetch failed ECONNRESET apiKey=${secret}`);
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test",
    apiKey: "sk-test-secret-token",
    model: "gpt-compatible-test",
    fetch,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "provider_network");
  assert.equal(response.failure?.retryable, true);
  assert.equal(response.failure?.message.includes("fetch failed ECONNRESET"), true);
  assert.equal(response.failure?.message.includes(secret), true);
});

test("OpenAI-compatible Chat adapter classifies 408 response as provider_timeout", async () => {
  const fetch: FetchLike = async () => ({
    ok: false,
    status: 408,
    json: async () => ({ error: { message: "Request Timeout" } }),
  });
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test",
    apiKey: "sk-test-secret-token",
    model: "gpt-compatible-test",
    fetch,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "provider_timeout");
  assert.equal(response.failure?.retryable, true);
  assert.equal(response.failure?.message, "Request Timeout");
});

test("OpenAI-compatible Chat adapter classifies 504 response as provider_timeout", async () => {
  const fetch: FetchLike = async () => ({
    ok: false,
    status: 504,
    json: async () => ({ error: { message: "Gateway Timeout" } }),
  });
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test",
    apiKey: "sk-test-secret-token",
    model: "gpt-compatible-test",
    fetch,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "provider_timeout");
  assert.equal(response.failure?.retryable, true);
  assert.equal(response.failure?.message, "Gateway Timeout");
});

test("OpenAI-compatible Chat adapter notifies context window overflow", async () => {
  const events: Array<{ readonly message: string; readonly status?: number }> = [];
  const fetch: FetchLike = async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      error: {
        code: "context_length_exceeded",
        message: "This model's maximum context length is 128000 tokens. Your messages resulted in 180000 tokens.",
      },
    }),
  });
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test",
    apiKey: "sk-test-secret-token",
    model: "gpt-compatible-test",
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
  assert.equal(events[0]?.message.includes("maximum context length"), true);
});

test("OpenAI-compatible Chat adapter normalizes timeout-like transport error as provider_timeout", async () => {
  const fetch: FetchLike = async () => {
    throw new Error("Request timed out after 30000ms");
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test",
    apiKey: "sk-test-secret-token",
    model: "gpt-compatible-test",
    fetch,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "provider_timeout");
  assert.equal(response.failure?.retryable, true);
  assert.equal(response.failure?.message.includes("timed out"), true);
});

test("OpenAI-compatible Chat Completions adapter streams safe output deltas", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const deltas: Array<{ purpose: string | undefined; delta: string }> = [];
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
      deltas.push({ purpose: delta.purpose, delta: delta.delta });
    },
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "completed");
  assert.deepEqual(response.structuredOutput, { summary: "Streamed provider response." });
  assert.equal(response.textOutput, "{\"summary\":\"Streamed provider response.\"}");
  assert.equal(response.finishReason, "stop");
  assert.deepEqual(deltas, [
    { purpose: "rootlet_candidate", delta: "Streamed provider response." },
  ]);
  assert.equal(JSON.stringify(deltas).includes("{\"summary\""), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.body.stream, true);
  assert.equal(calls[0]?.body.stream_options, undefined);
  assert.equal(JSON.stringify(deltas).includes("sk-test-secret-token"), false);
});

test("OpenAI-compatible Chat adapter requests and reads DeepSeek stream usage", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      body: sseChunks([
        {
          model: "deepseek-v4-flash",
          choices: [{ delta: { content: "完成。" }, finish_reason: null }],
        },
        {
          model: "deepseek-v4-flash",
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 7200,
            prompt_cache_hit_tokens: 2700,
            prompt_cache_miss_tokens: 4500,
            completion_tokens: 1200,
            total_tokens: 8400,
          },
        },
      ]),
      json: async () => {
        throw new Error("Streaming response should not be read through json().");
      },
    };
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://api.deepseek.com",
    apiKey: "sk-test-secret-token",
    model: "deepseek-v4-flash",
    providerProfileId: "deepseek",
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

  assert.equal(response.status, "completed");
  assert.equal(response.textOutput, "完成。");
  assert.deepEqual(calls[0]?.body.stream_options, { include_usage: true });
  assert.equal(response.usage?.inputTokens, 7200);
  assert.equal(response.usage?.cachedInputTokens, 2700);
  assert.equal(response.usage?.uncachedInputTokens, 4500);
  assert.equal(response.usage?.outputTokens, 1200);
  assert.equal(response.usage?.totalTokens, 8400);
  assert.equal(typeof response.usage?.latencyMs, "number");
});

test("OpenAI-compatible Chat adapter normalizes cumulative content snapshots from incremental profiles", async () => {
  const deltas: Array<{ kind: string | undefined; delta: string }> = [];
  const snapshots = [
    "## 能力演示总结\n\n刚才",
    "## 能力演示总结\n\n刚才我实时展示",
    "## 能力演示总结\n\n刚才我实时展示了以下能力。",
  ];
  const fetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    body: sseChunks(snapshots.map((content, index) => ({
      model: "snapshot-stream-model",
      choices: [{ delta: { content }, finish_reason: index === snapshots.length - 1 ? "stop" : null }],
    }))),
    json: async () => {
      throw new Error("Streaming response should not be read through json().");
    },
  });
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test",
    apiKey: "sk-test-secret-token",
    model: "snapshot-stream-model",
    fetch,
    stream: true,
    onOutputDelta: (delta) => {
      deltas.push({ kind: delta.kind, delta: delta.delta });
    },
  });

  const response = await provider.complete(createValidModelRequest({
    outputContract: {
      contractId: "test.text.v1",
      outputKind: "explanation",
      format: "text",
    },
  }));

  assert.equal(response.status, "completed");
  assert.equal(response.textOutput, snapshots.at(-1));
  assert.equal(deltas.map((delta) => delta.delta).join(""), snapshots.at(-1));
  assert.equal(deltas.map((delta) => delta.delta).join("").split("## 能力演示总结").length - 1, 1);
});

test("OpenAI-compatible Chat adapter retries without streaming when stream parsing fails", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ body });
    if (body.stream === true) {
      return {
        ok: true,
        status: 200,
        body: (async function* () {
          yield `data: ${JSON.stringify({
            model: "fallback-model",
            choices: [{ delta: { content: "partial" }, finish_reason: null }],
          })}\n\n`;
          throw new Error("stream parser stopped before completion");
        })(),
        json: async () => {
          throw new Error("Streaming response should not be read through json().");
        },
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "chatcmpl-fallback",
        model: "fallback-model",
        choices: [
          {
            message: { role: "assistant", content: JSON.stringify({ summary: "Fallback completed." }) },
            finish_reason: "stop",
          },
        ],
      }),
    };
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test",
    apiKey: "sk-test-secret-token",
    model: "fallback-model",
    fetch,
    stream: true,
    forceStreaming: true,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "completed");
  assert.deepEqual(response.structuredOutput, { summary: "Fallback completed." });
  assert.deepEqual(calls.map((call) => call.body.stream), [true, undefined]);
});

test("OpenAI-compatible Chat adapter does not retry after publishing a stream delta", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const deltas: string[] = [];
  const fetch: FetchLike = async (_url, init) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ body });
    if (body.stream !== true) {
      throw new Error("Non-stream fallback must not run after visible output.");
    }
    return {
      ok: true,
      status: 200,
      body: (async function* () {
        yield `data: ${JSON.stringify({
          model: "visible-stream-model",
          choices: [{ delta: { content: "partial" }, finish_reason: null }],
        })}\n\n`;
        throw new Error("stream parser stopped after visible output");
      })(),
      json: async () => {
        throw new Error("Streaming response should not be read through json().");
      },
    };
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test",
    apiKey: "sk-test-secret-token",
    model: "visible-stream-model",
    fetch,
    stream: true,
    forceStreaming: true,
    onOutputDelta: (delta) => deltas.push(delta.delta),
  });

  const response = await provider.complete(createValidModelRequest({
    outputContract: {
      contractId: "test.text.v1",
      outputKind: "explanation",
      format: "text",
    },
  }));

  assert.equal(response.status, "failed");
  assert.deepEqual(deltas, ["partial"]);
  assert.deepEqual(calls.map((call) => call.body.stream), [true]);
});

test("OpenAI-compatible Chat adapter preserves cancellation during stream iteration", async () => {
  const controller = new AbortController();
  const fetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    body: (async function* () {
      controller.abort();
      throw new Error("stream aborted");
    })(),
    json: async () => {
      throw new Error("Streaming response should not be read through json().");
    },
  });
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test",
    apiKey: "sk-test-secret-token",
    model: "cancel-stream-model",
    fetch,
    stream: true,
    forceStreaming: true,
  });

  const response = await provider.complete(createValidModelRequest(), { abortSignal: controller.signal });

  assert.equal(response.status, "cancelled");
  assert.equal(response.failure?.retryable, false);
});

test("OpenAI-compatible Chat adapter preserves model refusal text", async () => {
  const fetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: "chatcmpl-refusal",
      model: "gpt-compatible-test",
      choices: [
        {
          message: { role: "assistant", content: null, refusal: "I cannot complete that request." },
          finish_reason: "stop",
        },
      ],
    }),
  });
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test",
    apiKey: "sk-test-secret-token",
    model: "gpt-compatible-test",
    fetch,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.retryable, false);
  assert.equal(response.failure?.message.includes("I cannot complete that request."), true);
});

test("OpenAI-compatible Chat adapter preserves streamed model refusal text", async () => {
  const fetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    body: sseChunks([
      {
        model: "gpt-compatible-test",
        choices: [{ delta: { refusal: "I cannot " }, finish_reason: null }],
      },
      {
        model: "gpt-compatible-test",
        choices: [{ delta: { refusal: "complete that request." }, finish_reason: "stop" }],
      },
    ]),
    json: async () => {
      throw new Error("Streaming response should not be read through json().");
    },
  });
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test",
    apiKey: "sk-test-secret-token",
    model: "gpt-compatible-test",
    fetch,
    stream: true,
    forceStreaming: true,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.retryable, false);
  assert.equal(response.failure?.message.includes("I cannot complete that request."), true);
});

test("OpenAI-compatible Chat adapter fails a stream that ends without a finish reason", async () => {
  const fetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    body: sseChunks([
      {
        model: "gpt-compatible-test",
        choices: [{ delta: { content: "partial" }, finish_reason: null }],
      },
    ]),
    json: async () => {
      throw new Error("Streaming response should not be read through json().");
    },
  });
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test",
    apiKey: "sk-test-secret-token",
    model: "gpt-compatible-test",
    fetch,
    stream: true,
    forceStreaming: true,
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
  assert.equal(response.failure?.message.includes("finish reason"), true);
});

test("OpenAI-compatible Chat adapter fails incomplete final finish reasons", async () => {
  for (const finishReason of ["length", "content_filter"] as const) {
    const fetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: `chatcmpl-${finishReason}`,
        model: "gpt-compatible-test",
        choices: [
          {
            message: { role: "assistant", content: JSON.stringify({ summary: "Incomplete provider response." }) },
            finish_reason: finishReason,
          },
        ],
      }),
    });
    const provider = new OpenAICompatibleChatCompletionsProvider({
      baseUrl: "https://llm.example.test",
      apiKey: "sk-test-secret-token",
      model: "gpt-compatible-test",
      fetch,
    });

    const response = await provider.complete(createValidModelRequest());

    assert.equal(response.status, "failed");
    assert.equal(response.finishReason, "error");
    assert.equal(response.failure?.kind, "provider_response");
    assert.equal(response.failure?.retryable, finishReason === "length");
  }
});

test("OpenAI-compatible Chat adapter rejects unknown or missing non-stream terminal finish reasons", async () => {
  for (const finishReason of ["unexpected_terminal", undefined] as const) {
    const fetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: `chatcmpl-${finishReason ?? "missing"}`,
        model: "gpt-compatible-test",
        choices: [{
          message: { role: "assistant", content: JSON.stringify({ summary: "Partial provider response." }) },
          ...(finishReason === undefined ? {} : { finish_reason: finishReason }),
        }],
      }),
    });
    const provider = new OpenAICompatibleChatCompletionsProvider({
      baseUrl: "https://llm.example.test",
      apiKey: "sk-test-secret-token",
      model: "gpt-compatible-test",
      fetch,
    });

    const response = await provider.complete(createValidModelRequest());

    assert.equal(response.status, "failed");
    assert.equal(response.finishReason, "error");
    assert.equal(response.failure?.kind, "provider_response");
  }
});


test("OpenAI-compatible Chat adapter gates parallel tool calls by visible tool risk", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "chatcmpl-parallel-tools",
        model: "gpt-compatible-test",
        choices: [
          {
            message: { role: "assistant", content: JSON.stringify({ summary: "ok" }) },
            finish_reason: "stop",
          },
        ],
      }),
    };
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test",
    apiKey: "sk-test-secret-token",
    model: "gpt-compatible-test",
    requestSettings: {
      parallelToolCalls: true,
    },
    fetch,
  });

  await provider.complete(createValidModelRequest({
    tools: [
      {
        name: "read",
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
        name: "shell",
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

test("OpenAI-compatible Chat adapter applies DeepSeek reasoning controls and extracts reasoning_content", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "chatcmpl-deepseek-reasoning",
        model: "deepseek-v4-pro",
        choices: [
          {
            message: {
              role: "assistant",
              reasoning_content: "先比较复杂度、稳定性与空间占用。",
              content: "归并排序稳定，快速排序平均更快但最坏会退化。",
            },
            finish_reason: "stop",
          },
        ],
      }),
    };
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://api.deepseek.com",
    apiKey: "sk-test-secret-token",
    model: "deepseek-v4-pro",
    providerProfileId: "deepseek",
    requestSettings: {
      temperature: 0.2,
      topP: 0.8,
      reasoningEffort: "high",
    },
    fetch,
  });

  const response = await provider.complete(createValidModelRequest({
    outputContract: {
      contractId: "test.text.v1",
      outputKind: "explanation",
      format: "text",
    },
  }));

  assert.equal(response.status, "completed");
  assert.equal(response.textOutput, "归并排序稳定，快速排序平均更快但最坏会退化。");
  assert.deepEqual(response.reasoningOutput, {
    source: "openai_chat_reasoning_content",
    content: "先比较复杂度、稳定性与空间占用。",
    truncated: false,
  });
  assert.equal(calls[0]?.body.reasoning_effort, "high");
  assert.deepEqual(calls[0]?.body.thinking, { type: "enabled" });
  assert.equal(calls[0]?.body.temperature, undefined);
  assert.equal(calls[0]?.body.top_p, undefined);
});

test("OpenAI-compatible Chat adapter does not infer provider dialect from shared model ids", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({
      url,
      body: JSON.parse(init.body) as Record<string, unknown>,
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "chatcmpl-shared-model-proxy",
        model: "deepseek-v4-pro",
        choices: [
          {
            message: { role: "assistant", content: JSON.stringify({ summary: "Proxy route stayed scoped." }) },
            finish_reason: "stop",
          },
        ],
      }),
    };
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "sk-test-secret-token",
    model: "deepseek-v4-pro",
    requestSettings: {
      temperature: 0.2,
      topP: 0.8,
      reasoningEffort: "high",
    },
    fetch,
  });

  const response = await provider.complete(createValidModelRequest());

  assert.equal(response.status, "completed");
  assert.equal(calls[0]?.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[0]?.body.model, "deepseek-v4-pro");
  assert.equal(calls[0]?.body.thinking, undefined);
  assert.equal(calls[0]?.body.temperature, 0.2);
  assert.equal(calls[0]?.body.top_p, 0.8);
  assert.equal(calls[0]?.body.reasoning_effort, undefined);
});

test("OpenAI-compatible Chat adapter sends Kimi thinking as a provider extension", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "chatcmpl-kimi-thinking",
        model: "kimi-k2",
        choices: [
          {
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
      }),
    };
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://api.moonshot.cn/v1",
    apiKey: "sk-test-secret-token",
    model: "kimi-k2",
    providerProfileId: "moonshot",
    requestSettings: {
      temperature: 0.2,
      topP: 0.8,
      reasoningEffort: "high",
    },
    fetch,
  });

  await provider.complete(createValidModelRequest({
    tools: [
      {
        name: "web_search",
        description: "Search the web.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
    ],
    toolChoice: { type: "function", function: { name: "web_search" } },
    outputContract: {
      contractId: "test.text.v1",
      outputKind: "explanation",
      format: "text",
    },
  }));

  assert.deepEqual(calls[0]?.body.thinking, { type: "enabled" });
  assert.equal(calls[0]?.body.extra_body, undefined);
  assert.equal(calls[0]?.body.temperature, undefined);
  assert.equal(calls[0]?.body.top_p, undefined);
  assert.equal(calls[0]?.body.tool_choice, "auto");
  assert.equal("reasoning_effort" in (calls[0]?.body ?? {}), false);
});

test("OpenAI-compatible Chat adapter streams Kimi reasoning chunks exactly", async () => {
  const deltas: Array<{ kind: string | undefined; delta: string }> = [];
  const fetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    body: sseChunks([
      {
        model: "kimi-k2.6",
        choices: [{ delta: { reasoning_content: "The" }, finish_reason: null }],
      },
      {
        model: "kimi-k2.6",
        choices: [{ delta: { reasoning_content: " user is simply greeting" }, finish_reason: null }],
      },
      {
        model: "kimi-k2.6",
        choices: [{ delta: { content: "你好！" }, finish_reason: "stop" }],
      },
    ]),
    json: async () => {
      throw new Error("Streaming response should not be read through json().");
    },
  });
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://api.moonshot.cn/v1",
    apiKey: "sk-test-secret-token",
    model: "kimi-k2.6",
    providerProfileId: "moonshot",
    fetch,
    stream: true,
    onOutputDelta: (delta) => {
      deltas.push({ kind: delta.kind, delta: delta.delta });
    },
  });

  const response = await provider.complete(createValidModelRequest({
    outputContract: {
      contractId: "test.text.v1",
      outputKind: "explanation",
      format: "text",
    },
  }));

  assert.equal(response.status, "completed");
  assert.equal(response.reasoningOutput?.content, "The user is simply greeting");
  assert.equal(response.textOutput, "你好！");
  assert.deepEqual(deltas, [
    { kind: "reasoning", delta: "The" },
    { kind: "reasoning", delta: " user is simply greeting" },
    { kind: "output", delta: "你好！" },
  ]);
});

test("OpenAI-compatible Chat adapter disables GLM thinking for stable OpenAI-compatible calls", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "chatcmpl-glm-stable",
        model: "glm-4.5",
        choices: [
          {
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
      }),
    };
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKey: "sk-test-secret-token",
    model: "glm-4.5",
    providerProfileId: "glm",
    requestSettings: {
      reasoningEffort: "high",
    },
    fetch,
    stream: true,
  });

  await provider.complete(createValidModelRequest({
    outputContract: {
      contractId: "test.text.v1",
      outputKind: "explanation",
      format: "text",
    },
  }));

  assert.deepEqual(calls[0]?.body.thinking, { type: "disabled" });
  assert.equal(calls[0]?.body.stream, undefined);
  assert.equal(calls[0]?.body.extra_body, undefined);
  assert.equal("reasoning_effort" in (calls[0]?.body ?? {}), false);
});

test("OpenAI-compatible Chat adapter force streams legacy GLM for live panel output", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const deltas: Array<{ kind: string | undefined; delta: string }> = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      body: sseChunks([
        {
          model: "glm-4.5",
          choices: [{ delta: { content: "第一段" }, finish_reason: null }],
        },
        {
          model: "glm-4.5",
          choices: [{ delta: { content: "第二段" }, finish_reason: "stop" }],
        },
      ]),
      json: async () => {
        throw new Error("Forced streaming response should not be read through json().");
      },
    };
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKey: "sk-test-secret-token",
    model: "glm-4.5",
    providerProfileId: "glm",
    requestSettings: {
      reasoningEffort: "high",
    },
    fetch,
    stream: true,
    forceStreaming: true,
    onOutputDelta: (delta) => {
      deltas.push({ kind: delta.kind, delta: delta.delta });
    },
  });

  const response = await provider.complete(createValidModelRequest({
    outputContract: {
      contractId: "test.text.v1",
      outputKind: "explanation",
      format: "text",
    },
  }));

  assert.equal(response.status, "completed");
  assert.deepEqual(calls[0]?.body.thinking, { type: "disabled" });
  assert.equal(calls[0]?.body.stream, true);
  assert.deepEqual(deltas, [
    { kind: "output", delta: "第一段" },
    { kind: "output", delta: "第二段" },
  ]);
});

test("OpenAI-compatible Chat adapter enables modern GLM thinking and streaming", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const deltas: Array<{ kind: string | undefined; delta: string }> = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      body: sseChunks([
        {
          model: "glm-5.1",
          choices: [{ delta: { reasoning_content: "先计算乘法再加法。" }, finish_reason: null }],
        },
        {
          model: "glm-5.1",
          choices: [{ delta: { content: "结果是 1573。" }, finish_reason: "stop" }],
        },
      ]),
      json: async () => {
        throw new Error("Streaming response should not be read through json().");
      },
    };
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKey: "sk-test-secret-token",
    model: "glm-5.1",
    providerProfileId: "glm",
    fetch,
    stream: true,
    onOutputDelta: (delta) => {
      deltas.push({ kind: delta.kind, delta: delta.delta });
    },
  });

  const response = await provider.complete(createValidModelRequest({
    outputContract: {
      contractId: "test.text.v1",
      outputKind: "explanation",
      format: "text",
    },
  }));

  assert.equal(response.status, "completed");
  assert.deepEqual(calls[0]?.body.thinking, { type: "enabled" });
  assert.equal(calls[0]?.body.stream, true);
  assert.deepEqual(deltas, [
    { kind: "reasoning", delta: "先计算乘法再加法。" },
    { kind: "output", delta: "结果是 1573。" },
  ]);
});

test("OpenAI-compatible Chat adapter extracts MiniMax reasoning_details and strips think tags", async () => {
  const fetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: "chatcmpl-minimax-reasoning",
      model: "MiniMax-M2.7",
      choices: [
        {
          message: {
            role: "assistant",
            reasoning_details: [{ text: "先说明前提，再说明区间收缩。" }],
            content: "<think>再组织成三步。</think>二分查找要求数组有序。",
          },
          finish_reason: "stop",
        },
      ],
    }),
  });
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://api.minimaxi.com/v1",
    apiKey: "sk-test-secret-token",
    model: "MiniMax-M2.7",
    providerProfileId: "minimax",
    fetch,
  });

  const response = await provider.complete(createValidModelRequest({
    outputContract: {
      contractId: "test.text.v1",
      outputKind: "explanation",
      format: "text",
    },
  }));

  assert.equal(response.textOutput, "二分查找要求数组有序。");
  assert.deepEqual(response.reasoningOutput, {
    source: "openai_chat_reasoning_content",
    content: "先说明前提，再说明区间收缩。\n\n再组织成三步。",
    truncated: false,
  });
});

test("OpenAI-compatible Chat adapter streams MiniMax reasoning_details as reasoning deltas", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const deltas: Array<{ kind: string | undefined; delta: string }> = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      body: sseChunks([
        {
          model: "MiniMax-M2.7",
          choices: [{ delta: { reasoning_details: [{ text: "需要" }] }, finish_reason: null }],
        },
        {
          model: "MiniMax-M2.7",
          choices: [{ delta: { reasoning_details: [{ text: "需要先说明前提。" }] }, finish_reason: null }],
        },
        {
          model: "MiniMax-M2.7",
          choices: [{ delta: { content: "二分" }, finish_reason: null }],
        },
        {
          model: "MiniMax-M2.7",
          choices: [{ delta: { content: "二分查找要求有序数组。" }, finish_reason: "stop" }],
        },
      ]),
      json: async () => {
        throw new Error("Streaming response should not be read through json().");
      },
    };
  };
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://api.minimaxi.com/v1",
    apiKey: "sk-test-secret-token",
    model: "MiniMax-M2.7",
    providerProfileId: "minimax",
    fetch,
    requestSettings: {
      reasoningEffort: "high",
    },
    stream: true,
    onOutputDelta: (delta) => {
      deltas.push({ kind: delta.kind, delta: delta.delta });
    },
  });

  const response = await provider.complete(createValidModelRequest({
    outputContract: {
      contractId: "test.text.v1",
      outputKind: "explanation",
      format: "text",
    },
  }));

  assert.equal(response.status, "completed");
  assert.equal(response.textOutput, "二分查找要求有序数组。");
  assert.deepEqual(response.reasoningOutput, {
    source: "openai_chat_reasoning_content",
    content: "需要先说明前提。",
    truncated: false,
  });
  assert.deepEqual(deltas, [
    { kind: "reasoning", delta: "需要" },
    { kind: "reasoning", delta: "先说明前提。" },
    { kind: "output", delta: "二分" },
    { kind: "output", delta: "查找要求有序数组。" },
  ]);
  assert.equal(calls[0]?.body.reasoning_split, true);
  assert.equal(calls[0]?.body.extra_body, undefined);
  assert.equal("reasoning_effort" in (calls[0]?.body ?? {}), false);
  assert.equal(calls[0]?.body.stream, true);
});

test("OpenAI-compatible adapter maps tools, tool results, and provider tool calls", async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const inputSchema: ToolInputSchema = {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["fast", "safe"] },
      target: { $ref: "#/$defs/target" },
      retries: { type: "integer", minimum: 0, maximum: 3 },
      slug: { type: "string", pattern: "^[a-z]+$" },
      operation: { const: "lookup" },
    },
    required: ["mode", "target"],
    additionalProperties: { type: "string" },
    $defs: {
      target: {
        type: "object",
        properties: { id: { type: "string", minLength: 1 } },
        required: ["id"],
        additionalProperties: false,
      },
    },
    oneOf: [
      { required: ["mode"] },
      { properties: { mode: { const: "safe" } } },
    ],
    dependentRequired: { mode: ["target"] },
  };
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
              reasoning_content: "Provider-private reasoning continuation.",
              reasoning_details: [{ text: "Provider reasoning detail." }],
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
          inputSchema,
        },
      ],
      toolChoice: "auto",
      sanitizedMessages: [
        { role: "user", content: "Search first." },
        {
          role: "assistant",
          content: "",
          protocolExtensions: {
            reasoning_content: "Previous private continuation.",
            reasoning_details: [{ text: "Previous detail." }],
            tool_calls: "ignored standard key",
          },
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
  assert.deepEqual(response.assistantMessage?.protocolExtensions, {
    reasoning_content: "Provider-private reasoning continuation.",
    reasoning_details: [{ text: "Provider reasoning detail." }],
  });
  assert.deepEqual(response.reasoningOutput, {
    source: "openai_chat_reasoning_content",
    content: "Provider-private reasoning continuation.\n\nProvider reasoning detail.",
    truncated: false,
  });
  assert.equal(response.finishReason, "tool_call");
  assert.deepEqual(calls[0]?.body.tools, [
    {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web.",
        parameters: inputSchema,
      },
    },
  ]);
  assert.equal(calls[0]?.body.tool_choice, "auto");
  assert.deepEqual(calls[0]?.body.messages, [
    { role: "user", content: "Search first." },
    {
      role: "assistant",
      reasoning_content: "Previous private continuation.",
      reasoning_details: [{ text: "Previous detail." }],
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
      content: JSON.stringify({ status: "completed", output: { results: [] } }),
    },
  ]);
  const serializedMessages = JSON.stringify(calls[0]?.body.messages);
  assert.equal(serializedMessages.includes("Search the web."), false);
  assert.equal(serializedMessages.includes("parameters"), false);
  assert.equal(serializedMessages.includes("Allowed tools"), false);
});

test("OpenAI-compatible adapter maps legacy function_call as a tool call", async () => {
  const fetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: "chatcmpl-legacy-function-call",
      model: "legacy-function-call-model",
      choices: [
        {
          message: {
            role: "assistant",
            content: "",
            function_call: {
              name: "web_search",
              arguments: JSON.stringify({ query: "AgentArbor tools" }),
            },
          },
          finish_reason: "function_call",
        },
      ],
    }),
  });
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test",
    apiKey: "sk-test-secret-token",
    model: "legacy-function-call-model",
    fetch,
  });
  const eventLog = new InMemoryEventLog();
  const channel = new NativeIntelligenceChannel({ provider, bus: new InMemoryMessageBus(eventLog) });

  const response = await channel.request(createValidModelRequest({
    tools: [
      {
        name: "web_search",
        description: "Search the web.",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
    ],
    toolChoice: "auto",
  }));

  assert.equal(response.status, "completed");
  assert.equal(response.validation.status, "passed");
  assert.equal(response.finishReason, "tool_call");
  assert.deepEqual(response.toolCalls, [
    { callId: response.toolCalls?.[0]?.callId, toolName: "web_search", input: { query: "AgentArbor tools" } },
  ]);
});

test("OpenAI-compatible adapter streams legacy function_call arguments as a tool call", async () => {
  const fetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    body: sseChunks([
      {
        model: "legacy-function-call-stream-model",
        choices: [{ delta: { function_call: { name: "web_search" } }, finish_reason: null }],
      },
      {
        model: "legacy-function-call-stream-model",
        choices: [{ delta: { function_call: { arguments: "{\"query\":" } }, finish_reason: null }],
      },
      {
        model: "legacy-function-call-stream-model",
        choices: [{ delta: { function_call: { arguments: "\"AgentArbor tools\"}" } }, finish_reason: "function_call" }],
      },
    ]),
    json: async () => {
      throw new Error("Streaming response should not be read through json().");
    },
  });
  const provider = new OpenAICompatibleChatCompletionsProvider({
    baseUrl: "https://llm.example.test",
    apiKey: "sk-test-secret-token",
    model: "legacy-function-call-stream-model",
    fetch,
    stream: true,
  });
  const eventLog = new InMemoryEventLog();
  const channel = new NativeIntelligenceChannel({ provider, bus: new InMemoryMessageBus(eventLog) });

  const response = await channel.request(createValidModelRequest({
    tools: [
      {
        name: "web_search",
        description: "Search the web.",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
    ],
    toolChoice: "auto",
  }));

  assert.equal(response.status, "completed");
  assert.equal(response.validation.status, "passed");
  assert.equal(response.finishReason, "tool_call");
  assert.deepEqual(response.toolCalls, [
    { callId: response.toolCalls?.[0]?.callId, toolName: "web_search", input: { query: "AgentArbor tools" } },
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
