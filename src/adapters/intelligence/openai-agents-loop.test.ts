import assert from "node:assert/strict";
import test from "node:test";
import type { ConfirmationDecision } from "../../domain/confirmation/index.js";
import {
  OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION,
  type ModelMessage,
} from "../../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionGateway,
  ToolExecutionPreflight,
  ToolPermissionCheck,
} from "../../domain/tools/index.js";
import { withToolModelAttachments } from "../../domain/tools/index.js";
import {
  createOpenAIAgentsLoop,
  openAIAgentsPromptCacheKey,
  type OpenAIAgentsLoopConfig,
} from "./openai-agents-loop.js";

const MODEL = "agent-loop-test-model";
const SYSTEM = "Follow the test contract.";
const CHAT_BASE_URL = "https://compatible.example.test/v1";
const OFFICIAL_BASE_URL = "https://api.openai.com/v1";

type JsonRecord = Record<string, unknown>;
type CapturedFetch = {
  readonly url: string;
  readonly body: JsonRecord;
  readonly signal?: AbortSignal | null;
};

test("compatible Chat sends a stable cache identity with one local history and maps cached usage", async () => {
  const fetch = scriptedFetch([
    ({ url, body }) => {
      assert.equal(url, `${CHAT_BASE_URL}/chat/completions`);
      const serialized = JSON.stringify(body.messages);
      assert.equal(occurrences(serialized, "prior-user"), 1);
      assert.equal(occurrences(serialized, "prior-assistant"), 1);
      assert.equal(occurrences(serialized, "current-user"), 1);
      assert.equal(body.prompt_cache_key, openAIAgentsPromptCacheKey(
        "openai_compatible_chat_completions",
        MODEL,
        SYSTEM,
        [],
      ));
      assert.equal(body.include, undefined);
      assert.equal(body.service_tier, undefined);
      return chatText("chat-finished", {
        prompt_tokens: 12,
        completion_tokens: 4,
        total_tokens: 16,
        prompt_tokens_details: { cached_tokens: 7 },
        completion_tokens_details: { reasoning_tokens: 2 },
      });
    },
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL });
    try {
      const messages: readonly ModelMessage[] = [
        { role: "system", content: SYSTEM },
        { role: "user", content: "prior-user" },
        { role: "assistant", content: "prior-assistant" },
        { role: "user", content: "current-user" },
      ];
      const result = await loop.execute(loopInput(messages));
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      assert.equal(result.status === "completed" ? result.finalText : undefined, "chat-finished");
      assert.deepEqual(result.messages.map((message) => message.content), [
        SYSTEM,
        "prior-user",
        "prior-assistant",
        "current-user",
        "chat-finished",
      ]);
      assert.deepEqual(result.usage, {
        inputTokens: 12,
        outputTokens: 4,
        totalTokens: 16,
        cachedInputTokens: 7,
        uncachedInputTokens: 5,
        reasoningOutputTokens: 2,
      });
    } finally {
      await loop.release();
      await loop.release();
    }
  });
  assert.equal(fetch.requests.length, 1);
});

test("Responses through a compatible gateway sends a stable cache identity and retains response output items only in canonical history", async () => {
  const fetch = scriptedFetch([
    ({ body }) => {
      assert.equal(typeof body.prompt_cache_key, "string");
      assert.deepEqual(body.include, ["reasoning.encrypted_content"]);
      assert.equal(body.service_tier, "flex");
      return responsesText("first-response", "resp_1", {
        input_tokens: 10,
        output_tokens: 3,
        total_tokens: 13,
        input_tokens_details: { cached_tokens: 6, cache_write_tokens: 2 },
        output_tokens_details: { reasoning_tokens: 1 },
      });
    },
    ({ body }) => responsesText(String(body.prompt_cache_key), "resp_2"),
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({
      protocol: "openai_responses",
      baseUrl: CHAT_BASE_URL,
      requestSettings: { serviceTier: "flex" },
    });
    try {
      const first = await loop.execute(loopInput([
        { role: "system", content: SYSTEM },
        { role: "user", content: "first-user" },
      ]));
      assert.equal(first.status, "completed");
      const finalMessage = first.messages.at(-1);
      assert.equal(Array.isArray(finalMessage?.protocolExtensions?.openai_responses_output_items), true);
      assert.equal(first.usage.cachedInputTokens, 6);
      assert.equal(first.usage.cacheWriteInputTokens, 2);

      const second = await loop.execute(loopInput([
        { role: "system", content: SYSTEM },
        { role: "user", content: "a different later user message" },
      ]));
      assert.equal(second.status, "completed");
      assert.equal(second.status === "completed" ? second.finalText : undefined, fetch.requests[0]?.body.prompt_cache_key);
      assert.equal(fetch.requests[0]?.body.prompt_cache_key, fetch.requests[1]?.body.prompt_cache_key);
    } finally {
      await loop.release();
    }
  });
});

test("Chat rehydrates portable conversation facts without replaying Responses continuation items", async () => {
  const privateContinuation = "responses-encrypted-continuation";
  const fetch = scriptedFetch([
    ({ body }) => {
      const serialized = JSON.stringify(body.messages);
      assert.match(serialized, /portable prior answer/u);
      assert.doesNotMatch(serialized, new RegExp(privateContinuation, "u"));
      assert.doesNotMatch(serialized, new RegExp(OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION, "u"));
      return chatText("chat-after-protocol-switch");
    },
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL });
    try {
      const result = await loop.execute(loopInput([
        { role: "system", content: SYSTEM },
        { role: "user", content: "prior Responses request" },
        {
          role: "assistant",
          content: "portable prior answer",
          protocolExtensions: {
            [OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION]: [{
              id: "reasoning-before-chat-switch",
              type: "reasoning",
              encrypted_content: privateContinuation,
              summary: [],
            }],
          },
        },
        { role: "user", content: "continue through Chat" },
      ]));
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      assert.equal(result.messages.some((message) =>
        message.protocolExtensions?.[OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION] !== undefined), false);
      assert.equal(result.messages.at(-1)?.content, "chat-after-protocol-switch");
    } finally {
      await loop.release();
    }
  });
});

test("Responses rehydrates portable conversation facts without replaying Chat continuation fields", async () => {
  const privateContinuation = "chat-private-reasoning";
  const fetch = scriptedFetch([
    ({ body }) => {
      const serialized = JSON.stringify(body.input);
      assert.match(serialized, /portable Chat answer/u);
      assert.doesNotMatch(serialized, new RegExp(privateContinuation, "u"));
      assert.doesNotMatch(serialized, /reasoning_content/u);
      return responsesText("responses-after-protocol-switch", "resp-after-chat-switch");
    },
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({ protocol: "openai_responses", baseUrl: OFFICIAL_BASE_URL });
    try {
      const result = await loop.execute(loopInput([
        { role: "system", content: SYSTEM },
        { role: "user", content: "prior Chat request" },
        {
          role: "assistant",
          content: "portable Chat answer",
          protocolExtensions: { reasoning_content: privateContinuation },
        },
        { role: "user", content: "continue through Responses" },
      ]));
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      assert.equal(result.messages.some((message) =>
        message.protocolExtensions?.reasoning_content !== undefined), false);
      assert.equal(
        Array.isArray(result.messages.at(-1)?.protocolExtensions?.[OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION]),
        true,
      );
    } finally {
      await loop.release();
    }
  });
});

test("Chat keeps tool results adjacent when canonical assistant history has text and tool calls", async () => {
  const callIds = ["call-text-and-tool-history-a", "call-text-and-tool-history-b"] as const;
  const fetch = scriptedFetch([
    ({ body }) => {
      const messages = Array.isArray(body.messages) ? body.messages.map(parseRecord) : [];
      const toolCallIndex = messages.findIndex((message) =>
        message.role === "assistant" && Array.isArray(message.tool_calls));
      assert.ok(toolCallIndex >= 0, JSON.stringify(messages));
      assert.equal(messages[toolCallIndex - 1]?.role, "assistant");
      assert.equal(messages[toolCallIndex + 1]?.role, "tool");
      assert.equal(messages[toolCallIndex + 1]?.tool_call_id, callIds[0]);
      assert.equal(messages[toolCallIndex + 1]?.content, "");
      assert.equal(messages[toolCallIndex + 2]?.role, "tool");
      assert.equal(messages[toolCallIndex + 2]?.tool_call_id, callIds[1]);
      return chatText("valid-tool-history");
    },
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL });
    try {
      const result = await loop.execute(loopInput([
        { role: "system", content: SYSTEM },
        { role: "user", content: "show a capability" },
        {
          role: "assistant",
          content: "I will inspect two facts.",
          toolCalls: callIds.map((callId, index) => ({
            callId,
            toolName: "inspect_fact",
            input: { value: `history-${index}` },
          })),
          protocolExtensions: { reasoning_content: "private-reasoning" },
        },
        { role: "tool", content: "", toolCallId: callIds[0], toolName: "inspect_fact" },
        { role: "tool", content: "second", toolCallId: callIds[1], toolName: "inspect_fact" },
        { role: "user", content: "continue" },
      ]));
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      assert.equal(result.status === "completed" ? result.finalText : undefined, "valid-tool-history");
    } finally {
      await loop.release();
    }
  });
});

test("Responses injects hosted Web Search through a compatible gateway and isolates its cache identity", async () => {
  const fetch = scriptedFetch([
    ({ body }) => {
      const tools = Array.isArray(body.tools) ? body.tools.map(parseRecord) : [];
      assert.equal(tools.some((tool) =>
        tool.type === "web_search" && tool.search_context_size === "medium"), true);
      return responsesText("search-finished", "resp-search");
    },
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({
      protocol: "openai_responses",
      baseUrl: CHAT_BASE_URL,
      enableWebSearch: true,
    });
    try {
      const result = await loop.execute(loopInput([
        { role: "system", content: SYSTEM },
        { role: "user", content: "search the web" },
      ]));
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
    } finally {
      await loop.release();
    }
  });

  const withoutSearch = openAIAgentsPromptCacheKey("openai_responses", MODEL, SYSTEM, []);
  const withSearch = openAIAgentsPromptCacheKey("openai_responses", MODEL, SYSTEM, [], [], true);
  assert.notEqual(withoutSearch, withSearch);
});

test("model built-in Web Search rejects only an unsupported protocol", () => {
  assert.throws(() => createOpenAIAgentsLoop({
    protocol: "openai_compatible_chat_completions",
    baseUrl: OFFICIAL_BASE_URL,
    apiKey: "test-key",
    model: MODEL,
    enableWebSearch: true,
  }), /Responses protocol/u);
  const loop = createOpenAIAgentsLoop({
    protocol: "openai_responses",
    baseUrl: CHAT_BASE_URL,
    apiKey: "test-key",
    model: MODEL,
    enableWebSearch: true,
  });
  return loop.release();
});

test("compatible Chat maps user image, file, and audio attachments without changing canonical messages", async () => {
  const fetch = scriptedFetch([
    ({ body }) => {
      const serialized = JSON.stringify(body.messages);
      assert.match(serialized, /data:image\/png;base64,aW1hZ2U=/u);
      assert.match(serialized, /data:application\/pdf;base64,cGRm/u);
      assert.match(serialized, /"input_audio":\{"data":"YXVkaW8=","format":"wav"\}/u);
      return chatText("attachments-seen");
    },
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL });
    try {
      const messages: readonly ModelMessage[] = [{ role: "system", content: SYSTEM }, {
        role: "user",
        content: "inspect attachments",
        attachments: [{
          kind: "image",
          source: { kind: "data", mimeType: "image/png", data: "aW1hZ2U=" },
        }, {
          kind: "file",
          source: { kind: "data", mimeType: "application/pdf", data: "cGRm" },
          filename: "brief.pdf",
        }, {
          kind: "audio",
          source: { kind: "data", mimeType: "audio/wav", data: "YXVkaW8=" },
          filename: "note.wav",
        }],
      }];
      const result = await loop.execute(loopInput(messages));
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      assert.deepEqual(result.messages[1]?.attachments, messages[1]?.attachments);
    } finally {
      await loop.release();
    }
  });
});

test("Responses maps user and tool-origin attachments and preserves them in canonical tool history", async () => {
  const definition = plainTool("read_media");
  const attachmentOutput = withToolModelAttachments({ result: "media-ready" }, [{
    kind: "image",
    source: { kind: "data", mimeType: "image/png", data: "aW1hZ2U=" },
    attachmentId: "tool-image",
  }, {
    kind: "file",
    source: { kind: "file_id", fileId: "file-tool" },
    filename: "tool.pdf",
    attachmentId: "tool-file",
  }]);
  const gateway: ToolExecutionGateway = {
    list: () => [definition],
    has: (name) => name === definition.name,
    preflight: (request) => ({ status: "ready", request }),
    execute: async (request) => ({
      ...request,
      output: attachmentOutput,
      status: "completed",
      durationMs: 1,
    }),
  };
  const fetch = scriptedFetch([
    ({ body }) => {
      assert.match(JSON.stringify(body.input), /data:image\/png;base64,dXNlcg==/u);
      return responsesTool("call-media", "read_media", { value: "media" });
    },
    ({ body }) => {
      const serialized = JSON.stringify(body.input);
      assert.match(serialized, /data:image\/png;base64,aW1hZ2U=/u);
      assert.match(serialized, /file-tool/u);
      assert.match(serialized, /media-ready/u);
      return responsesText("media-finished", "resp-media-final");
    },
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({ protocol: "openai_responses", baseUrl: OFFICIAL_BASE_URL });
    try {
      const observedToolResults: string[] = [];
      const result = await loop.execute({ ...loopInput([{ role: "system", content: SYSTEM }, {
        role: "user",
        content: "inspect image",
        attachments: [{
          kind: "image",
          source: { kind: "data", mimeType: "image/png", data: "dXNlcg==" },
        }],
      }], gateway), onToolResult: async (toolResult) => { observedToolResults.push(toolResult.callId); } });
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      assert.deepEqual(observedToolResults, ["call-media"]);
      const toolMessage = result.messages.find((message) => message.toolCallId === "call-media");
      assert.deepEqual(toolMessage?.attachments?.map((attachment) => attachment.attachmentId), [
        "tool-image",
        "tool-file",
      ]);
    } finally {
      await loop.release();
    }
  });
});

test("unsupported attachment transports fail before sending a request instead of dropping media", async () => {
  const cases: readonly {
    readonly protocol: OpenAIAgentsLoopConfig["protocol"];
    readonly message: ModelMessage;
    readonly error: RegExp;
  }[] = [{
    protocol: "openai_compatible_chat_completions",
    message: {
      role: "tool",
      content: "tool output",
      toolCallId: "call-image",
      toolName: "read_image",
      attachments: [{
        kind: "image",
        source: { kind: "url", url: "https://example.test/image.png" },
      }],
    },
    error: /cannot attach tool-origin image or file/u,
  }, {
    protocol: "openai_responses",
    message: {
      role: "user",
      content: "listen",
      attachments: [{
        kind: "audio",
        source: { kind: "data", mimeType: "audio/wav", data: "YXVkaW8=" },
        filename: "note.wav",
      }],
    },
    error: /does not currently accept audio input attachments/u,
  }];
  for (const entry of cases) {
    const fetch = scriptedFetch([]);
    await withGlobalFetch(fetch.fetch, async () => {
      const loop = createLoop({
        protocol: entry.protocol,
        baseUrl: entry.protocol === "openai_responses" ? OFFICIAL_BASE_URL : CHAT_BASE_URL,
      });
      try {
        const result = await loop.execute(loopInput([
          { role: "system", content: SYSTEM },
          ...(entry.message.role === "tool"
            ? [{
                role: "assistant" as const,
                content: "",
                toolCalls: [{ callId: "call-image", toolName: "read_image", input: {} }],
              }]
            : []),
          entry.message,
        ]));
        assert.equal(result.status, "failed");
        assert.match(result.status === "failed" ? result.error : "", entry.error);
        assert.equal(fetch.requests.length, 0);
      } finally {
        await loop.release();
      }
    });
  }
});

test("an injected provider fetch is used without reading or replacing global fetch", async () => {
  const previous = globalThis.fetch;
  let globalCalls = 0;
  globalThis.fetch = async () => {
    globalCalls += 1;
    throw new Error("global fetch must not be used");
  };
  const requests: string[] = [];
  const injected: NonNullable<OpenAIAgentsLoopConfig["fetch"]> = async (url) => {
    requests.push(url);
    const payload = {
      id: "chat-injected",
      object: "chat.completion",
      created: 1,
      model: MODEL,
      choices: [{ index: 0, message: { role: "assistant", content: "injected" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    return { ok: true, status: 200, json: async () => payload };
  };
  try {
    const loop = createLoop({
      protocol: "openai_compatible_chat_completions",
      baseUrl: CHAT_BASE_URL,
      fetch: injected,
    });
    try {
      const result = await loop.execute(loopInput([
        { role: "system", content: SYSTEM },
        { role: "user", content: "use injected transport" },
      ]));
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      assert.equal(result.status === "completed" ? result.finalText : undefined, "injected");
      assert.deepEqual(requests, [`${CHAT_BASE_URL}/chat/completions`]);
      assert.equal(globalCalls, 0);
    } finally {
      await loop.release();
    }
  } finally {
    globalThis.fetch = previous;
  }
});

test("streaming consumes the SDK stream, emits text deltas, and awaits completion", async () => {
  const fetch = scriptedFetch([() => chatTextStream(["stream-", "complete"])]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({
      protocol: "openai_compatible_chat_completions",
      baseUrl: CHAT_BASE_URL,
      requestSettings: { stream: true },
    });
    const deltas: string[] = [];
    try {
      const result = await loop.execute({
        ...loopInput([{ role: "system", content: SYSTEM }, { role: "user", content: "stream" }]),
        onTextDelta: (delta) => deltas.push(delta),
      });
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      assert.equal(result.status === "completed" ? result.finalText : undefined, "stream-complete");
      assert.equal(deltas.join(""), "stream-complete");
    } finally {
      await loop.release();
    }
  });
});

test("compatible Chat streaming exposes provider reasoning_content separately from answer text", async () => {
  const fetch = scriptedFetch([() => chatReasoningTextStream(["先分析", "，再回答"], ["最终", "答案"])]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({
      protocol: "openai_compatible_chat_completions",
      baseUrl: CHAT_BASE_URL,
      requestSettings: { stream: true },
      providerProfileId: "moonshot",
      model: "kimi-k3",
    });
    const reasoning: string[] = [];
    const completedReasoning: string[] = [];
    const answer: string[] = [];
    try {
      const result = await loop.execute({
        ...loopInput([{ role: "system", content: SYSTEM }, { role: "user", content: "reason first" }]),
        onReasoningDelta: (delta) => reasoning.push(delta),
        onReasoningCompleted: async (content) => { completedReasoning.push(content); },
        onTextDelta: (delta) => answer.push(delta),
      });
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      assert.equal(reasoning.join(""), "先分析，再回答");
      assert.deepEqual(completedReasoning, ["先分析，再回答"]);
      assert.equal(answer.join(""), "最终答案");
      assert.equal(result.status === "completed" ? result.finalText : undefined, "最终答案");
    } finally {
      await loop.release();
    }
  });
  assert.equal(fetch.requests[0]?.body.reasoning_effort, "max");
  assert.equal(fetch.requests[0]?.body.thinking, undefined);
});

test("compatible Chat normalizes MiniMax reasoning_details and tagged content through the shared reasoning boundary", async () => {
  const fetch = scriptedFetch([() => jsonResponse({
    id: "chat-minimax-reasoning",
    object: "chat.completion",
    created: 1,
    model: "MiniMax-M2.7",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        reasoning_details: [{ text: "先检查约束。" }],
        content: "<think>再比较候选。</think>选择稳定方案。",
      },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  })]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({
      protocol: "openai_compatible_chat_completions",
      baseUrl: "https://api.minimaxi.com/v1",
      providerProfileId: "minimax",
      model: "MiniMax-M2.7",
      requestSettings: { stream: true },
    });
    const completedReasoning: string[] = [];
    try {
      const result = await loop.execute({
        ...loopInput([{ role: "system", content: SYSTEM }, { role: "user", content: "reason first" }]),
        onReasoningCompleted: async (content) => { completedReasoning.push(content); },
        onTextDelta: () => undefined,
      });
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      assert.equal(result.status === "completed" ? result.finalText : undefined, "选择稳定方案。");
      assert.deepEqual(completedReasoning, ["先检查约束。\n\n再比较候选。"]);
    } finally {
      await loop.release();
    }
  });
  assert.equal(fetch.requests[0]?.body.reasoning_split, true);
  assert.equal(fetch.requests[0]?.body.stream, false);
});

test("Responses completion exposes normalized reasoning summaries", async () => {
  const fetch = scriptedFetch([() => jsonResponse({
    id: "resp-reasoning-summary",
    object: "response",
    created_at: 1,
    status: "completed",
    model: MODEL,
    output: [{
      id: "reasoning-summary",
      type: "reasoning",
      summary: [{ type: "summary_text", text: "核对证据后再作答。" }],
    }, {
      id: "reasoning-answer",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "证据充分。", annotations: [] }],
    }],
    usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
  })]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({
      protocol: "openai_responses",
      baseUrl: OFFICIAL_BASE_URL,
      requestSettings: { reasoningSummary: "detailed" },
    });
    const completedReasoning: string[] = [];
    try {
      const result = await loop.execute({
        ...loopInput([{ role: "system", content: SYSTEM }, { role: "user", content: "summarize reasoning" }]),
        onReasoningCompleted: async (content) => { completedReasoning.push(content); },
      });
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      assert.equal(result.status === "completed" ? result.finalText : undefined, "证据充分。");
      assert.deepEqual(completedReasoning, ["核对证据后再作答。"]);
    } finally {
      await loop.release();
    }
  });
});

test("model transport retries a network failure only before the first provider stream event", async () => {
  const fetch = scriptedFetch([
    () => { throw new TypeError("terminated", { cause: new Error("other side closed") }); },
    () => chatTextStream(["retry-", "complete"]),
  ]);
  const loop = createLoop({
    protocol: "openai_compatible_chat_completions",
    baseUrl: CHAT_BASE_URL,
    fetch: fetch.fetch,
    requestSettings: { stream: true },
  });
  const deltas: string[] = [];
  try {
    const result = await loop.execute({
      ...loopInput([{ role: "system", content: SYSTEM }, { role: "user", content: "retry transport" }]),
      onTextDelta: (delta) => deltas.push(delta),
    });

    assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
    assert.equal(result.status === "completed" ? result.finalText : undefined, "retry-complete");
    assert.equal(fetch.requests.length, 2);
    assert.equal(deltas.join(""), "retry-complete");
  } finally {
    await loop.release();
  }
});

test("model transport does not retry after a provider stream event and preserves the network cause", async () => {
  const fetch = scriptedFetch([
    () => chatTextStreamThenError("partial", new TypeError("terminated", {
      cause: new Error("other side closed"),
    })),
  ]);
  const loop = createLoop({
    protocol: "openai_compatible_chat_completions",
    baseUrl: CHAT_BASE_URL,
    fetch: fetch.fetch,
    requestSettings: { stream: true },
  });
  const deltas: string[] = [];
  try {
    const result = await loop.execute({
      ...loopInput([{ role: "system", content: SYSTEM }, { role: "user", content: "do not mix attempts" }]),
      onTextDelta: (delta) => deltas.push(delta),
    });

    assert.equal(result.status, "failed");
    assert.equal(result.status === "failed" ? result.errorCode : undefined, "provider_network");
    assert.match(result.status === "failed" ? result.error : "", /terminated.*other side closed/iu);
    assert.equal(fetch.requests.length, 1);
    assert.equal(deltas.join(""), "partial");
  } finally {
    await loop.release();
  }
});

test("compatible Chat rejects a length-truncated final response without persisting partial assistant text", async () => {
  const fetch = scriptedFetch([() => chatTextWithFinishReason("partial answer", "length")]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL });
    try {
      const input = [
        { role: "system", content: SYSTEM },
        { role: "user", content: "write a long answer" },
      ] as const;
      const result = await loop.execute(loopInput(input));
      assert.equal(result.status, "failed");
      assert.match(result.status === "failed" ? result.error : "", /finish_reason.*length/iu);
      assert.deepEqual(result.messages, input);
      assert.equal(result.messages.some((message) => message.content.includes("partial answer")), false);
    } finally {
      await loop.release();
    }
  });
});

test("SDK loop rejects unknown Chat and incomplete Responses terminal states without persisting partial assistant text", async () => {
  const cases = [
    {
      protocol: "openai_compatible_chat_completions" as const,
      baseUrl: CHAT_BASE_URL,
      response: chatTextWithFinishReason("unknown Chat partial", "unexpected_terminal"),
      expected: /finish_reason.*unexpected_terminal/iu,
    },
    {
      protocol: "openai_responses" as const,
      baseUrl: OFFICIAL_BASE_URL,
      response: responsesText("incomplete Responses partial", "resp-incomplete", undefined, { status: "incomplete" }),
      expected: /Responses returned incomplete/iu,
    },
  ];
  for (const entry of cases) {
    const fetch = scriptedFetch([() => entry.response]);
    await withGlobalFetch(fetch.fetch, async () => {
      const loop = createLoop({ protocol: entry.protocol, baseUrl: entry.baseUrl });
      const input = [
        { role: "system", content: SYSTEM },
        { role: "user", content: "return a complete answer" },
      ] as const;
      try {
        const result = await loop.execute(loopInput(input));
        assert.equal(result.status, "failed");
        assert.match(result.status === "failed" ? result.error : "", entry.expected);
        assert.deepEqual(result.messages, input);
      } finally {
        await loop.release();
      }
    });
  }
});

test("SDK terminal gate rejects an invalid intermediate tool turn before write execution", async () => {
  const cases = [{
    protocol: "openai_compatible_chat_completions" as const,
    baseUrl: CHAT_BASE_URL,
    response: () => chatToolWithFinishReason(
      "chat-invalid-write",
      "write_fact",
      { value: "changed" },
      "length",
    ),
    followUp: () => chatText("must-not-follow-up"),
  }, {
    protocol: "openai_responses" as const,
    baseUrl: OFFICIAL_BASE_URL,
    response: () => responsesToolWithStatus(
      "responses-invalid-write",
      "write_fact",
      { value: "changed" },
      "incomplete",
    ),
    followUp: () => responsesText("must-not-follow-up", "responses-must-not-follow-up"),
  }];

  for (const fixture of cases) {
    const gateway = new TestGateway(writeTool("write_fact", false));
    const fetch = scriptedFetch([() => fixture.response(), () => fixture.followUp()]);
    let acceptedToolRounds = 0;
    await withGlobalFetch(fetch.fetch, async () => {
      const loop = createLoop({ protocol: fixture.protocol, baseUrl: fixture.baseUrl });
      try {
        const result = await loop.execute({
          ...loopInput([
            { role: "system", content: SYSTEM },
            { role: "user", content: "perform the write" },
          ], gateway),
          onToolRound: async () => { acceptedToolRounds += 1; },
        });

        assert.equal(result.status, "failed");
        assert.equal(acceptedToolRounds, 0);
        assert.equal(gateway.preflights.length, 0);
        assert.equal(gateway.executions.length, 0);
        assert.equal(fetch.requests.length, 1);
      } finally {
        await loop.release();
      }
    });
  }
});

test("SDK terminal gate rejects an invalid streamed tool turn before write execution", async () => {
  const cases = [{
    protocol: "openai_compatible_chat_completions" as const,
    baseUrl: CHAT_BASE_URL,
    response: () => chatToolStreamWithFinishReason(
      "chat-stream-invalid-write",
      "write_fact",
      { value: "changed" },
      "length",
    ),
    followUp: () => chatTextStream(["must-not-follow-up"]),
  }, {
    protocol: "openai_responses" as const,
    baseUrl: OFFICIAL_BASE_URL,
    response: () => responsesToolStream(
      "responses-stream-invalid-write",
      "write_fact",
      { value: "changed" },
      { terminalStatus: "incomplete", incompleteReason: "max_output_tokens" },
    ),
    followUp: () => responsesTextStream(["must-not-follow-up"], "responses-stream-must-not-follow-up"),
  }];

  for (const fixture of cases) {
    const gateway = new TestGateway(writeTool("write_fact", false));
    const fetch = scriptedFetch([() => fixture.response(), () => fixture.followUp()]);
    let acceptedToolRounds = 0;
    await withGlobalFetch(fetch.fetch, async () => {
      const loop = createLoop({
        protocol: fixture.protocol,
        baseUrl: fixture.baseUrl,
        requestSettings: { stream: true },
      });
      try {
        const result = await loop.execute({
          ...loopInput([
            { role: "system", content: SYSTEM },
            { role: "user", content: "stream the write request" },
          ], gateway),
          onTextDelta: () => undefined,
          onToolRound: async () => { acceptedToolRounds += 1; },
        });

        assert.equal(result.status, "failed");
        assert.equal(acceptedToolRounds, 0);
        assert.equal(gateway.preflights.length, 0);
        assert.equal(gateway.executions.length, 0);
        assert.equal(fetch.requests.length, 1);
      } finally {
        await loop.release();
      }
    });
  }
});

test("SDK terminal gate rejects incomplete approval turns before ToolCenter preflight", async () => {
  const cases = [{
    protocol: "openai_compatible_chat_completions" as const,
    baseUrl: CHAT_BASE_URL,
    response: () => chatToolWithFinishReason(
      "chat-invalid-approval",
      "write_fact",
      { value: "changed" },
      "length",
    ),
  }, {
    protocol: "openai_responses" as const,
    baseUrl: OFFICIAL_BASE_URL,
    response: () => responsesToolWithStatus(
      "responses-invalid-approval",
      "write_fact",
      { value: "changed" },
      "incomplete",
    ),
  }];

  for (const fixture of cases) {
    const gateway = new TestGateway(writeTool("write_fact", true));
    const fetch = scriptedFetch([() => fixture.response()]);
    await withGlobalFetch(fetch.fetch, async () => {
      const loop = createLoop({ protocol: fixture.protocol, baseUrl: fixture.baseUrl });
      try {
        const result = await loop.execute(loopInput([
          { role: "system", content: SYSTEM },
          { role: "user", content: "request the gated write" },
        ], gateway));

        assert.equal(result.status, "failed");
        assert.equal(gateway.preflights.length, 0);
        assert.equal(gateway.executions.length, 0);
        assert.equal(fetch.requests.length, 1);
      } finally {
        await loop.release();
      }
    });
  }
});

test("root tool-round hook receives one complete canonical parallel assistant turn before execution", async () => {
  const gateway = new TestGateway([plainTool("read_left"), plainTool("read_right")]);
  const accepted: ModelMessage[] = [];
  const acceptedPrefixes: Array<readonly ModelMessage[]> = [];
  const fetch = scriptedFetch([
    () => responsesTools([{
      callId: "parallel-left",
      name: "read_left",
      input: { value: "left" },
    }, {
      callId: "parallel-right",
      name: "read_right",
      input: { value: "right" },
    }]),
    () => responsesText("parallel-complete", "parallel-final"),
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({ protocol: "openai_responses", baseUrl: OFFICIAL_BASE_URL });
    try {
      const result = await loop.execute({
        ...loopInput([
          { role: "system", content: SYSTEM },
          { role: "user", content: "read both facts" },
        ], gateway),
        onToolRound: async ({ canonicalMessagesBeforeRound, assistantMessage }) => {
          assert.equal(gateway.preflights.length, 0);
          assert.equal(gateway.executions.length, 0);
          acceptedPrefixes.push(canonicalMessagesBeforeRound);
          accepted.push(assistantMessage);
        },
      });

      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      assert.equal(accepted.length, 1);
      assert.deepEqual(acceptedPrefixes, [[
        { role: "system", content: SYSTEM },
        { role: "user", content: "read both facts" },
      ]]);
      assert.deepEqual(accepted[0]?.toolCalls, [{
        callId: "parallel-left",
        toolName: "read_left",
        input: { value: "left" },
      }, {
        callId: "parallel-right",
        toolName: "read_right",
        input: { value: "right" },
      }]);
      const outputItems = accepted[0]?.protocolExtensions?.[OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION];
      assert.equal(Array.isArray(outputItems), true);
      assert.match(JSON.stringify(outputItems), /parallel-left/u);
      assert.match(JSON.stringify(outputItems), /parallel-right/u);
      assert.equal(gateway.executions.length, 2);
    } finally {
      await loop.release();
    }
  });
});

test("root tool-round hook observes the exact accumulated prefix without a context maintainer", async () => {
  const gateway = new TestGateway([plainTool("read_first"), plainTool("read_second")]);
  const prefixes: Array<readonly ModelMessage[]> = [];
  const fetch = scriptedFetch([
    () => responsesTools([{ callId: "round-one", name: "read_first", input: { value: "first" } }]),
    () => responsesTools([{ callId: "round-two", name: "read_second", input: { value: "second" } }]),
    () => responsesText("rounds-complete", "done"),
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({ protocol: "openai_responses", baseUrl: OFFICIAL_BASE_URL });
    try {
      const result = await loop.execute({
        ...loopInput([
          { role: "system", content: SYSTEM },
          { role: "user", content: "read in sequence" },
        ], gateway),
        onToolRound: async ({ canonicalMessagesBeforeRound }) => {
          prefixes.push(canonicalMessagesBeforeRound);
        },
      });

      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      assert.equal(prefixes.length, 2);
      assert.deepEqual(prefixes[0]?.map((message) => message.role), ["system", "user"]);
      assert.deepEqual(prefixes[1]?.map((message) => message.role), ["system", "user", "assistant", "tool"]);
      assert.equal(prefixes[1]?.at(-2)?.toolCalls?.[0]?.callId, "round-one");
      assert.equal(prefixes[1]?.at(-1)?.toolCallId, "round-one");
    } finally {
      await loop.release();
    }
  });
});

test("root tool-round acceptance failure blocks non-streamed and streamed tools before preflight", async () => {
  const cases = [{
    protocol: "openai_compatible_chat_completions" as const,
    baseUrl: CHAT_BASE_URL,
    stream: false,
    response: () => chatTool("rejected-chat-round", "write_fact", { value: "changed" }),
  }, {
    protocol: "openai_responses" as const,
    baseUrl: OFFICIAL_BASE_URL,
    stream: true,
    response: () => responsesToolStream("rejected-responses-round", "write_fact", { value: "changed" }),
  }];

  for (const fixture of cases) {
    const gateway = new TestGateway(writeTool("write_fact", false));
    const fetch = scriptedFetch([() => fixture.response()]);
    let acceptanceAttempts = 0;
    await withGlobalFetch(fetch.fetch, async () => {
      const loop = createLoop({
        protocol: fixture.protocol,
        baseUrl: fixture.baseUrl,
        requestSettings: fixture.stream ? { stream: true } : undefined,
      });
      try {
        const result = await loop.execute({
          ...loopInput([
            { role: "system", content: SYSTEM },
            { role: "user", content: "persist this tool round" },
          ], gateway),
          ...(fixture.stream ? { onTextDelta: () => undefined } : {}),
          onToolRound: async () => {
            acceptanceAttempts += 1;
            throw new Error("durable tool round rejected");
          },
        });

        assert.equal(result.status, "failed");
        assert.match(result.status === "failed" ? result.error : "", /durable tool round rejected/u);
        assert.equal(acceptanceAttempts, 1);
        assert.equal(gateway.preflights.length, 0);
        assert.equal(gateway.executions.length, 0);
        assert.equal(fetch.requests.length, 1);
      } finally {
        await loop.release();
      }
    });
  }
});

test("SDK loop treats a provider refusal as failed instead of a completed answer", async () => {
  const fetch = scriptedFetch([() => chatRefusal("I cannot complete that request.")]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL });
    const input = [
      { role: "system", content: SYSTEM },
      { role: "user", content: "perform the refused request" },
    ] as const;
    try {
      const result = await loop.execute(loopInput(input));
      assert.equal(result.status, "failed");
      assert.match(result.status === "failed" ? result.error : "", /refused|cannot complete/iu);
      assert.deepEqual(result.messages.slice(0, 2), input);
      assert.equal(result.messages.at(-1)?.content, "I cannot complete that request.");
    } finally {
      await loop.release();
    }
  });
});

test("streaming compatible Chat reports partial text but does not persist a length-truncated answer", async () => {
  const fetch = scriptedFetch([() => chatTextStreamWithFinishReason(["partial", " stream"], "length")]);
  const deltas: string[] = [];
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({
      protocol: "openai_compatible_chat_completions",
      baseUrl: CHAT_BASE_URL,
      requestSettings: { stream: true },
    });
    try {
      const input = [
        { role: "system", content: SYSTEM },
        { role: "user", content: "stream a long answer" },
      ] as const;
      const result = await loop.execute({
        ...loopInput(input),
        onTextDelta: (delta) => deltas.push(delta),
      });
      assert.equal(result.status, "failed");
      assert.match(result.status === "failed" ? result.error : "", /finish_reason.*length/iu);
      assert.equal(deltas.join(""), "partial stream");
      assert.deepEqual(result.messages, input);
    } finally {
      await loop.release();
    }
  });
});

test("Responses streams text and reconciles a terminal item status from output_item.done", async () => {
  const fetch = scriptedFetch([
    ({ body }) => {
      assert.equal(body.stream, true);
      return responsesTextStream(["responses-", "stream-finished"], "resp-stream-reconciled");
    },
  ]);
  const deltas: string[] = [];
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({
      protocol: "openai_responses",
      baseUrl: OFFICIAL_BASE_URL,
      requestSettings: { stream: true },
    });
    try {
      const result = await loop.execute({
        ...loopInput([
          { role: "system", content: SYSTEM },
          { role: "user", content: "responses should stream" },
        ]),
        onTextDelta: (delta) => deltas.push(delta),
      });
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      assert.equal(result.status === "completed" ? result.finalText : undefined, "responses-stream-finished");
      assert.equal(deltas.join(""), "responses-stream-finished");
    } finally {
      await loop.release();
    }
  });
});

test("Responses matches compacted terminal output by identity and preserves reasoning continuation", async () => {
  const encryptedContinuation = "encrypted-reasoning-after-stream";
  const deltas: string[] = [];
  const fetch = scriptedFetch([
    () => responsesCompactedReasoningTextStream(
      ["流式", "能力展示"],
      "resp-stream-compacted",
      encryptedContinuation,
      7,
    ),
    ({ body }) => {
      const serializedInput = JSON.stringify(body.input);
      assert.match(serializedInput, /resp-stream-compacted-reasoning/u);
      assert.match(serializedInput, new RegExp(encryptedContinuation, "u"));
      return responsesText("continued-with-reasoning", "resp-after-compacted-stream");
    },
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({
      protocol: "openai_responses",
      baseUrl: OFFICIAL_BASE_URL,
      requestSettings: { stream: true },
    });
    try {
      const first = await loop.execute({
        ...loopInput([
          { role: "system", content: SYSTEM },
          { role: "user", content: "show capabilities through a compacted Responses stream" },
        ]),
        onTextDelta: (delta) => deltas.push(delta),
      });
      assert.equal(first.status, "completed", first.status === "failed" ? first.error : undefined);
      assert.equal(first.status === "completed" ? first.finalText : undefined, "流式能力展示");
      assert.equal(deltas.join(""), "流式能力展示");
      const continuation = first.messages.at(-1)
        ?.protocolExtensions?.[OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION];
      assert.equal(Array.isArray(continuation), true);
      assert.match(JSON.stringify(continuation), new RegExp(encryptedContinuation, "u"));

      const second = await loop.execute(loopInput([
        ...first.messages,
        { role: "user", content: "continue with the same reasoning context" },
      ]));
      assert.equal(second.status, "completed", second.status === "failed" ? second.error : undefined);
      assert.equal(second.status === "completed" ? second.finalText : undefined, "continued-with-reasoning");
    } finally {
      await loop.release();
    }
  });
});

test("Responses derives a missing terminal message status from the completed response", async () => {
  const deltas: string[] = [];
  const fetch = scriptedFetch([() => responsesTextStream(
    ["terminal-", "completed"],
    "resp-stream-terminal-completed",
    { includeOutputItemDone: false },
  )]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({
      protocol: "openai_responses",
      baseUrl: OFFICIAL_BASE_URL,
      requestSettings: { stream: true },
    });
    try {
      const result = await loop.execute({
        ...loopInput([
          { role: "system", content: SYSTEM },
          { role: "user", content: "accept the terminal response lifecycle" },
        ]),
        onTextDelta: (delta) => deltas.push(delta),
      });
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      assert.equal(result.status === "completed" ? result.finalText : undefined, "terminal-completed");
      assert.equal(deltas.join(""), "terminal-completed");
    } finally {
      await loop.release();
    }
  });
});

test("Responses reports a streamed incomplete outcome without persisting partial output", async () => {
  const input = [
    { role: "system", content: SYSTEM },
    { role: "user", content: "produce an intentionally limited response" },
  ] as const;
  const deltas: string[] = [];
  const fetch = scriptedFetch([() => responsesTextStream(
    ["partial-", "stream"],
    "resp-stream-incomplete",
    {
      includeOutputItemDone: false,
      terminalStatus: "incomplete",
      incompleteReason: "max_output_tokens",
    },
  )]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({
      protocol: "openai_responses",
      baseUrl: OFFICIAL_BASE_URL,
      requestSettings: { stream: true },
    });
    try {
      const result = await loop.execute({
        ...loopInput(input),
        onTextDelta: (delta) => deltas.push(delta),
      });
      assert.equal(result.status, "failed");
      assert.match(result.status === "failed" ? result.error : "", /incomplete.*max_output_tokens/iu);
      assert.doesNotMatch(result.status === "failed" ? result.error : "", /invalid option|invalid_value/iu);
      assert.equal(deltas.join(""), "partial-stream");
      assert.deepEqual(result.messages, input);
    } finally {
      await loop.release();
    }
  });
});

test("Responses rejects an explicit invalid terminal message status", async () => {
  const fetch = scriptedFetch([() => responsesTextStream(
    ["invalid-status"],
    "resp-stream-invalid-status",
    {
      includeOutputItemDone: false,
      terminalItemStatus: "finished",
    },
  )]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({
      protocol: "openai_responses",
      baseUrl: OFFICIAL_BASE_URL,
      requestSettings: { stream: true },
    });
    try {
      const result = await loop.execute({
        ...loopInput([
          { role: "system", content: SYSTEM },
          { role: "user", content: "surface a conflicting provider status" },
        ]),
        onTextDelta: () => undefined,
      });
      assert.equal(result.status, "failed");
      assert.match(result.status === "failed" ? result.error : "", /invalid message status "finished"/iu);
    } finally {
      await loop.release();
    }
  });
});

test("Responses executes a compacted streamed function call and pairs its result", async () => {
  const gateway = new TestGateway(plainTool("read_fact"));
  const deltas: string[] = [];
  const fetch = scriptedFetch([
    () => responsesToolStream("call-streamed-read", "read_fact", { value: "streamed" }),
    ({ body }) => {
      const serializedInput = JSON.stringify(body.input);
      assert.match(serializedInput, /call-streamed-read/u);
      assert.match(serializedInput, /gateway-completed/u);
      return responsesTextStream(["tool-", "stream-finished"], "resp-after-streamed-tool");
    },
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({
      protocol: "openai_responses",
      baseUrl: OFFICIAL_BASE_URL,
      requestSettings: { stream: true },
    });
    try {
      const result = await loop.execute({
        ...loopInput([
          { role: "system", content: SYSTEM },
          { role: "user", content: "read a fact through a streamed tool call" },
        ], gateway),
        onTextDelta: (delta) => deltas.push(delta),
      });
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      assert.equal(result.status === "completed" ? result.finalText : undefined, "tool-stream-finished");
      assert.equal(deltas.join(""), "tool-stream-finished");
      assert.deepEqual(gateway.executions.map(({ request }) => request.callId), ["call-streamed-read"]);
      assert.equal(result.messages.some((message) => message.toolCallId === "call-streamed-read"), true);
    } finally {
      await loop.release();
    }
  });
});

test("Responses preserves a streamed provider failure instead of reporting an output schema error", async () => {
  const fetch = scriptedFetch([() => responsesFailedStream(
    "resp-stream-failed",
    "provider_overloaded",
    "The provider could not complete the response.",
  )]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({
      protocol: "openai_responses",
      baseUrl: OFFICIAL_BASE_URL,
      requestSettings: { stream: true },
    });
    try {
      const result = await loop.execute({
        ...loopInput([
          { role: "system", content: SYSTEM },
          { role: "user", content: "surface the provider failure" },
        ]),
        onTextDelta: () => undefined,
      });
      assert.equal(result.status, "failed");
      assert.match(
        result.status === "failed" ? result.error : "",
        /Responses stream failed \(provider_overloaded\).*could not complete/iu,
      );
      assert.doesNotMatch(result.status === "failed" ? result.error : "", /invalid_value|invalid option/iu);
    } finally {
      await loop.release();
    }
  });
});

test("Responses rejects incomplete max-output responses without persisting partial assistant text", async () => {
  const fetch = scriptedFetch([() => responsesText("partial response", "response-incomplete", undefined, {
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
  })]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({ protocol: "openai_responses", baseUrl: OFFICIAL_BASE_URL });
    try {
      const input = [
        { role: "system", content: SYSTEM },
        { role: "user", content: "write a long response" },
      ] as const;
      const result = await loop.execute(loopInput(input));
      assert.equal(result.status, "failed");
      assert.match(result.status === "failed" ? result.error : "", /incomplete.*max_output_tokens/iu);
      assert.deepEqual(result.messages, input);
      assert.equal(result.messages.some((message) => message.content.includes("partial response")), false);
    } finally {
      await loop.release();
    }
  });
});

test("compatible provider profiles apply their frozen request dialects and safe streaming fallbacks", async () => {
  const cases: readonly {
    readonly profile: NonNullable<OpenAIAgentsLoopConfig["providerProfileId"]>;
    readonly model: string;
    readonly settings: NonNullable<OpenAIAgentsLoopConfig["requestSettings"]>;
    readonly withTextDelta?: boolean;
    readonly assertBody: (body: JsonRecord) => void;
  }[] = [{
    profile: "deepseek",
    model: "deepseek-v4-pro",
    settings: { reasoningEffort: "high", temperature: 0.2, topP: 0.8 },
    assertBody: (body) => {
      assert.deepEqual(body.thinking, { type: "enabled" });
      assert.equal(body.reasoning_effort, "high", JSON.stringify(body));
      assert.equal(body.temperature, undefined);
      assert.equal(body.top_p, undefined);
    },
  }, {
    profile: "moonshot",
    model: "kimi-k3",
    settings: { reasoningEffort: "high", temperature: 0.2, topP: 0.8 },
    assertBody: (body) => {
      assert.equal(body.reasoning_effort, "max");
      assert.equal(body.thinking, undefined);
      assert.equal(body.temperature, undefined);
      assert.equal(body.top_p, undefined);
    },
  }, {
    profile: "moonshot",
    model: "kimi-k2.6",
    settings: { reasoningEffort: "high", temperature: 0.2, topP: 0.8 },
    assertBody: (body) => {
      assert.deepEqual(body.thinking, { type: "enabled" });
      assert.equal(body.temperature, undefined);
      assert.equal(body.top_p, undefined);
      assert.equal(body.reasoning_effort, undefined);
    },
  }, {
    profile: "glm",
    model: "glm-4.5",
    settings: { reasoningEffort: "high", stream: true },
    withTextDelta: true,
    assertBody: (body) => {
      assert.deepEqual(body.thinking, { type: "disabled" });
      assert.equal(body.stream === undefined || body.stream === false, true);
    },
  }, {
    profile: "glm",
    model: "glm-5.1",
    settings: { reasoningEffort: "high" },
    assertBody: (body) => {
      assert.deepEqual(body.thinking, { type: "enabled" });
      assert.equal(body.reasoning_effort, undefined);
    },
  }, {
    profile: "minimax",
    model: "MiniMax-M2.7",
    settings: { stream: true },
    withTextDelta: true,
    assertBody: (body) => {
      assert.equal(body.reasoning_split, true);
      assert.equal(body.stream === undefined || body.stream === false, true);
    },
  }];

  for (const entry of cases) {
    const fetch = scriptedFetch([() => chatText(`${entry.profile}-finished`)]);
    await withGlobalFetch(fetch.fetch, async () => {
      const loop = createLoop({
        protocol: "openai_compatible_chat_completions",
        baseUrl: CHAT_BASE_URL,
        providerProfileId: entry.profile,
        model: entry.model,
        requestSettings: entry.settings,
      });
      try {
        const result = await loop.execute({
          ...loopInput([{ role: "system", content: SYSTEM }, { role: "user", content: "profile request" }]),
          onTextDelta: entry.withTextDelta === true ? () => undefined : undefined,
        });
        assert.equal(
          result.status,
          "completed",
          `${entry.profile}/${entry.model}: ${result.status === "failed" ? result.error : "unexpected status"}`,
        );
      } finally {
        await loop.release();
      }
    });
    assert.ok(fetch.requests[0]);
    entry.assertBody(fetch.requests[0].body);
  }
});

test("compatible provider continuation survives one tool round-trip and enters canonical history", async () => {
  const gateway = new TestGateway(plainTool("inspect_provider_fact"));
  const fetch = scriptedFetch([
    () => chatToolWithContinuation(
      "call-provider-continuation",
      "inspect_provider_fact",
      { value: "evidence" },
      { reasoning_content: "provider-private continuation" },
    ),
    ({ body }) => {
      const messages = Array.isArray(body.messages) ? body.messages.map(parseRecord) : [];
      const assistant = messages.find((message) =>
        message.role === "assistant" && Array.isArray(message.tool_calls));
      assert.equal(assistant?.reasoning_content, "provider-private continuation");
      return chatText("provider-round-trip-finished");
    },
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({
      protocol: "openai_compatible_chat_completions",
      baseUrl: CHAT_BASE_URL,
      providerProfileId: "deepseek",
      model: "deepseek-v4-pro",
    });
    try {
      const result = await loop.execute(loopInput([
        { role: "system", content: SYSTEM },
        { role: "user", content: "inspect then continue" },
      ], gateway));
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      const assistant = result.messages.find((message) =>
        message.toolCalls?.[0]?.callId === "call-provider-continuation");
      assert.deepEqual(assistant?.protocolExtensions, {
        reasoning_content: "provider-private continuation",
      });
    } finally {
      await loop.release();
    }
  });
});

test("streaming compatible provider continuation survives a tool round-trip", async () => {
  const gateway = new TestGateway(plainTool("inspect_streamed_fact"));
  const fetch = scriptedFetch([
    () => chatToolStreamWithContinuation(
      "call-streamed-continuation",
      "inspect_streamed_fact",
      { value: "streamed" },
      ["provider-", "stream-continuation"],
    ),
    ({ body }) => {
      const messages = Array.isArray(body.messages) ? body.messages.map(parseRecord) : [];
      const assistant = messages.find((message) =>
        message.role === "assistant" && Array.isArray(message.tool_calls));
      assert.equal(assistant?.reasoning_content, "provider-stream-continuation");
      return chatTextStream(["streamed-finished"]);
    },
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({
      protocol: "openai_compatible_chat_completions",
      baseUrl: CHAT_BASE_URL,
      providerProfileId: "deepseek",
      model: "deepseek-v4-pro",
      requestSettings: { stream: true },
    });
    try {
      const result = await loop.execute({
        ...loopInput([
          { role: "system", content: SYSTEM },
          { role: "user", content: "stream provider continuation" },
        ], gateway),
        onTextDelta: () => undefined,
      });
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      const assistant = result.messages.find((message) =>
        message.toolCalls?.[0]?.callId === "call-streamed-continuation");
      assert.equal(
        assistant?.protocolExtensions?.reasoning_content,
        "provider-stream-continuation",
      );
    } finally {
      await loop.release();
    }
  });
});

test("tool approval pauses before execution and approve resumes the exact call once", async () => {
  const gateway = new TestGateway(gatedTool());
  const fetch = scriptedFetch([
    () => chatTool("call-approved", "write_fact", { value: "approved" }),
    ({ body }) => {
      assert.match(JSON.stringify(body.messages), /call-approved/u);
      assert.match(JSON.stringify(body.messages), /gateway-completed/u);
      return chatText("approved-final");
    },
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL });
    try {
      const paused = await loop.execute(loopInput([
        { role: "system", content: SYSTEM },
        { role: "user", content: "use the gated tool" },
      ], gateway, ["existing-confirmation"]));
      assert.equal(paused.status, "approval_required");
      assert.equal(gateway.executions.length, 0);
      assert.deepEqual(paused.messages.map((message) => message.role), ["system", "user", "assistant"]);
      assert.deepEqual(paused.messages.at(-1)?.toolCalls, [{
        callId: "call-approved",
        toolName: "write_fact",
        input: { value: "approved" },
      }]);
      if (paused.status !== "approval_required") return;
      const confirmation = paused.confirmationRequests[0];
      assert.equal(confirmation?.confirmationId, "confirmation-call-approved");
      assert.equal(confirmation?.toolCallFactId, "call-approved");
      const resumed = await paused.continuation.decide({
        decision: decision(confirmation!.confirmationId, "approve_once"),
        abortSignal: new AbortController().signal,
      });
      assert.equal(resumed.status, "completed");
      assert.equal(gateway.executions.length, 1);
      assert.deepEqual(gateway.executions[0]?.permission.approvedConfirmationIds, [
        "existing-confirmation",
        "confirmation-call-approved",
      ]);
      assert.deepEqual(resumed.toolResults.map((result) => result.status), ["approval_required", "completed"]);
      assert.equal(resumed.messages.filter((message) => message.toolCallId === "call-approved").length, 1);
    } finally {
      await loop.release();
    }
  });
});

test("multiple confirmations can be decided sequentially without executing or replaying unresolved calls", async () => {
  const gateway = new TestGateway([gatedTool("write_first"), gatedTool("write_second")]);
  const fetch = scriptedFetch([
    () => chatTools([
      { callId: "call-first", name: "write_first", input: { value: "first" } },
      { callId: "call-second", name: "write_second", input: { value: "second" } },
    ]),
    ({ body }) => {
      const serialized = JSON.stringify(body.messages);
      assert.match(serialized, /call-first/u);
      assert.match(serialized, /use read-only evidence/u);
      return chatText("sequential-final");
    },
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL });
    try {
      const paused = await loop.execute(loopInput([
        { role: "system", content: SYSTEM },
        { role: "user", content: "perform two writes" },
      ], gateway));
      assert.equal(paused.status, "approval_required");
      if (paused.status !== "approval_required") return;
      assert.deepEqual(paused.confirmationRequests.map((request) => request.confirmationId), [
        "confirmation-call-first",
        "confirmation-call-second",
      ]);
      const stillPaused = await paused.continuation.decide({
        decision: decision("confirmation-call-first", "approve_once"),
        abortSignal: new AbortController().signal,
      });
      assert.equal(stillPaused.status, "approval_required");
      assert.equal(gateway.executions.length, 0);
      assert.equal(fetch.requests.length, 1);
      if (stillPaused.status !== "approval_required") return;
      assert.deepEqual(stillPaused.confirmationRequests.map((request) => request.confirmationId), [
        "confirmation-call-second",
      ]);
      const completed = await stillPaused.continuation.decide({
        decision: decision("confirmation-call-second", "guidance", "use read-only evidence"),
        abortSignal: new AbortController().signal,
      });
      assert.equal(completed.status, "completed", completed.status === "failed" ? completed.error : undefined);
      assert.deepEqual(gateway.executions.map(({ request }) => request.callId), ["call-first"]);
      assert.equal(fetch.requests.length, 2);
    } finally {
      await loop.release();
    }
  });
});

test("multiple confirmations accept one validated batch and execute every approved call once", async () => {
  const gateway = new TestGateway([gatedTool("write_first"), gatedTool("write_second")]);
  const fetch = scriptedFetch([
    () => chatTools([
      { callId: "call-batch-first", name: "write_first", input: { value: "first" } },
      { callId: "call-batch-second", name: "write_second", input: { value: "second" } },
    ]),
    () => chatText("batch-final"),
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL });
    try {
      const paused = await loop.execute(loopInput([
        { role: "system", content: SYSTEM },
        { role: "user", content: "perform two approved writes" },
      ], gateway));
      assert.equal(paused.status, "approval_required");
      if (paused.status !== "approval_required") return;
      const completed = await paused.continuation.decide({
        decisions: paused.confirmationRequests.map((request) => decision(request.confirmationId, "approve_once")),
        abortSignal: new AbortController().signal,
      });
      assert.equal(completed.status, "completed", completed.status === "failed" ? completed.error : undefined);
      assert.deepEqual(gateway.executions.map(({ request }) => request.callId).sort(), [
        "call-batch-first",
        "call-batch-second",
      ]);
      assert.equal(new Set(gateway.executions.map(({ request }) => request.callId)).size, 2);
    } finally {
      await loop.release();
    }
  });
});

test("an allowed tool executes once through the gateway and returns the complete fact to the model", async () => {
  const definition: ToolDefinition = {
    ...plainTool("read_fact"),
    modelContract: { outputNotes: ["MODEL_CONTRACT_OUTPUT_SENTINEL"] },
  };
  const recordedGateway = new TestGateway(definition);
  const gateway: ToolExecutionGateway = {
    list: () => recordedGateway.list(),
    has: (name) => recordedGateway.has(name),
    preflight: (request, context, permission) => recordedGateway.preflight(request, context, permission),
    execute: async (request, context, permission) => {
      context.reportProgress?.({
        kind: "command_output",
        stdoutTail: "live evidence",
        stdoutChars: 13,
        stderrChars: 0,
      });
      return recordedGateway.execute(request, context, permission);
    },
  };
  const fetch = scriptedFetch([
    () => chatTool("call-read-once", "read_fact", { value: "one" }),
    () => chatText("tool-final"),
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL });
    try {
      const requested: string[] = [];
      const progress: string[] = [];
      const result = await loop.execute({ ...loopInput([
        { role: "system", content: SYSTEM },
        { role: "user", content: "read one fact" },
      ], gateway),
        onToolRequested: (request) => requested.push(request.callId),
        onToolProgress: (update) => progress.push(update.progress.kind),
      });
      assert.match(JSON.stringify(fetch.requests[0]?.body.tools), /MODEL_CONTRACT_OUTPUT_SENTINEL/u);
      const modelToolResult = JSON.stringify(fetch.requests[1]?.body.messages);
      for (const fact of ["call-read-once", "read_fact", "gateway-completed", "completed"]) {
        assert.match(modelToolResult, new RegExp(fact, "u"));
      }
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      assert.equal(recordedGateway.executions.length, 1);
      assert.deepEqual(requested, ["call-read-once"]);
      assert.deepEqual(progress, ["command_output"]);
      assert.deepEqual(result.toolResults, [{
        callId: "call-read-once",
        toolName: "read_fact",
        input: { value: "one" },
        output: { result: "gateway-completed" },
        status: "completed",
        durationMs: 1,
      }]);
    } finally {
      await loop.release();
    }
  });
});

test("non-portable tool identities fail before the provider request instead of requiring runtime remapping", async () => {
  const canonicalToolName = "mcp__query-docs";
  const gateway = new TestGateway(plainTool(canonicalToolName));
  const fetch = scriptedFetch([]);
  const loop = createLoop({
    protocol: "openai_responses",
    baseUrl: OFFICIAL_BASE_URL,
    fetch: fetch.fetch,
  });
  try {
    const result = await loop.execute({
      ...loopInput([
        { role: "system", content: SYSTEM },
        { role: "user", content: "query docs" },
      ], gateway),
    });

    assert.equal(result.status, "failed");
    assert.match(result.status === "failed" ? result.error : "", /not provider-portable/u);
    assert.equal(fetch.requests.length, 0);
    assert.equal(gateway.executions.length, 0);
  } finally {
    await loop.release();
  }
});

test("context maintenance runs before every model request and persists the compacted request history", async () => {
  const gateway = new TestGateway([plainTool("read_first"), plainTool("read_second")]);
  const maintained: ModelMessage[][] = [];
  const fetch = scriptedFetch([
    () => chatTools([
      { callId: "call-context-first", name: "read_first", input: { value: "first" } },
      { callId: "call-context-second", name: "read_second", input: { value: "second" } },
    ]),
    ({ body }) => {
      const serialized = JSON.stringify(body.messages);
      assert.match(serialized, /# Compacted Context/u);
      assert.equal(serialized.includes("call-context-first"), false);
      assert.equal(serialized.includes("call-context-second"), false);
      return chatText("context-final");
    },
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL });
    try {
      const result = await loop.execute({
        ...loopInput([
          { role: "system", content: SYSTEM },
          { role: "user", content: "inspect both sources" },
        ], gateway),
        maintainContext: async ({ messages }) => {
          maintained.push(messages.map((message) => structuredClone(message)));
          if (maintained.length === 1) return { status: "unchanged" };
          assert.deepEqual(messages.at(-3)?.toolCalls?.map((call) => call.callId), [
            "call-context-first",
            "call-context-second",
          ]);
          assert.deepEqual(messages.slice(-2).map((message) => message.toolCallId), [
            "call-context-first",
            "call-context-second",
          ]);
          return {
            status: "compacted",
            messages: [
              { role: "system", content: SYSTEM },
              { role: "user", content: "# Compacted Context\nBoth sources were inspected." },
            ],
          };
        },
      });
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      assert.equal(maintained.length, 2);
      assert.deepEqual(result.messages.map((message) => message.role), ["system", "user", "assistant"]);
      assert.equal(result.messages.some((message) => message.toolCallId !== undefined), false);
      assert.equal(result.messages.at(-1)?.content, "context-final");
    } finally {
      await loop.release();
    }
  });
});

test("unchanged context maintenance preserves local message refs and attachment identity", async () => {
  const fetch = scriptedFetch([() => chatText("metadata-preserved")]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL });
    try {
      const messages: readonly ModelMessage[] = [
        { role: "system", content: SYSTEM, ref: "system:stable" },
        {
          role: "user",
          content: "inspect attachment metadata",
          ref: "user:current",
          attachments: [{
            kind: "image",
            source: { kind: "url", url: "https://example.test/context.png" },
            attachmentId: "attachment-stable",
            detail: "high",
          }],
        },
      ];
      const result = await loop.execute({
        ...loopInput(messages),
        maintainContext: async ({ messages: requestMessages }) => {
          assert.equal(requestMessages[0]?.ref, "system:stable");
          assert.equal(requestMessages[1]?.ref, "user:current");
          assert.equal(requestMessages[1]?.attachments?.[0]?.attachmentId, "attachment-stable");
          return { status: "unchanged" };
        },
      });
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      assert.equal(result.messages[0]?.ref, "system:stable");
      assert.equal(result.messages[1]?.ref, "user:current");
      assert.equal(result.messages[1]?.attachments?.[0]?.attachmentId, "attachment-stable");
    } finally {
      await loop.release();
    }
  });
});

test("context maintenance failure stops the next provider request and preserves completed tool facts", async () => {
  const gateway = new TestGateway(plainTool("read_before_compaction"));
  const fetch = scriptedFetch([
    () => chatTool("call-before-compaction", "read_before_compaction", { value: "evidence" }),
  ]);
  let maintenanceCalls = 0;
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL });
    try {
      const result = await loop.execute({
        ...loopInput([
          { role: "system", content: SYSTEM },
          { role: "user", content: "inspect then continue" },
        ], gateway),
        maintainContext: async () => {
          maintenanceCalls += 1;
          return maintenanceCalls === 1
            ? { status: "unchanged" }
            : {
                status: "failed",
                code: "context_compaction_failed",
                error: "Context compaction failed before the next request.",
              };
        },
      });
      assert.equal(result.status, "failed");
      assert.match(result.status === "failed" ? result.error : "", /context compaction failed/iu);
      assert.equal(result.status === "failed" ? result.errorCode : undefined, "context_compaction_failed");
      assert.equal(fetch.requests.length, 1);
      assert.equal(result.messages.filter((message) => message.toolCalls?.[0]?.callId === "call-before-compaction").length, 1);
      assert.equal(result.messages.filter((message) => message.toolCallId === "call-before-compaction").length, 1);
      assert.equal(result.toolResults.some((toolResult) => toolResult.status === "completed"), true);
    } finally {
      await loop.release();
    }
  });
});

for (const decisionKind of ["deny", "guidance"] as const) {
  test(`tool ${decisionKind} resumes through SDK rejection without executing the gateway`, async () => {
    const gateway = new TestGateway(gatedTool());
    let providerToolOutput: string | undefined;
    const fetch = scriptedFetch([
      () => chatTool(`call-${decisionKind}`, "write_fact", { value: decisionKind }),
      ({ body }) => {
        const serialized = JSON.stringify(body.messages);
        assert.match(serialized, decisionKind === "guidance" ? /use read-only evidence/u : /rejected this tool/u);
        providerToolOutput = chatToolOutput(body, `call-${decisionKind}`);
        return chatText(`${decisionKind}-final`);
      },
    ]);
    await withGlobalFetch(fetch.fetch, async () => {
      const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL });
      try {
        const paused = await loop.execute(loopInput([
          { role: "system", content: SYSTEM },
          { role: "user", content: "request gated work" },
        ], gateway));
        assert.equal(paused.status, "approval_required");
        if (paused.status !== "approval_required") return;
        const resumed = await paused.continuation.decide({
          decision: decision(
            paused.confirmationRequests[0]!.confirmationId,
            decisionKind,
            decisionKind === "guidance" ? "use read-only evidence" : undefined,
          ),
          abortSignal: new AbortController().signal,
        });
        assert.equal(resumed.status, "completed");
        assert.equal(gateway.executions.length, 0);
        assert.deepEqual(resumed.toolResults.map((result) => result.status), ["approval_required", "cancelled"]);
        assert.equal(
          providerToolOutput,
          resumed.messages.find((message) => message.toolCallId === `call-${decisionKind}`)?.content,
        );
      } finally {
        await loop.release();
      }
    });
  });
}

test("provider failure after a completed tool preserves the exact canonical tool exchange", async () => {
  const gateway = new TestGateway(plainTool("read_fact"));
  let providerToolOutput: string | undefined;
  const fetch = scriptedFetch([
    () => chatTool("call-before-provider-failure", "read_fact", { value: "one" }),
    ({ body }) => {
      providerToolOutput = chatToolOutput(body, "call-before-provider-failure");
      throw new Error("provider failed after tool result");
    },
  ]);
  const loop = createLoop({
    protocol: "openai_compatible_chat_completions",
    baseUrl: CHAT_BASE_URL,
    fetch: fetch.fetch,
    requestSettings: { stream: false },
  });
  try {
    const result = await loop.execute(loopInput([
      { role: "system", content: SYSTEM },
      { role: "user", content: "read before failure" },
    ], gateway));
    assert.equal(result.status, "failed");
    const canonical = result.messages.find((message) => message.toolCallId === "call-before-provider-failure");
    assert.equal(canonical?.content, providerToolOutput);
    assert.deepEqual(result.messages.map((message) => message.role), ["system", "user", "assistant", "tool"]);
  } finally {
    await loop.release();
  }
});

test("abort after a completed tool preserves the exact canonical tool exchange", async () => {
  const gateway = new TestGateway(plainTool("read_fact"));
  const controller = new AbortController();
  let markSecondStarted: (() => void) | undefined;
  const secondStarted = new Promise<void>((resolve) => { markSecondStarted = resolve; });
  let providerToolOutput: string | undefined;
  const fetch = scriptedFetch([
    () => chatTool("call-before-provider-abort", "read_fact", { value: "one" }),
    async ({ body, signal }) => {
      providerToolOutput = chatToolOutput(body, "call-before-provider-abort");
      markSecondStarted?.();
      return rejectWhenAborted(signal ?? undefined);
    },
  ]);
  const loop = createLoop({
    protocol: "openai_compatible_chat_completions",
    baseUrl: CHAT_BASE_URL,
    fetch: fetch.fetch,
    requestSettings: { stream: false },
  });
  try {
    const resultPromise = loop.execute({
      ...loopInput([
        { role: "system", content: SYSTEM },
        { role: "user", content: "read before abort" },
      ], gateway),
      abortSignal: controller.signal,
    });
    await secondStarted;
    controller.abort("cancel after tool result");
    const result = await resultPromise;
    assert.equal(result.status, "cancelled");
    const canonical = result.messages.find((message) => message.toolCallId === "call-before-provider-abort");
    assert.equal(canonical?.content, providerToolOutput);
    assert.deepEqual(result.messages.map((message) => message.role), ["system", "user", "assistant", "tool"]);
  } finally {
    await loop.release();
  }
});

test("model cancellation returns cancelled and aborts the provider request", async () => {
  let requestSignal: AbortSignal | null | undefined;
  let markRequestStarted!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });
  const fetchImpl: typeof globalThis.fetch = async (_input, init) => {
    requestSignal = init?.signal;
    markRequestStarted();
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(abortError()), { once: true });
    });
  };
  await withGlobalFetch(fetchImpl, async () => {
    const loop = createLoop({ protocol: "openai_responses", baseUrl: OFFICIAL_BASE_URL });
    const controller = new AbortController();
    try {
      const running = loop.execute(loopInput([
        { role: "system", content: SYSTEM },
        { role: "user", content: "wait" },
      ], new TestGateway(), [], controller.signal));
      await requestStarted;
      controller.abort();
      const result = await running;
      assert.equal(result.status, "cancelled");
      assert.equal(requestSignal?.aborted, true);
    } finally {
      await loop.release();
    }
  });
});

test("tool cancellation uses the current typed execution-context signal", async () => {
  let resolveStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  let observedSignal: AbortSignal | undefined;
  const definition = plainTool("wait_for_abort");
  const gateway: ToolExecutionGateway = {
    list: () => [definition],
    has: (name) => name === definition.name,
    preflight: (request) => ({ status: "ready", request }),
    execute: async (request, context) => {
      observedSignal = context.abortSignal;
      resolveStarted();
      await rejectWhenAborted(context.abortSignal);
      return {
        ...request,
        output: undefined,
        status: "cancelled",
        durationMs: 0,
      };
    },
  };
  const fetch = scriptedFetch([
    () => chatTool("call-abort-tool", "wait_for_abort", { value: "wait" }),
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL });
    const controller = new AbortController();
    try {
      const running = loop.execute(loopInput([
        { role: "system", content: SYSTEM },
        { role: "user", content: "wait in a tool" },
      ], gateway, [], controller.signal));
      await started;
      controller.abort();
      const result = await running;
      assert.equal(result.status, "cancelled");
      assert.equal(observedSignal, controller.signal);
      assert.equal(observedSignal?.aborted, true);
    } finally {
      await loop.release();
    }
  });
});

test("release is idempotent and rejects later execution", async () => {
  const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL });
  await loop.release();
  await loop.release();
  await assert.rejects(
    loop.execute(loopInput([{ role: "system", content: SYSTEM }, { role: "user", content: "too late" }])),
    /released/u,
  );
});

test("compatible Chat rejects Responses-only settings instead of silently dropping them", () => {
  assert.throws(() => createOpenAIAgentsLoop({
    protocol: "openai_compatible_chat_completions",
    baseUrl: CHAT_BASE_URL,
    apiKey: "test-key",
    model: MODEL,
    requestSettings: { reasoningSummary: "auto", truncation: "disabled" },
  }), /reasoningSummary, truncation/u);
});

test("cache identity is independent of tool order and changes with protocol", () => {
  const left = openAIAgentsPromptCacheKey("openai_responses", MODEL, SYSTEM, [plainTool("b"), plainTool("a")]);
  const right = openAIAgentsPromptCacheKey("openai_responses", MODEL, SYSTEM, [plainTool("a"), plainTool("b")]);
  const chat = openAIAgentsPromptCacheKey("openai_compatible_chat_completions", MODEL, SYSTEM, [plainTool("a"), plainTool("b")]);
  assert.equal(left, right);
  assert.notEqual(left, chat);
});

class TestGateway implements ToolExecutionGateway {
  readonly preflights: ToolCallRequest[] = [];
  readonly executions: Array<{
    readonly request: ToolCallRequest;
    readonly context: ToolExecutionContext;
    readonly permission: ToolPermissionCheck;
  }> = [];

  private readonly definitions: readonly ToolDefinition[];

  constructor(definitions?: ToolDefinition | readonly ToolDefinition[]) {
    this.definitions = definitions === undefined
      ? []
      : Array.isArray(definitions)
        ? definitions
        : [definitions];
  }

  list(): ToolDefinition[] {
    return this.definitions.map((definition) => globalThis.structuredClone(definition));
  }

  has(name: string): boolean {
    return this.definitions.some((definition) => definition.name === name);
  }

  preflight(
    request: ToolCallRequest,
    _context: ToolExecutionContext,
    _permission: ToolPermissionCheck,
  ): ToolExecutionPreflight {
    this.preflights.push(globalThis.structuredClone(request));
    if (this.definitions.find((definition) => definition.name === request.toolName)?.metadata?.requiresConfirmation === true) {
      return {
        status: "approval_required",
        result: {
          ...request,
          output: undefined,
          status: "approval_required",
          durationMs: 0,
          confirmationRequest: {
            confirmationId: `confirmation-${request.callId}`,
            toolCallFactId: request.factId ?? request.callId,
            title: "Confirm write",
            actionSummary: "Write the requested fact.",
            affectedResources: ["test-resource"],
            riskLevel: "medium",
            resumeAvailability: "live",
            requestedAt: "2026-07-15T00:00:00.000Z",
            sourceRefs: [`tool:${request.callId}`],
          },
        },
      };
    }
    return { status: "ready", request };
  }

  async execute(
    request: ToolCallRequest,
    context: ToolExecutionContext,
    permission: ToolPermissionCheck,
  ): Promise<ToolCallResult> {
    this.executions.push({ request, context, permission });
    return {
      ...request,
      output: { result: "gateway-completed" },
      status: "completed",
      durationMs: 1,
    };
  }
}

function createLoop(
  input: Pick<OpenAIAgentsLoopConfig, "protocol" | "baseUrl"> &
    Partial<Pick<OpenAIAgentsLoopConfig, "requestSettings" | "providerProfileId" | "enableWebSearch" | "fetch" | "model">>,
) {
  return createOpenAIAgentsLoop({ ...input, apiKey: "test-key", model: input.model ?? MODEL });
}

function loopInput(
  messages: readonly ModelMessage[],
  gateway: ToolExecutionGateway = new TestGateway(),
  existingApprovals: readonly string[] = [],
  abortSignal = new AbortController().signal,
) {
  const allowedTools = gateway.list().map((definition) => definition.name);
  return {
    instructions: SYSTEM,
    messages,
    tools: {
      gateway,
      context: {
        callerAgentId: "ordinary-agent",
        traceId: "trace-test",
        goalId: "goal-test",
      },
      permission: {
        callerAgentId: "ordinary-agent",
        allowedTools,
        approvedConfirmationIds: existingApprovals,
        confirmationPolicy: "prompt" as const,
      },
    },
    abortSignal,
  };
}

function gatedTool(name = "write_fact"): ToolDefinition {
  return writeTool(name, true);
}

function writeTool(name: string, requiresConfirmation: boolean): ToolDefinition {
  return {
    ...plainTool(name),
    metadata: {
      category: "filesystem",
      riskLevel: requiresConfirmation ? "medium" : "low",
      operationType: "read-write",
      requiresConfirmation,
    },
  };
}

function plainTool(name: string): ToolDefinition {
  return {
    name,
    description: `Execute ${name}.`,
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
    metadata: {
      category: "other",
      riskLevel: "low",
      operationType: "read-only",
      requiresConfirmation: false,
    },
  };
}

function decision(
  confirmationId: string,
  kind: ConfirmationDecision["decision"],
  guidance?: string,
): ConfirmationDecision {
  return {
    confirmationId,
    decision: kind,
    decidedAt: "2026-07-15T00:00:01.000Z",
    guidance,
  };
}

function scriptedFetch(
  steps: readonly ((request: CapturedFetch) => Response | Promise<Response>)[],
): { readonly requests: CapturedFetch[]; readonly fetch: typeof globalThis.fetch } {
  const remaining = [...steps];
  const requests: CapturedFetch[] = [];
  return {
    requests,
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body = parseRecord(await request.clone().json());
      const captured = { url: request.url, body, signal: request.signal };
      requests.push(captured);
      const step = remaining.shift();
      if (step === undefined) {
        throw new Error(`Unexpected fetch: ${request.url}`);
      }
      return await step(captured);
    },
  };
}

function chatToolOutput(body: JsonRecord, callId: string): string | undefined {
  if (!Array.isArray(body.messages)) return undefined;
  const message = body.messages.map(parseRecord).find((item) =>
    item.role === "tool" && item.tool_call_id === callId);
  return typeof message?.content === "string" ? message.content : undefined;
}

async function withGlobalFetch<T>(fetchImpl: typeof globalThis.fetch, run: () => Promise<T>): Promise<T> {
  const previous = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = previous;
  }
}

function chatText(text: string, usage: JsonRecord = {
  prompt_tokens: 3,
  completion_tokens: 2,
  total_tokens: 5,
}): Response {
  return chatTextWithFinishReason(text, "stop", usage);
}

function chatTextWithFinishReason(
  text: string,
  finishReason: string,
  usage: JsonRecord = { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
): Response {
  return jsonResponse({
    id: `chat-${text}`,
    object: "chat.completion",
    created: 1,
    model: MODEL,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: finishReason }],
    usage,
  });
}

function chatRefusal(refusal: string): Response {
  return jsonResponse({
    id: "chat-refusal",
    object: "chat.completion",
    created: 1,
    model: MODEL,
    choices: [{
      index: 0,
      message: { role: "assistant", content: null, refusal },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
}

function chatTool(callId: string, name: string, input: JsonRecord): Response {
  return chatTools([{ callId, name, input }]);
}

function chatToolWithFinishReason(
  callId: string,
  name: string,
  input: JsonRecord,
  finishReason: string,
): Response {
  return jsonResponse({
    id: `chat-${callId}`,
    object: "chat.completion",
    created: 1,
    model: MODEL,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: callId,
          type: "function",
          function: { name, arguments: JSON.stringify(input) },
        }],
      },
      finish_reason: finishReason,
    }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
}

function chatToolWithContinuation(
  callId: string,
  name: string,
  input: JsonRecord,
  continuation: JsonRecord,
): Response {
  return jsonResponse({
    id: `chat-${callId}`,
    object: "chat.completion",
    created: 1,
    model: MODEL,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: "Inspecting the provider fact.",
        ...continuation,
        tool_calls: [{
          id: callId,
          type: "function",
          function: { name, arguments: JSON.stringify(input) },
        }],
      },
      finish_reason: "tool_calls",
    }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
}

function chatTools(calls: readonly {
  readonly callId: string;
  readonly name: string;
  readonly input: JsonRecord;
}[]): Response {
  return jsonResponse({
    id: `chat-${calls.map(({ callId }) => callId).join("-")}`,
    object: "chat.completion",
    created: 1,
    model: MODEL,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: calls.map(({ callId, name, input }) => ({
          id: callId,
          type: "function",
          function: { name, arguments: JSON.stringify(input) },
        })),
      },
      finish_reason: "tool_calls",
    }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
}

function responsesTool(callId: string, name: string, input: JsonRecord): Response {
  return responsesToolWithStatus(callId, name, input, "completed");
}

function responsesTools(calls: readonly {
  readonly callId: string;
  readonly name: string;
  readonly input: JsonRecord;
}[]): Response {
  return jsonResponse({
    id: `response-${calls.map(({ callId }) => callId).join("-")}`,
    status: "completed",
    usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    output: calls.map(({ callId, name, input }) => ({
      id: `item-${callId}`,
      type: "function_call",
      status: "completed",
      call_id: callId,
      name,
      arguments: JSON.stringify(input),
    })),
  });
}

function responsesToolWithStatus(
  callId: string,
  name: string,
  input: JsonRecord,
  status: "completed" | "incomplete",
): Response {
  return jsonResponse({
    id: `response-${callId}`,
    status,
    ...(status === "incomplete" ? { incomplete_details: { reason: "max_output_tokens" } } : {}),
    usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    output: [{
      id: `item-${callId}`,
      type: "function_call",
      status: "completed",
      call_id: callId,
      name,
      arguments: JSON.stringify(input),
    }],
  });
}

function chatTextStream(chunks: readonly string[]): Response {
  return chatTextStreamWithFinishReason(chunks, "stop");
}

function chatReasoningTextStream(reasoningChunks: readonly string[], textChunks: readonly string[]): Response {
  const events = [
    ...reasoningChunks.map((reasoningContent, index) => chatStreamChunk({
      ...(index === 0 ? { role: "assistant" } : {}),
      reasoning_content: reasoningContent,
    }, null)),
    ...textChunks.map((content) => chatStreamChunk({ content }, null)),
    chatStreamChunk({}, "stop"),
  ];
  return new Response(`${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function chatTextStreamWithFinishReason(chunks: readonly string[], finishReason: string): Response {
  const events = [
    chatStreamChunk({ role: "assistant", content: chunks[0] ?? "" }, null),
    ...chunks.slice(1).map((content) => chatStreamChunk({ content }, null)),
    chatStreamChunk({}, finishReason),
  ];
  return new Response(`${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function chatTextStreamThenError(text: string, error: Error): Response {
  const encoder = new TextEncoder();
  const event = `data: ${JSON.stringify(chatStreamChunk({ role: "assistant", content: text }, null))}\n\n`;
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(event));
      setTimeout(() => controller.error(error), 10);
    },
  }), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function chatToolStreamWithContinuation(
  callId: string,
  name: string,
  input: JsonRecord,
  reasoningChunks: readonly string[],
): Response {
  const events = [
    ...reasoningChunks.map((reasoningContent, index) => chatStreamChunk({
      ...(index === 0 ? { role: "assistant" } : {}),
      reasoning_content: reasoningContent,
      ...(index === reasoningChunks.length - 1
        ? {
            tool_calls: [{
              index: 0,
              id: callId,
              type: "function",
              function: { name, arguments: JSON.stringify(input) },
            }],
          }
        : {}),
    }, null)),
    chatStreamChunk({}, "tool_calls"),
  ];
  return new Response(`${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function chatToolStreamWithFinishReason(
  callId: string,
  name: string,
  input: JsonRecord,
  finishReason: string,
): Response {
  const events = [
    chatStreamChunk({
      role: "assistant",
      tool_calls: [{
        index: 0,
        id: callId,
        type: "function",
        function: { name, arguments: JSON.stringify(input) },
      }],
    }, null),
    chatStreamChunk({}, finishReason),
  ];
  return new Response(`${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function chatStreamChunk(delta: JsonRecord, finishReason: string | null): JsonRecord {
  return {
    id: "chat-stream",
    object: "chat.completion.chunk",
    created: 1,
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function responsesText(text: string, id: string, usage: JsonRecord = {
  input_tokens: 3,
  output_tokens: 2,
  total_tokens: 5,
}, response: JsonRecord = {}): Response {
  return jsonResponse({
    id,
    status: "completed",
    ...response,
    usage,
    output: [{
      id: `${id}-message`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text }],
    }],
  });
}

function responsesTextStream(
  chunks: readonly string[],
  id: string,
  options: {
    readonly includeOutputItemDone?: boolean;
    readonly terminalStatus?: "completed" | "incomplete";
    readonly incompleteReason?: string;
    readonly terminalItemStatus?: unknown;
  } = {},
): Response {
  const text = chunks.join("");
  const itemId = `${id}-message`;
  const terminalStatus = options.terminalStatus ?? "completed";
  const message = {
    id: itemId,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text, annotations: [] }],
  };
  const events: JsonRecord[] = [
    {
      type: "response.created",
      response: {
        id,
        object: "response",
        created_at: 1,
        status: "in_progress",
        model: MODEL,
        output: [],
        usage: null,
      },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...message, status: "in_progress", content: [] },
    },
    ...chunks.map((delta) => ({
      type: "response.output_text.delta",
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      delta,
    })),
    ...(options.includeOutputItemDone === false
      ? []
      : [{ type: "response.output_item.done", output_index: 0, item: message }]),
    {
      type: terminalStatus === "completed" ? "response.completed" : "response.incomplete",
      response: {
        id,
        object: "response",
        created_at: 1,
        status: terminalStatus,
        model: MODEL,
        ...(options.incompleteReason === undefined
          ? {}
          : { incomplete_details: { reason: options.incompleteReason } }),
        usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
        output: [{
          id: itemId,
          type: "message",
          role: "assistant",
          content: message.content,
          ...(options.terminalItemStatus === undefined ? {} : { status: options.terminalItemStatus }),
        }],
      },
    },
  ];
  return responsesEventStream(events);
}

function responsesCompactedReasoningTextStream(
  chunks: readonly string[],
  id: string,
  encryptedContinuation: string,
  fragmentSize: number,
): Response {
  const text = chunks.join("");
  const reasoning = {
    id: `${id}-reasoning`,
    type: "reasoning",
    summary: [],
    encrypted_content: encryptedContinuation,
  };
  const message = {
    id: `${id}-message`,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text, annotations: [] }],
  };
  return responsesEventStream([{
    type: "response.created",
    response: {
      id,
      object: "response",
      created_at: 1,
      status: "in_progress",
      model: MODEL,
      output: [],
      usage: null,
    },
  }, {
    type: "response.output_item.added",
    output_index: 0,
    item: { id: reasoning.id, type: reasoning.type, summary: [] },
  }, {
    type: "response.output_item.done",
    output_index: 0,
    item: reasoning,
  }, {
    type: "response.output_item.added",
    output_index: 1,
    item: { ...message, status: "in_progress", content: [] },
  }, ...chunks.map((delta) => ({
    type: "response.output_text.delta",
    item_id: message.id,
    output_index: 1,
    content_index: 0,
    delta,
  })), {
    type: "response.output_item.done",
    output_index: 1,
    item: message,
  }, {
    type: "response.completed",
    response: {
      id,
      object: "response",
      created_at: 1,
      status: "completed",
      model: MODEL,
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      output: [{
        type: "message",
        role: "assistant",
        content: message.content,
      }],
    },
  }], fragmentSize);
}

function responsesToolStream(
  callId: string,
  name: string,
  input: JsonRecord,
  options: {
    readonly terminalStatus?: "completed" | "incomplete";
    readonly incompleteReason?: string;
  } = {},
): Response {
  const id = `resp-${callId}`;
  const terminalStatus = options.terminalStatus ?? "completed";
  const item = {
    id: `${id}-function-call`,
    type: "function_call",
    status: "completed",
    call_id: callId,
    name,
    arguments: JSON.stringify(input),
  };
  return responsesEventStream([{
    type: "response.created",
    response: {
      id,
      object: "response",
      created_at: 1,
      status: "in_progress",
      model: MODEL,
      output: [],
      usage: null,
    },
  }, {
    type: "response.output_item.added",
    output_index: 0,
    item: { ...item, status: "in_progress", arguments: "" },
  }, {
    type: "response.function_call_arguments.delta",
    item_id: item.id,
    output_index: 0,
    delta: item.arguments,
  }, {
    type: "response.function_call_arguments.done",
    item_id: item.id,
    output_index: 0,
    arguments: item.arguments,
  }, {
    type: "response.output_item.done",
    output_index: 0,
    item,
  }, {
    type: terminalStatus === "completed" ? "response.completed" : "response.incomplete",
    response: {
      id,
      object: "response",
      created_at: 1,
      status: terminalStatus,
      model: MODEL,
      ...(options.incompleteReason === undefined
        ? {}
        : { incomplete_details: { reason: options.incompleteReason } }),
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      output: [{
        type: "function_call",
        call_id: callId,
        name,
        arguments: item.arguments,
      }],
    },
  }]);
}

function responsesFailedStream(id: string, code: string, message: string): Response {
  const events: JsonRecord[] = [{
    type: "response.created",
    response: {
      id,
      object: "response",
      created_at: 1,
      status: "in_progress",
      model: MODEL,
      output: [],
      usage: null,
    },
  }, {
    type: "response.failed",
    response: {
      id,
      object: "response",
      created_at: 1,
      status: "failed",
      model: MODEL,
      error: { code, message },
      output: [],
      usage: { input_tokens: 3, output_tokens: 0, total_tokens: 3 },
    },
  }];
  return responsesEventStream(events);
}

function responsesEventStream(events: readonly JsonRecord[], fragmentSize?: number): Response {
  const serialized = `${events.map((event) =>
    `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  if (fragmentSize === undefined) {
    return new Response(serialized, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }
  const bytes = new TextEncoder().encode(serialized);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += fragmentSize) {
        controller.enqueue(bytes.slice(offset, offset + fragmentSize));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function jsonResponse(value: JsonRecord): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function parseRecord(value: unknown): JsonRecord {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as JsonRecord;
}

function occurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function abortError(): Error {
  const error = new Error("The test request was aborted.");
  error.name = "AbortError";
  return error;
}

async function rejectWhenAborted(signal: AbortSignal | undefined): Promise<never> {
  if (signal === undefined) {
    throw new Error("Expected the typed execution context to contain an AbortSignal.");
  }
  if (signal.aborted) {
    throw abortError();
  }
  await new Promise<void>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
  throw abortError();
}
