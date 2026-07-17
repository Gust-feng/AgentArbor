import assert from "node:assert/strict";
import test from "node:test";
import type { ToolCallResult, ToolExecutionContext } from "../../domain/tools/index.js";
import {
  createToolCancelledMessage,
  createToolCompletedMessage,
  createToolRequestedMessage,
} from "./tool-events.js";

test("tool completed event records the execution fact", () => {
  const plain = createToolCompletedMessage({
    result: toolResult(),
    context: toolContext(),
  });
  const explicit = createToolCompletedMessage({
    result: toolResult(),
    context: toolContext(),
  });

  assert.equal(outputRecord(plain.payload.output).path, "README.md");
  assert.equal(outputRecord(explicit.payload.output).path, "README.md");
  assert.equal(JSON.stringify(explicit.payload.output).includes("redacted result"), false);
  assert.equal("input" in explicit.payload, false);
});

test("tool events serialize undefined facts without manufacturing text fields", () => {
  const completed = createToolCompletedMessage({
    result: toolResult({ output: undefined }),
    context: toolContext(),
  });

  assert.equal(completed.payload.output, undefined);
  assert.doesNotThrow(() => JSON.stringify(completed));
});

test("tool events trust ToolCenter facts, preserve evidence, and snapshot mutable inputs", () => {
  const requestInput = { path: "README.md" };
  const requested = createToolRequestedMessage({
    request: {
      callId: "call-read",
      toolName: "read_file",
      input: requestInput,
    },
    context: toolContext(),
  });
  const completed = createToolCompletedMessage({
    result: toolResult({ output: { content: "x".repeat(2_000) } }),
    context: toolContext(),
  });
  requestInput.path = "mutated.md";

  assert.deepEqual(requested.payload.input, { path: "README.md" });
  assert.equal(outputRecord(completed.payload.output).content, "x".repeat(2_000));
  assert.doesNotThrow(() => JSON.stringify([requested, completed]));
});

test("tool events preserve prototype-shaped JSON keys as own facts", () => {
  const output = JSON.parse('{"__proto__":{"polluted":true},"constructor":"fact"}') as ToolCallResult["output"];
  const completed = createToolCompletedMessage({
    result: toolResult({ output }),
    context: toolContext(),
  });
  const record = outputRecord(completed.payload.output);

  assert.equal(Object.prototype.hasOwnProperty.call(record, "__proto__"), true);
  assert.deepEqual(record.__proto__, { polluted: true });
  assert.equal(record.constructor, "fact");
  assert.equal(({} as { polluted?: unknown }).polluted, undefined);
});

test("tool cancelled events preserve approval cancellation facts for replay", () => {
  const cancelled = createToolCancelledMessage({
    result: toolResult({
      status: "cancelled",
      error: "Agent turn was cancelled while this tool was waiting for approval.",
      errorDomain: "runtime_error",
      errorFacts: {
        code: "approval_wait_cancelled",
        confirmationId: "confirmation-cancelled",
        detail: "x".repeat(120_000),
      },
      confirmationRequest: {
        confirmationId: "confirmation-cancelled",
        toolCallFactId: "tool-fact-cancelled",
        title: "Confirm tool",
        actionSummary: "Confirm tool execution.",
        affectedResources: [],
        riskLevel: "medium",
        requestedAt: "2026-07-13T00:00:00.000Z",
        sourceRefs: ["tool:call-read"],
      },
    }),
    context: toolContext(),
  });

  assert.equal(cancelled.payload.errorDomain, "runtime_error");
  assert.equal(cancelled.payload.errorFacts?.code, "approval_wait_cancelled");
  assert.equal(cancelled.payload.errorFacts?.confirmationId, "confirmation-cancelled");
  assert.equal(cancelled.payload.confirmationId, "confirmation-cancelled");
  assert.equal(cancelled.payload.factTruncation?.errorFacts, true);
  assert.equal(JSON.stringify(cancelled.payload).length < 40_000, true);
});

test("tool events keep one bounded fact snapshot and preserve executable continuation", () => {
  const requested = createToolRequestedMessage({
    request: {
      callId: "call-large",
      toolName: "read_file",
      input: { path: "large.txt", note: "i".repeat(20_000) },
    },
    context: toolContext(),
  });
  const completed = createToolCompletedMessage({
    result: toolResult({
      callId: "call-large",
      output: {
        path: "large.txt",
        content: "x".repeat(120_000),
        continuation: {
          nextInput: { path: "large.txt", startChar: 120_000 },
        },
      },
    }),
    context: toolContext(),
  });

  assert.equal(requested.payload.factTruncation?.input, true);
  assert.equal(completed.payload.factTruncation?.output, true);
  assert.equal("input" in completed.payload, false);
  assert.deepEqual(outputRecord(completed.payload.output).continuation, {
    nextInput: { path: "large.txt", startChar: 120_000 },
  });
  assert.equal((outputRecord(completed.payload.output).content as string).length < 120_000, true);
  assert.equal(JSON.stringify(completed.payload).length < 40_000, true);
});

test("tool event continuation facts cannot bypass the durable event budget", () => {
  const completed = createToolCompletedMessage({
    result: toolResult({
      output: {
        truncated: true,
        continuation: {
          nextInput: {
            cursor: "c".repeat(120_000),
          },
        },
      },
    }),
    context: toolContext(),
  });

  assert.equal(completed.payload.factTruncation?.output, true);
  assert.equal(JSON.stringify(completed.payload).length < 40_000, true);
});

function outputRecord(value: unknown): Readonly<Record<string, unknown>> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  return value as Readonly<Record<string, unknown>>;
}

function toolResult(overrides: Partial<ToolCallResult> = {}): ToolCallResult {
  return {
    callId: "call-read",
    toolName: "read_file",
    input: { path: "README.md" },
    output: { path: "README.md", content: "hello" },
    status: "completed",
    durationMs: 12,
    ...overrides,
  };
}

function toolContext(): ToolExecutionContext {
  return {
    traceId: "trace-tool-event",
    goalId: "goal-tool-event",
    callerAgentId: "agent-tool-event",
  };
}
