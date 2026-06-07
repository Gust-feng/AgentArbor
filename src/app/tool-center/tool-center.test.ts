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
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("echo")
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
    allowTools("other_tool")
  );

  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /未授权/);
  assert.equal(center.getCallCount(), 0);
});

test("ToolCenter rejects permission records for a different caller agent", async () => {
  const center = new ToolCenter();
  center.register(testTool("web_search", async () => ({ ok: true })));

  const result = await center.execute(
    { callId: "call-1", toolName: "web_search", input: { query: "x" } },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "other-agent", allowedTools: ["web_search"] }
  );

  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /调用者身份与本轮工具授权不一致/);
  assert.equal(center.getCallCount(), 0);
});

test("ToolCenter enforces maxCallsPerRun", async () => {
  const center = new ToolCenter({ maxCallsPerRun: 1 });
  center.register(testTool("echo", async () => ({ ok: true })));
  const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };

  const first = await center.execute({ callId: "call-1", toolName: "echo", input: {} }, context, allowTools("echo"));
  const second = await center.execute({ callId: "call-2", toolName: "echo", input: {} }, context, allowTools("echo"));

  assert.equal(first.status, "completed");
  assert.equal(second.status, "failed");
  assert.match(second.error ?? "", /保护上限/);
  assert.equal(center.getCallCount(), 1);

  center.resetCallCount();
  assert.equal(center.getCallCount(), 0);
});

test("ToolCenter default does not add a small tool-call budget", async () => {
  const center = new ToolCenter();
  center.register(testTool("echo", async () => ({ ok: true })));
  const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };

  for (let index = 0; index < 25; index += 1) {
    const result = await center.execute({ callId: `call-${index}`, toolName: "echo", input: {} }, context, allowTools("echo"));
    assert.equal(result.status, "completed");
  }
  assert.equal(center.getCallCount(), 25);
});

test("ToolCenter uses explicit metadata for confirmation instead of platform operation defaults", async () => {
  let writes = 0;
  let deletes = 0;
  let executes = 0;
  const center = new ToolCenter({ platform: "win32" });
  center.register(testTool("custom_write", async () => {
    writes += 1;
    return { ok: true };
  }, "read-write"));
  center.register(testTool("delete_file", async () => {
    deletes += 1;
    return { ok: true };
  }, "read-write", { requiresConfirmation: true }));
  center.register(testTool("run_command", async () => {
    executes += 1;
    return { ok: true };
  }, "execute", { requiresConfirmation: true }));
  const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };

  const write = await center.execute({ callId: "call-write", toolName: "custom_write", input: {} }, context, allowTools("custom_write", "delete_file", "run_command"));
  const deleteResult = await center.execute({ callId: "call-delete", toolName: "delete_file", input: {} }, context, allowTools("custom_write", "delete_file", "run_command"));
  const execute = await center.execute({ callId: "call-exec", toolName: "run_command", input: {} }, context, allowTools("custom_write", "delete_file", "run_command"));

  assert.equal(write.status, "completed");
  assert.equal(deleteResult.status, "approval_required");
  assert.equal(execute.status, "approval_required");
  assert.equal(deleteResult.error, "等待确认：删除文件");
  assert.equal(execute.error, "等待确认：运行命令");
  assert.equal(deleteResult.confirmationRequest?.confirmationId, "confirmation-call-delete");
  assert.equal(execute.confirmationRequest?.confirmationId, "confirmation-call-exec");
  assert.equal(deleteResult.confirmationRequest?.riskLevel, "high");
  assert.equal(deleteResult.confirmationRequest?.title, "删除文件");
  assert.equal(deleteResult.confirmationRequest?.actionSummary, "删除文件");
  assert.equal(deleteResult.confirmationRequest?.actionSummary.includes("delete_file"), false);
  assert.equal(deleteResult.projection?.uiSummary, "删除文件");
  assert.equal(writes, 1);
  assert.equal(deletes, 0);
  assert.equal(executes, 0);
  assert.equal(center.getCallCount(), 1);
  assert.equal(deleteResult.projection?.diagnosticRef, "tool:call-delete:confirmation-required");
});

test("ToolCenter lets an approved confirmation id bypass the confirmation gate", async () => {
  let executes = 0;
  const center = new ToolCenter({ platform: "win32" });
  center.register(testTool("run_command", async () => {
    executes += 1;
    return { summary: "safe command summary" };
  }, "execute", { requiresConfirmation: true }));
  const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };

  const result = await center.execute(
    { callId: "call-command", toolName: "run_command", input: {} },
    context,
    { ...allowTools("run_command"), approvedConfirmationIds: ["confirmation-call-command"] }
  );

  assert.equal(result.status, "completed");
  assert.equal(executes, 1);
  assert.equal(center.getCallCount(), 1);
  assert.equal(result.projection?.uiSummary, "safe command summary");
});

test("ToolCenter adds typed safe display projections for command output", async () => {
  const center = new ToolCenter();
  center.register(testTool("shell_command", async () => ({
    action: "shell_command",
    summary: "pnpm test · exit 0",
    result: {
      command: "pnpm",
      args: ["test"],
      exitCode: 0,
      stdout: "ok\nAuthorization: Bearer sk-test-secret-token",
      stderr: "",
    },
  }), "read-only"));

  const result = await center.execute(
    { callId: "call-shell", toolName: "shell_command", input: { command: "pnpm", args: ["test"] } },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("shell_command")
  );

  assert.equal(result.status, "completed");
  assert.equal(result.projection?.display?.kind, "command_summary");
  assert.equal(JSON.stringify(result.projection?.display).includes("sk-test-secret-token"), false);
});

test("ToolCenter adds typed safe display projections for search results", async () => {
  const center = new ToolCenter();
  center.register(testTool("search", async () => ({
    action: "search",
    query: "AgentArbor",
    status: "completed",
    results: [
      {
        refId: "research:web:one",
        source: "web",
        title: "AgentArbor result",
        uri: "https://example.test/agentarbor",
        snippet: "short safe snippet",
      },
    ],
  })));

  const result = await center.execute(
    { callId: "call-search", toolName: "search", input: { query: "AgentArbor" } },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("search")
  );

  assert.equal(result.status, "completed");
  assert.equal(result.projection?.display?.kind, "search_results");
  assert.equal(result.projection?.display?.kind === "search_results" ? result.projection.display.results[0]?.title : "", "AgentArbor result");
});

test("ToolCenter file diff display does not expose edit input text", async () => {
  const center = new ToolCenter({ platform: "linux" });
  center.register(testTool("edit_file", async () => ({
    action: "edit_file",
    summary: "notes.md · 32 -> 18 chars · 1 replacement",
    result: {
      path: "notes.md",
      previousLength: 32,
      nextLength: 18,
      replacements: 1,
    },
  }), "read-write"));

  const result = await center.execute(
    {
      callId: "call-edit",
      toolName: "edit_file",
      input: {
        path: "notes.md",
        oldText: "old file body sk-edit-secret",
        newText: "new file body sk-edit-secret",
      },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("edit_file")
  );

  const displayJson = JSON.stringify(result.projection?.display);
  assert.equal(result.status, "completed");
  assert.equal(result.projection?.display?.kind, "file_diff_preview");
  assert.equal(displayJson.includes("old file body"), false);
  assert.equal(displayJson.includes("new file body"), false);
  assert.equal(displayJson.includes("sk-edit-secret"), false);
  assert.equal(result.projection?.display?.kind === "file_diff_preview" ? result.projection.display.replacements : 0, 1);
});

test("ToolCenter file diff display exposes bounded redacted edit preview", async () => {
  const center = new ToolCenter({ platform: "linux" });
  center.register(testTool("edit_file", async () => ({
    action: "edit_file",
    summary: "notes.md · 32 -> 36 chars · 1 replacement",
    result: {
      path: "notes.md",
      previousLength: 32,
      nextLength: 36,
      replacements: 1,
    },
  }), "read-write"));

  const result = await center.execute(
    {
      callId: "call-edit-preview",
      toolName: "edit_file",
      input: {
        path: "notes.md",
        edits: [{ anchor: "old visible line\napi_key=sk-edit-secret", replacement: "new visible line\napi_key=sk-edit-secret" }],
      },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("edit_file")
  );

  const display = result.projection?.display;
  const displayJson = JSON.stringify(display);
  assert.equal(result.status, "completed");
  assert.equal(display?.kind, "file_diff_preview");
  assert.equal(display?.kind === "file_diff_preview" ? display.preview?.includes("- old visible line") : false, true);
  assert.equal(display?.kind === "file_diff_preview" ? display.preview?.includes("+ new visible line") : false, true);
  assert.equal(displayJson.includes("sk-edit-secret"), false);
});

test("ToolCenter file change display exposes bounded redacted create preview", async () => {
  const center = new ToolCenter({ platform: "linux" });
  center.register(testTool("create_file", async () => ({
    action: "create_file",
    summary: "created.md · 42 bytes · created",
    result: {
      path: "created.md",
      bytes: 42,
    },
  }), "read-write"));

  const result = await center.execute(
    {
      callId: "call-create-preview",
      toolName: "create_file",
      input: {
        path: "created.md",
        content: "visible created line\npassword=sk-create-secret",
      },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("create_file")
  );

  const display = result.projection?.display;
  const displayJson = JSON.stringify(display);
  assert.equal(result.status, "completed");
  assert.equal(display?.kind, "file_change_summary");
  assert.equal(display?.kind === "file_change_summary" ? display.preview?.includes("+ visible created line") : false, true);
  assert.equal(displayJson.includes("sk-create-secret"), false);
  assert.equal(displayJson.includes("[redacted-secret]"), true);
});

test("ToolCenter list returns cloned metadata", () => {
  const center = new ToolCenter();
  center.register(testTool("read_file", async () => ({ ok: true }), "read-only"));

  const listed = center.list();
  (listed[0]!.metadata!.visibleResultPolicy as { maxPreviewChars: number }).maxPreviewChars = 1;

  assert.equal(center.list()[0]?.metadata?.visibleResultPolicy.maxPreviewChars, 800);
});

function testTool(
  name: string,
  execute: ToolExecutor["execute"],
  operationType: "read-only" | "read-write" | "execute" | "external-submit" = "read-only",
  options: { readonly requiresConfirmation?: boolean } = {}
): ToolExecutor {
  return {
    definition: {
      name,
      description: `${name} test tool`,
      metadata: {
        category: "other",
        riskLevel: operationType === "read-only" ? "low" : "high",
        operationType,
        requiresConfirmation: options.requiresConfirmation ?? false,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 800,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    execute,
  };
}

function allowTools(...allowedTools: readonly string[]) {
  return {
    callerAgentId: "agent-test",
    allowedTools,
  };
}
