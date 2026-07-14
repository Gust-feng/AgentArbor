import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { ToolCallResult, ToolExecutor } from "../../../domain/tools/index.js";
import { withToolModelAttachments } from "../../../domain/tools/index.js";
import { toolResultMessage } from "../../../kernel/intelligence/tool-use-loop-messages.js";
import { ToolCenter } from "../tool-center.js";
import { DEFAULT_MAX_INLINE_TOOL_OUTPUT_CHARS } from "../tool-output-limits.js";
import { createHttpRequestTool } from "./http-request-tool.js";
import { createLocalReadFileTool } from "./local-workspace-read-tools.js";

const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };

test("real read_file results from 110k through 128k reach the model once and in full", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-read-model-message-"));
  try {
    const center = new ToolCenter();
    center.register(createLocalReadFileTool(root));

    for (const size of [110_000, 120_000, 128_000]) {
      const tail = `READ_FILE_TAIL_${size}`;
      const content = `${"x".repeat(size - tail.length)}${tail}`;
      const filename = `source-${size}.txt`;
      await writeFile(path.join(root, filename), content, "utf8");
      const result = await center.execute(
        { callId: `call-read-${size}`, toolName: "read_file", input: { path: filename } },
        context,
        { callerAgentId: context.callerAgentId, allowedTools: ["read_file"] }
      );

      const message = toolResultMessage(result);
      const payload = JSON.parse(message.content) as {
        readonly status?: string;
        readonly body?: {
          readonly format?: string;
          readonly value?: { readonly content?: string };
        };
      };

      assert.equal(result.status, "completed");
      assert.equal(JSON.stringify(result.output).length <= DEFAULT_MAX_INLINE_TOOL_OUTPUT_CHARS, true);
      assert.equal(payload.status, "completed");
      assert.equal(payload.body?.format, "json");
      assert.equal(payload.body?.value?.content, content);
      assert.equal(occurrences(message.content, tail), 1);
      assert.equal(message.content.length < 220_000, true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("escaped read_file content stays model-visible through repeated character-range reads", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-read-model-message-escaped-"));
  try {
    const center = new ToolCenter();
    center.register(createLocalReadFileTool(root));
    const unit = "\"\\\n\t";
    const content = unit.repeat(Math.ceil(120_000 / unit.length)).slice(0, 120_000);
    const filename = "escaped-source.txt";
    await writeFile(path.join(root, filename), content, "utf8");

    let nextInput: ToolCallResult["input"] = { path: filename };
    let reconstructed = "";
    for (let index = 0; index < 10 && nextInput !== undefined; index += 1) {
      const result = await center.execute(
        { callId: `call-read-escaped-${index}`, toolName: "read_file", input: nextInput },
        context,
        { callerAgentId: context.callerAgentId, allowedTools: ["read_file"] }
      );
      const message = toolResultMessage(result);
      const payload = JSON.parse(message.content) as {
        readonly status?: string;
        readonly body?: { readonly value?: Readonly<Record<string, unknown>> };
      };
      const output = asRecord(result.output);
      const returned = String(output.content ?? "");
      const rawChars = Number(output.textChars ?? returned.length);

      assert.equal(result.status, "completed");
      assert.equal(JSON.stringify(result.output).length <= DEFAULT_MAX_INLINE_TOOL_OUTPUT_CHARS, true);
      assert.equal(payload.status, "completed");
      assert.equal(message.content.length < 220_000, true);
      assert.equal(asRecord(payload.body?.value).content, returned);
      reconstructed += returned.slice(0, rawChars);
      const nextStartChar = output.nextStartChar;
      nextInput = typeof nextStartChar === "number"
        ? { path: filename, startChar: nextStartChar }
        : undefined;
    }

    assert.equal(reconstructed, content);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("escaped 110k through 128k GET bodies stay model-visible through executable continuations", async () => {
  const unit = String.fromCharCode(34, 92, 10, 9);
  for (const size of [110_000, 120_000, 128_000]) {
    const body = unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
    const center = new ToolCenter();
    center.register(createHttpRequestTool({
      fetch: async () => ({
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/plain" }),
        text: async () => body,
      }),
    }));

    let nextInput: ToolCallResult["input"] = { url: "https://example.test/escaped" };
    let reconstructed = "";
    let chunks = 0;
    while (nextInput !== undefined && chunks < 10) {
      const result = await center.execute(
        { callId: `call-http-escaped-${size}-${chunks}`, toolName: "http_request", input: nextInput },
        context,
        { callerAgentId: context.callerAgentId, allowedTools: ["http_request"] }
      );
      const message = toolResultMessage(result);
      const payload = JSON.parse(message.content) as {
        readonly status?: string;
        readonly body?: { readonly value?: Readonly<Record<string, unknown>> };
      };
      const output = asRecord(result.output);

      assert.equal(result.status, "completed");
      assert.equal(JSON.stringify(result.output).length <= DEFAULT_MAX_INLINE_TOOL_OUTPUT_CHARS, true);
      assert.equal(payload.status, "completed");
      assert.equal(message.content.length < 220_000, true);
      assert.equal(asRecord(payload.body?.value).body, output.body);
      reconstructed += String(output.body ?? "");
      nextInput = output.continuation === undefined
        ? undefined
        : asRecord(asRecord(output.continuation).nextInput) as ToolCallResult["input"];
      chunks += 1;
    }

    assert.equal(chunks, 2);
    assert.equal(reconstructed, body);
  }
});

test("model transport bounds oversized continuation metadata without duplicating the result body", () => {
  const message = toolResultMessage(completedResult({
    data: "x".repeat(300_000),
    continuation: {
      ref: "tool-output://large-result",
      nextInput: { data: "y".repeat(300_000) },
    },
  }));
  const payload = JSON.parse(message.content) as {
    readonly status?: string;
    readonly body?: {
      readonly value?: {
        readonly continuation?: { readonly ref?: string; readonly nextInput?: unknown };
      };
    };
  };

  assert.equal(message.content.length < 220_000, true);
  assert.equal(payload.status, "completed");
  assert.equal(payload.body?.value?.continuation?.ref, "tool-output://large-result");
  assert.equal(payload.body?.value?.continuation?.nextInput, undefined);
  assert.equal(message.content.includes("y".repeat(20_000)), false);
});

test("model transport enforces continuation item count and serialized budgets", () => {
  const continuations = Array.from({ length: 40 }, (_value, index) => ({
    ref: `tool-output://${index}`,
    nextInput: { cursor: index },
  }));
  const countPayload = JSON.parse(toolResultMessage(completedResult({
    data: "x".repeat(300_000),
    continuations,
  })).content) as {
    readonly body?: { readonly value?: { readonly continuations?: readonly unknown[] } };
  };
  assert.equal(countPayload.body?.value?.continuations?.length, 32);

  const oversizedItemPayload = JSON.parse(toolResultMessage(completedResult({
    data: "x".repeat(300_000),
    continuation: {
      ref: "r".repeat(4_096),
      note: "n".repeat(2_000),
      nextInput: { data: "y".repeat(15_900) },
    },
  })).content) as {
    readonly body?: { readonly value?: { readonly continuation?: unknown } };
  };
  const continuation = oversizedItemPayload.body?.value?.continuation;
  assert.equal(JSON.stringify(continuation).length <= 16_000, true);
  assert.equal(asRecord(continuation).nextInput !== undefined, true);

  const mediumContinuations = Array.from({ length: 32 }, (_value, index) => ({
    ref: `tool-output://${index}`,
    nextInput: { data: `${index}`.padStart(2, "0") + "z".repeat(3_900) },
  }));
  const totalPayload = JSON.parse(toolResultMessage(completedResult({
    data: "x".repeat(300_000),
    continuations: mediumContinuations,
  })).content) as {
    readonly body?: { readonly value?: { readonly continuations?: readonly unknown[] } };
  };
  const selected = totalPayload.body?.value?.continuations ?? [];
  const selectedChars = selected.reduce<number>(
    (chars, item) => chars + (JSON.stringify(item)?.length ?? 0),
    0
  );
  assert.equal(selectedChars <= 64_000, true);
  assert.equal(selected.length < mediumContinuations.length, true);
});

test("model tool bodies are exclusive for small text, structured, and undefined results", () => {
  const textMessage = toolResultMessage(completedResult("plain body"));
  const jsonMessage = toolResultMessage(completedResult({ content: "structured body" }));
  const noneMessage = toolResultMessage(completedResult(undefined));

  assert.deepEqual(JSON.parse(textMessage.content).body, { format: "text", text: "plain body" });
  assert.deepEqual(JSON.parse(jsonMessage.content).body, {
    format: "json",
    value: { content: "structured body" },
  });
  assert.deepEqual(JSON.parse(noneMessage.content).body, { format: "none" });
  assert.equal(occurrences(jsonMessage.content, "structured body"), 1);
  assert.equal(jsonMessage.content.includes("structuredContent"), false);
  assert.deepEqual(Object.keys(JSON.parse(jsonMessage.content)).sort(), ["body", "status"]);
  assert.equal(jsonMessage.toolCallId, "call-result");
  assert.equal(jsonMessage.toolName, "test_tool");
  assert.equal(jsonMessage.content.includes("call-result"), false);
  assert.equal(jsonMessage.content.includes("test_tool"), false);
  assert.equal(jsonMessage.content.includes("durationMs"), false);
});

test("ToolCenter normalization preserves out-of-band model attachments through toolResultMessage", async () => {
  const center = new ToolCenter();
  center.register(testTool("image_fact", async () => withToolModelAttachments(
    { attachmentId: "image-1", readable: true },
    [{
      kind: "image",
      source: { kind: "data", mimeType: "image/png", data: "aGVsbG8=" },
      attachmentId: "image-1",
    }]
  )));

  const result = await center.execute(
    { callId: "call-image", toolName: "image_fact", input: {} },
    context,
    { callerAgentId: context.callerAgentId, allowedTools: ["image_fact"] }
  );
  const message = toolResultMessage(result);

  assert.equal(result.status, "completed");
  assert.equal(message.attachments?.[0]?.kind, "image");
  assert.equal(message.attachments?.[0]?.attachmentId, "image-1");
  assert.equal(message.content.includes("aGVsbG8="), false);
});

test("ToolCenter rejects a circular executor output before model message construction", async () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const center = new ToolCenter();
  center.register(testTool("circular_fact", async () => circular));
  const result = await center.execute(
    { callId: "call-circular", toolName: "circular_fact", input: {} },
    context,
    { callerAgentId: context.callerAgentId, allowedTools: ["circular_fact"] }
  );
  const message = toolResultMessage(result);
  const payload = JSON.parse(message.content) as {
    readonly status?: string;
    readonly body?: { readonly format?: string };
    readonly error?: { readonly facts?: { readonly code?: string; readonly phase?: string } };
  };

  assert.equal(payload.status, "failed");
  assert.equal(payload.body?.format, "none");
  assert.equal(payload.error?.facts?.code, "invalid_tool_output_fact");
  assert.equal(payload.error?.facts?.phase, "output");
});

test("toolResultMessage converts invalid direct facts into a model-visible transport failure", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const result = {
    ...completedResult(undefined),
    status: "failed" as const,
    error: "invalid facts",
    errorFacts: { circular },
  } as unknown as ToolCallResult;

  const payload = JSON.parse(toolResultMessage(result).content) as {
    readonly status?: string;
    readonly body?: { readonly format?: string };
    readonly error?: { readonly facts?: { readonly code?: string } };
  };

  assert.equal(payload.status, "failed");
  assert.equal(payload.body?.format, "none");
  assert.equal(payload.error?.facts?.code, "tool_result_not_serializable");
});

function completedResult(output: ToolCallResult["output"]): ToolCallResult {
  return {
    callId: "call-result",
    toolName: "test_tool",
    input: {},
    output,
    status: "completed",
    durationMs: 1,
  };
}

function testTool(name: string, execute: ToolExecutor["execute"]): ToolExecutor {
  return {
    definition: {
      name,
      description: `${name} test tool`,
      inputSchema: { type: "object", properties: {} },
      metadata: {
        category: "other",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
      },
    },
    execute,
  };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function occurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
