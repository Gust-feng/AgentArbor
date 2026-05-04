import assert from "node:assert/strict";
import test from "node:test";
import type { ToolExecutor } from "../../domain/tools/index.js";
import { ToolCenter } from "./tool-center.js";

test("ToolCenter registers, lists, executes, and unregisters tools", async () => {
  const center = new ToolCenter();
  center.register(testTool("echo", async (input) => ({ input })));

  assert.equal(center.has("echo"), true);
  assert.deepEqual(center.list().map((tool) => tool.name), ["echo"]);

  const result = await center.execute(
    { callId: "call-1", toolName: "echo", input: { value: "hello" } },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  );

  assert.equal(result.status, "completed");
  assert.deepEqual(result.output, { input: { value: "hello" } });
  assert.equal(center.getCallCount(), 1);

  center.unregister("echo");
  assert.equal(center.has("echo"), false);
});

test("ToolCenter enforces allowedTools permissions", async () => {
  const center = new ToolCenter();
  center.register(testTool("web_search", async () => ({ ok: true })));

  const result = await center.execute(
    { callId: "call-1", toolName: "web_search", input: { query: "x" } },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["other_tool"] }
  );

  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /not allowed/);
  assert.equal(center.getCallCount(), 0);
});

test("ToolCenter enforces maxCallsPerRun", async () => {
  const center = new ToolCenter({ maxCallsPerRun: 1 });
  center.register(testTool("echo", async () => ({ ok: true })));
  const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };

  const first = await center.execute({ callId: "call-1", toolName: "echo", input: {} }, context);
  const second = await center.execute({ callId: "call-2", toolName: "echo", input: {} }, context);

  assert.equal(first.status, "completed");
  assert.equal(second.status, "failed");
  assert.match(second.error ?? "", /budget exhausted/);
  assert.equal(center.getCallCount(), 1);

  center.resetCallCount();
  assert.equal(center.getCallCount(), 0);
});

function testTool(name: string, execute: ToolExecutor["execute"]): ToolExecutor {
  return {
    definition: {
      name,
      description: `${name} test tool`,
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    execute,
  };
}
