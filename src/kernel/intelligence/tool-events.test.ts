import assert from "node:assert/strict";
import test from "node:test";
import type { ToolCallResult, ToolExecutionContext } from "../../domain/tools/index.js";
import { createToolCompletedMessage } from "./tool-events.js";

test("tool completed event records the execution fact", () => {
  const plain = createToolCompletedMessage({
    result: toolResult(),
    context: toolContext(),
  });
  const explicit = createToolCompletedMessage({
    result: toolResult(),
    context: toolContext(),
  });

  assert.equal((outputRecord(plain.payload.output).result as { readonly path?: string } | undefined)?.path, "README.md");
  assert.equal((outputRecord(explicit.payload.output).result as { readonly path?: string } | undefined)?.path, "README.md");
  assert.equal(JSON.stringify(explicit.payload.output).includes("redacted result"), false);
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
    output: { result: { path: "README.md", content: "hello" } },
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
