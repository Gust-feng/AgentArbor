import assert from "node:assert/strict";
import test from "node:test";
import { toolStreamDetail, toolSummary } from "./panel-stream-tool-projection.js";

test("requested tool summaries name the tool without manufacturing a status sentence", () => {
  assert.equal(toolSummary("tool.requested", {
    toolName: "read_file",
    input: { path: "src/app.ts" },
  }), "读取文件");
  assert.equal(toolSummary("tool.requested", {
    toolName: "vendor__inspect_schema",
    input: { path: "database/schema.sql" },
  }), "inspect schema");
});

test("requested stream detail preserves concrete objects before completion", () => {
  const read = toolStreamDetail("tool.requested", {
    toolName: "read_file",
    input: { path: "src/app.ts" },
  });
  const directory = toolStreamDetail("tool.requested", {
    toolName: "list_dir",
    input: { path: "src/components" },
  });

  assert.equal(read.display?.kind, "read_result");
  assert.equal(read.display?.kind === "read_result" ? read.display.title : undefined, "src/app.ts");
  assert.equal(directory.display?.kind, "directory_listing");
  assert.equal(directory.display?.kind === "directory_listing" ? directory.display.path : undefined, "src/components");
});

test("requested skill resources keep their concrete path instead of a generic capability label", () => {
  const payload = {
    toolName: "read_skill_resource",
    input: {
      skillId: "workbench-interface-design",
      path: "references/principles.md",
      type: "reference",
    },
  };
  const detail = toolStreamDetail("tool.requested", payload);

  assert.equal(toolSummary("tool.requested", payload), "读取技能资源");
  assert.equal(detail.display?.kind, "read_result");
  assert.equal(
    detail.display?.kind === "read_result" ? detail.display.title : undefined,
    "references/principles.md",
  );
  assert.equal(JSON.stringify(detail).includes("工具能力"), false);
});

test("tool stream projection keeps command facts in display detail without promoting them to live copy", () => {
  const payload = {
    toolName: "shell_command",
    input: { command: "pnpm", args: ["test"] },
    output: {
      command: "pnpm",
      args: ["test"],
      exitCode: 0,
      stdout: "RAW_STDOUT_SENTINEL",
    },
  };

  const detail = toolStreamDetail("tool.completed", payload);

  assert.equal(toolSummary("tool.completed", payload), "Shell 命令完成。");
  assertNoToolShadowFields(detail);
  assert.equal(detail.display?.kind, "command_summary");
  assert.equal(detail.display?.kind === "command_summary" ? detail.display.commandLine : undefined, "pnpm test");
  assert.equal(detail.display?.kind === "command_summary" ? detail.display.stdoutPreview : undefined, "RAW_STDOUT_SENTINEL");
});

test("tool stream projection preserves bounded read content for expanded detail", () => {
  const content = `content-start\n${"x".repeat(2_000)}\ncontent-end`;
  const detail = toolStreamDetail("tool.completed", {
    toolName: "read_file",
    input: { path: "README.md" },
    output: { path: "README.md", content },
  });

  assert.equal(detail.display?.kind, "read_result");
  assert.equal(detail.display?.kind === "read_result" ? detail.display.contentPreview : undefined, content);
  assertNoToolShadowFields(detail);
});

test("tool stream projection preserves failed execution error facts", () => {
  const detail = toolStreamDetail("tool.failed", {
    toolName: "shell_command",
    input: { command: "pnpm", args: ["missing"] },
    error: "spawn pnpm ENOENT",
    errorDomain: "process_error",
    errorFacts: {
      code: "ENOENT",
      syscall: "spawn",
      command: "pnpm",
    },
  });

  assert.equal(detail.errorDomain, "process_error");
  assert.equal(detail.errorFacts?.code, "ENOENT");
  assert.equal(detail.errorFacts?.syscall, "spawn");
  assert.equal(detail.errorFacts?.command, "pnpm");
});

test("tool stream projection keeps read HTTP failure facts in the structured error envelope", () => {
  const errorFacts = {
    code: "ECONNREFUSED",
    errno: -4078,
    syscall: "connect",
    address: "127.0.0.1",
    port: 54321,
    method: "GET",
    url: "http://127.0.0.1:54321/status",
    durationMs: 5,
  };
  const detail = toolStreamDetail("tool.completed", {
    toolName: "read",
    input: { ref: "http://127.0.0.1:54321/status" },
    output: {
      error: "http_request failed: ECONNREFUSED 127.0.0.1:54321",
      errorFacts,
      status: "provider-failed",
    },
  });

  assert.equal(detail.display?.kind, "read_result");
  assert.equal(detail.errorFacts?.code, "ECONNREFUSED");
  assert.equal(detail.errorFacts?.port, 54321);
  assert.equal(JSON.stringify(detail.display).includes("errorFacts"), false);
  assertNoToolShadowFields(detail);
});

test("tool stream projection reads flat HTTP failure facts", () => {
  const detail = toolStreamDetail("tool.completed", {
    toolName: "read",
    input: { ref: "https://example.test/missing" },
    output: {
      ref: "https://example.test/missing",
      status: "provider-failed",
      error: "Page read returned HTTP 404 Not Found.",
      errorFacts: {
        statusCode: 404,
        statusText: "Not Found",
        method: "GET",
        url: "https://example.test/missing",
        durationMs: 10,
      },
    },
  });

  assert.equal(detail.errorFacts?.statusCode, 404);
  assert.equal(detail.errorFacts?.statusText, "Not Found");
  assert.equal(detail.display?.kind === "read_result" ? detail.display.error : undefined, "Page read returned HTTP 404 Not Found.");
  assertNoToolShadowFields(detail);
});

test("tool stream projection surfaces search invalid-input messages", () => {
  const detail = toolStreamDetail("tool.completed", {
    toolName: "search",
    input: { query: "" },
    output: {
      query: "",
      researchStatus: "invalid-input",
      message: "search requires a non-empty query.",
      results: [],
    },
  });

  assert.equal(detail.display?.kind, "search_results");
  assert.equal(detail.display?.kind === "search_results" ? detail.display.message : undefined, "search requires a non-empty query.");
  assert.equal(JSON.stringify(detail.display).includes("researchStatus"), false);
  assertNoToolShadowFields(detail);
});

test("tool stream projection keeps ordinary tool copy free of diagnostic labels", () => {
  const requested = toolStreamDetail("tool.requested", {
    toolName: "read_file",
    input: {
      path: "README.md",
    },
    output: {},
  });
  const completedSummary = toolSummary("tool.completed", {
    toolName: "shell_command",
    input: {
      command: "pnpm",
      args: ["test"],
    },
    durationMs: 1234,
    output: {
      command: "pnpm",
      args: ["test"],
      exitCode: 0,
    },
  });

  assertNoToolShadowFields(requested);
  assert.equal(completedSummary.includes("exit 0"), false);
  assert.equal(completedSummary.includes("耗时"), false);
  assert.equal(completedSummary.includes("pnpm test"), false);
});

test("tool stream projection names failed tools as failed", () => {
  const summary = toolSummary("tool.failed", {
    toolName: "shell_command",
    input: { command: "pnpm", args: ["test"] },
    output: { command: "pnpm", args: ["test"] },
  });

  assert.equal(summary, "Shell 命令失败。");
  assert.equal(summary.includes("未完成"), false);
});

test("tool stream projection prefers commandLine over recombining argv text", () => {
  const detail = toolStreamDetail("tool.completed", {
    toolName: "shell_command",
    input: {
      commandLine: `node -e "console.log('fragile quoted shell')"`,
      command: "node",
      args: ["-e", "console.log('fragile quoted shell')"],
    },
    output: {
      command: "node",
      commandLine: `node -e "console.log('fragile quoted shell')"`,
      args: ["-e", "console.log('fragile quoted shell')"],
      exitCode: 0,
    },
  });

  assert.equal(
    detail.display?.kind === "command_summary" ? detail.display.commandLine : undefined,
    `node -e "console.log('fragile quoted shell')"`,
  );
  assert.equal(
    detail.display?.kind === "command_summary"
      ? detail.display.commandLine?.includes(`-e console.log('fragile quoted shell')`)
      : true,
    false,
  );
  assertNoToolShadowFields(detail);
});

test("tool stream projection does not recreate a legacy top-level preview", () => {
  const detail = toolStreamDetail("tool.completed", {
    toolName: "shell_command",
    input: {
      command: "dir",
    },
    output: {
      command: "dir",
      exitCode: 0,
    },
  });

  assertNoToolShadowFields(detail);
});

test("tool stream projection keeps command metadata out of the UI display contract", () => {
  const detail = toolStreamDetail("tool.completed", {
    toolName: "shell_command",
    input: {
      commandLine: "pnpm dev",
      cwd: "apps/web",
    },
    durationMs: 1530,
    output: {
      commandLine: "pnpm dev",
      cwd: "apps/web",
      exitCode: 0,
      timedOut: false,
      background: true,
      pid: 1234,
      logPath: "C:/Temp/agentarbor-command-logs/pnpm-dev.log",
      stopCommand: "taskkill /pid 1234 /T /F",
      waitForPort: 5173,
      portReady: true,
      stdoutTruncated: true,
      stderrTruncated: false,
      stdoutChars: 1200,
      stderrChars: 0,
      stdoutOmittedChars: 340,
    },
  });

  assert.equal(detail.display?.kind, "command_summary");
  assert.equal(detail.display?.kind === "command_summary" ? detail.display.commandLine : undefined, "pnpm dev");
  assert.equal(JSON.stringify(detail.display).includes("durationMs"), false);
  assert.equal(JSON.stringify(detail.display).includes("pid"), false);
  assert.equal(JSON.stringify(detail.display).includes("logPath"), false);
  assert.equal(JSON.stringify(detail.display).includes("stopCommand"), false);
  assert.equal(JSON.stringify(detail.display).includes("portReady"), false);
  assertNoToolShadowFields(detail);
});

test("tool stream projection carries edit diff preview in the file display", () => {
  const detail = toolStreamDetail("tool.completed", {
    toolName: "edit_file",
    input: {
      path: "src/app/example.ts",
      edits: [{ oldText: "INPUT OLD MUST STAY HIDDEN", newText: "INPUT NEW MUST STAY HIDDEN" }],
    },
    output: {
      path: "src/app/example.ts",
      replacements: 1,
      previousLength: 15,
      nextLength: 15,
      diff: {
        status: "available",
        unifiedDiff: "Index: src/app/example.ts\n--- src/app/example.ts\n+++ src/app/example.ts\n@@ -1,1 +1,1 @@\n-old text\n+new text\n",
      },
    },
  });

  assert.equal(detail.display?.kind, "file_diff_preview");
  assert.equal(detail.display?.kind === "file_diff_preview" ? detail.display.path : undefined, "src/app/example.ts");
  assert.equal(detail.display?.kind === "file_diff_preview" ? detail.display.operation : undefined, "edit");
  assert.equal(JSON.stringify(detail.display).includes("replacements"), false);
  assert.equal(detail.display?.kind === "file_diff_preview" ? detail.display.preview?.includes("-old text") : false, true);
  assert.equal(detail.display?.kind === "file_diff_preview" ? detail.display.preview?.includes("+new text") : false, true);
  assert.equal(detail.display?.kind === "file_diff_preview" ? detail.display.preview?.includes("INPUT OLD MUST STAY HIDDEN") : true, false);
  assertNoToolShadowFields(detail);
});

test("tool stream projection keeps multi-file output in one grouped display", () => {
  const detail = toolStreamDetail("tool.completed", {
    toolName: "workspace_patch",
    callId: "call-multi-file",
    output: {
      files: [
        {
          path: "src/app.ts",
          operation: "edit",
          diff: { status: "available", unifiedDiff: "@@ -1 +1 @@\n-old\n+new" },
        },
        {
          path: "src/app.test.ts",
          operation: "create",
          preview: "+test('app', () => true)",
        },
      ],
    },
  });

  assert.equal(detail.display?.kind, "file_change_group");
  assert.deepEqual(detail.display?.kind === "file_change_group"
    ? detail.display.files.map((file) => file.path)
    : [], ["src/app.ts", "src/app.test.ts"]);
});

test("tool stream projection uses the canonical file display for edit diffs", () => {
  const detail = toolStreamDetail("tool.completed", {
    toolName: "edit_file",
    input: {
      path: "src/app/example.ts",
      edits: [{ oldText: "old text", newText: "new text" }],
    },
    output: {
      path: "src/app/example.ts",
      replacements: 1,
      diff: {
        status: "available",
        unifiedDiff: "@@ -1,1 +1,1 @@\n-old text\n+new text\n",
      },
    },
  });

  const preview = detail.display?.kind === "file_diff_preview" ? detail.display.preview : undefined;
  assert.equal(preview?.includes("-old text"), true);
  assert.equal(preview?.includes("+new text"), true);
  assert.equal(preview?.includes("变更预览"), false);
  assert.equal(preview?.includes("替换：1 处"), false);
  assertNoToolShadowFields(detail);
});

test("tool stream projection does not fabricate a diff when canonical generation is unavailable", () => {
  const detail = toolStreamDetail("tool.completed", {
    toolName: "edit_file",
    input: {
      path: "src/app/example.ts",
      edits: [{ oldText: "same", newText: "updated", occurrence: 2, startLine: 4, endLine: 4 }],
    },
    output: {
      path: "src/app/example.ts",
      replacements: 1,
      previousLength: 15,
      nextLength: 18,
      diff: {
        status: "unavailable",
        reason: "input_limit_exceeded",
        beforeChars: 200000,
        afterChars: 200003,
        maxInputChars: 256000,
        timeoutMs: 100,
      },
    },
  });

  assert.equal(detail.display?.kind === "file_diff_preview" ? detail.display.preview : "unexpected", undefined);
  assertNoToolShadowFields(detail);
});

test("tool stream projection derives structured directory displays from attachment listings", () => {
  const detail = toolStreamDetail("tool.completed", {
    toolName: "list_context_attachment_files",
    input: {
      attachmentId: "ctx-project",
      path: ".",
      depth: 1,
    },
    output: {
      path: ".",
      depth: 1,
      entriesReturned: 9,
      totalEntries: 29,
      entries: [
        { path: "README.md", name: "README.md", kind: "file", bytes: 120, depth: 1 },
        { path: "src", name: "src", kind: "directory", depth: 1 },
      ],
      truncated: true,
    },
  });

  assert.equal(detail.display?.kind, "directory_listing");
  assert.equal(detail.display?.kind === "directory_listing" ? detail.display.entries[0]?.path : undefined, "README.md");
  assert.equal(JSON.stringify(detail.display).includes("totalEntries"), false);
  assert.equal(JSON.stringify(detail.display).includes("truncated"), false);
  assertNoToolShadowFields(detail);
});

test("tool stream projection keeps MCP text in display items without raw media payload", () => {
  const detail = toolStreamDetail("tool.completed", {
    toolName: "docs__lookup",
    input: {
      query: "AgentArbor MCP",
    },
    output: {
      text: "MCP 工具已通过冻结快照进入普通 Agent。",
      multimodal: [
        {
          type: "image",
          mimeType: "image/png",
          bytesApprox: 128,
          data: "RAW_BASE64_SENTINEL",
        },
      ],
    },
  });

  assert.equal(detail.display?.kind, "generic_tool_summary");
  assert.equal(
    detail.display?.kind === "generic_tool_summary"
      ? detail.display.items?.some((item) => item.includes("冻结快照"))
      : false,
    true,
  );
  assertNoToolShadowFields(detail);
  assert.equal(JSON.stringify(detail).includes("RAW_BASE64_SENTINEL"), false);
});

test("tool stream projection does not leak raw stdout as an unbounded top-level field", () => {
  const payload = {
    toolName: "shell_command",
    input: { commandLine: "pnpm test" },
    output: {
      commandLine: "pnpm test",
      exitCode: 0,
      stdout: "stdout sentinel",
    },
  };

  const detail = toolStreamDetail("tool.completed", payload);
  const summary = toolSummary("tool.completed", payload);
  const detailRecord = detail as Readonly<Record<string, unknown>>;

  assert.equal(summary.includes("pnpm test"), false);
  assert.equal(detail.display?.kind, "command_summary");
  assert.equal("command" in detailRecord, false);
  assert.equal(detailRecord.stdout, undefined);
  assert.equal(detail.display?.kind === "command_summary" ? detail.display.stdoutPreview : undefined, "stdout sentinel");
  assertNoToolShadowFields(detail);
});

function assertNoToolShadowFields(detail: ReturnType<typeof toolStreamDetail>): void {
  const record = detail as Readonly<Record<string, unknown>>;
  for (const field of ["action", "path", "query", "command", "exitCode", "preview", "truncated"]) {
    assert.equal(field in record, false, field);
  }
}
