import assert from "node:assert/strict";
import test from "node:test";
import type { ToolCallResult, ToolExecutionContext } from "../../domain/tools/index.js";
import { createToolCompletedMessage } from "./tool-events.js";

test("tool completed event marks output redacted only when projection says so", () => {
  const plain = createToolCompletedMessage({
    result: toolResult({
      projection: {
        uiSummary: "read file",
        diagnosticRef: "tool:call-read",
        truncated: false,
      },
    }),
    context: toolContext(),
  });
  const explicit = createToolCompletedMessage({
    result: toolResult({
      projection: {
        uiSummary: "redacted result",
        diagnosticRef: "tool:call-redacted",
        truncated: false,
        redacted: true,
      },
    }),
    context: toolContext(),
  });

  assert.equal(outputRecord(plain.payload.output).redacted, false);
  assert.equal(outputRecord(explicit.payload.output).redacted, true);
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
