import assert from "node:assert/strict";
import test from "node:test";
import type { ConfirmationDecision } from "../../domain/confirmation/index.js";
import type { ModelMessage } from "../../domain/intelligence/index.js";
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

test("compatible Chat completes from one local history without duplicating messages and maps cached usage", async () => {
  const fetch = scriptedFetch([
    ({ url, body }) => {
      assert.equal(url, `${CHAT_BASE_URL}/chat/completions`);
      const serialized = JSON.stringify(body.messages);
      assert.equal(occurrences(serialized, "prior-user"), 1);
      assert.equal(occurrences(serialized, "prior-assistant"), 1);
      assert.equal(occurrences(serialized, "current-user"), 1);
      assert.equal(body.prompt_cache_key, undefined);
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

test("official Responses sends a stable cache identity and retains response output items only in canonical history", async () => {
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
      baseUrl: OFFICIAL_BASE_URL,
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
      const result = await loop.execute(loopInput([{ role: "system", content: SYSTEM }, {
        role: "user",
        content: "inspect image",
        attachments: [{
          kind: "image",
          source: { kind: "data", mimeType: "image/png", data: "dXNlcg==" },
        }],
      }], gateway));
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
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
      assert.deepEqual(paused.messages.map((message) => message.role), ["system", "user"]);
      if (paused.status !== "approval_required") return;
      const confirmation = paused.confirmationRequests[0];
      assert.equal(confirmation?.confirmationId, "confirmation-call-approved");
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
  const gateway = new TestGateway(definition);
  const fetch = scriptedFetch([
    () => chatTool("call-read-once", "read_fact", { value: "one" }),
    () => chatText("tool-final"),
  ]);
  await withGlobalFetch(fetch.fetch, async () => {
    const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL });
    try {
      const result = await loop.execute(loopInput([
        { role: "system", content: SYSTEM },
        { role: "user", content: "read one fact" },
      ], gateway));
      assert.match(JSON.stringify(fetch.requests[0]?.body.tools), /MODEL_CONTRACT_OUTPUT_SENTINEL/u);
      const modelToolResult = JSON.stringify(fetch.requests[1]?.body.messages);
      for (const fact of ["call-read-once", "read_fact", "gateway-completed", "completed"]) {
        assert.match(modelToolResult, new RegExp(fact, "u"));
      }
      assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
      assert.equal(gateway.executions.length, 1);
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

for (const decisionKind of ["deny", "guidance"] as const) {
  test(`tool ${decisionKind} resumes through SDK rejection without executing the gateway`, async () => {
    const gateway = new TestGateway(gatedTool());
    const fetch = scriptedFetch([
      () => chatTool(`call-${decisionKind}`, "write_fact", { value: decisionKind }),
      ({ body }) => {
        const serialized = JSON.stringify(body.messages);
        assert.match(serialized, decisionKind === "guidance" ? /use read-only evidence/u : /rejected this tool/u);
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
      } finally {
        await loop.release();
      }
    });
  });
}

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
            runId: request.callId,
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

function createLoop(input: Pick<OpenAIAgentsLoopConfig, "protocol" | "baseUrl" | "requestSettings" | "fetch">) {
  return createOpenAIAgentsLoop({ ...input, apiKey: "test-key", model: MODEL });
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
  return {
    ...plainTool(name),
    metadata: {
      category: "filesystem",
      riskLevel: "medium",
      operationType: "read-write",
      requiresConfirmation: true,
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
    runId: confirmationId.replace(/^confirmation-/u, ""),
    decision: kind,
    decidedAt: "2026-07-15T00:00:01.000Z",
    guidance,
  };
}

function scriptedFetch(
  steps: readonly ((request: CapturedFetch) => Response)[],
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
      return step(captured);
    },
  };
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
  return jsonResponse({
    id: `chat-${text}`,
    object: "chat.completion",
    created: 1,
    model: MODEL,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage,
  });
}

function chatTool(callId: string, name: string, input: JsonRecord): Response {
  return chatTools([{ callId, name, input }]);
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
  return jsonResponse({
    id: `response-${callId}`,
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
  const events = [
    chatStreamChunk({ role: "assistant", content: chunks[0] ?? "" }, null),
    ...chunks.slice(1).map((content) => chatStreamChunk({ content }, null)),
    chatStreamChunk({}, "stop"),
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
}): Response {
  return jsonResponse({
    id,
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
