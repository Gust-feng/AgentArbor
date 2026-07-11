import assert from "node:assert/strict";
import test from "node:test";
import { toolStreamDetail, toolSummary } from "./panel-stream-tool-projection.js";

test("tool stream projection keeps command output as safe summary", () => {
  const payload = {
    toolName: "shell_command",
    input: { command: "pnpm", args: ["test"] },
    output: {
      action: "shell_command",
      summary: "测试已通过",
      result: {
        command: "pnpm",
        args: ["test"],
        exitCode: 0,
        stdout: "RAW_STDOUT_SENTINEL",
      },
      display: {
        kind: "command_summary",
        command: "pnpm",
        args: ["test"],
        commandLine: "pnpm test",
        exitCode: 0,
        outputSummary: "测试已通过",
      },
    },
  };

  const detail = toolStreamDetail("tool.completed", payload);

  assert.equal(toolSummary("tool.completed", payload).includes("测试已通过"), true);
  assert.equal(detail.command, "pnpm test");
  assert.equal(detail.preview, "pnpm test · exit 0 · 测试已通过");
  assert.equal(detail.display?.kind, "command_summary");
  assert.equal(detail.display?.kind === "command_summary" ? detail.display.commandLine : undefined, "pnpm test");
  assert.equal(JSON.stringify(detail).includes("RAW_STDOUT_SENTINEL"), false);
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

test("tool stream projection surfaces read HTTP failure facts in preview and detail", () => {
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
      action: "读取资料",
      summary: "资料读取已完成。",
      display: {
        kind: "read_result",
        ref: "http://127.0.0.1:54321/status",
        status: "provider-failed",
        error: "http_request failed: ECONNREFUSED 127.0.0.1:54321",
        errorFacts,
      },
      result: {},
    },
  });

  assert.equal(detail.display?.kind, "read_result");
  assert.equal(detail.display?.kind === "read_result" ? detail.display.errorFacts?.code : undefined, "ECONNREFUSED");
  assert.equal(detail.errorFacts?.code, "ECONNREFUSED");
  assert.equal(detail.errorFacts?.port, 54321);
  assert.equal(detail.preview?.includes("ECONNREFUSED"), true);
  assert.equal(detail.preview?.includes("errorFacts"), true);
});

test("tool stream projection extracts read HTTP failure facts from raw trace output", () => {
  const detail = toolStreamDetail("tool.completed", {
    toolName: "read",
    input: { ref: "https://example.test/missing" },
    output: {
      action: "read",
      ref: "https://example.test/missing",
      status: "provider-failed",
      trace: {
        traceId: "research-trace-http-404",
        action: "read",
        ref: "https://example.test/missing",
        requestedSources: ["page"],
        status: "provider-failed",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:00.010Z",
        sourceSteps: [
          {
            source: "page",
            status: "provider-failed",
            resultRefs: [],
            message: "Page read returned HTTP 404 Not Found.",
            errorFacts: {
              statusCode: 404,
              statusText: "Not Found",
              method: "GET",
              url: "https://example.test/missing",
              durationMs: 10,
            },
          },
        ],
      },
    },
  });

  assert.equal(detail.errorFacts?.statusCode, 404);
  assert.equal(detail.errorFacts?.statusText, "Not Found");
  assert.equal(detail.preview?.includes("HTTP 404 Not Found"), true);
  assert.equal(detail.preview?.includes("errorFacts"), true);
});

test("tool stream projection surfaces search invalid-input messages", () => {
  const detail = toolStreamDetail("tool.completed", {
    toolName: "search",
    input: { query: "" },
    output: {
      action: "search",
      display: {
        kind: "search_results",
        query: "",
        status: "invalid-input",
        message: "search requires a non-empty query.",
        results: [],
      },
    },
  });

  assert.equal(detail.display?.kind, "search_results");
  assert.equal(detail.display?.kind === "search_results" ? detail.display.message : undefined, "search requires a non-empty query.");
  assert.equal(detail.preview?.includes("invalid-input"), true);
  assert.equal(detail.preview?.includes("search requires a non-empty query."), true);
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
      summary: "pnpm test · exit 0",
      result: {
        command: "pnpm",
        args: ["test"],
        exitCode: 0,
      },
    },
  });

  assert.equal(requested.preview, "README.md");
  assert.equal(completedSummary.includes("exit 0"), false);
  assert.equal(completedSummary.includes("耗时"), false);
  assert.equal(completedSummary.includes("pnpm test"), true);
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
      summary: `node -e "console.log('fragile quoted shell')" · exit 0`,
      result: {
        command: "node",
        commandLine: `node -e "console.log('fragile quoted shell')"`,
        args: ["-e", "console.log('fragile quoted shell')"],
        exitCode: 0,
      },
    },
  });

  assert.equal(detail.command, `node -e "console.log('fragile quoted shell')"`);
  assert.equal(detail.command?.includes(`-e console.log('fragile quoted shell')`), false);
  assert.equal(detail.preview, `node -e "console.log('fragile quoted shell')" · exit 0`);
});

test("tool stream projection cleans restored ordinary tool preview labels", () => {
  const detail = toolStreamDetail("tool.completed", {
    toolName: "shell_command",
    input: {
      command: "dir",
    },
    output: {
      summary: "运行命令：dir · exit 0",
      result: {
        command: "dir",
        exitCode: 0,
      },
    },
  });

  assert.equal(detail.preview, "dir · exit 0");
});

test("tool stream projection exposes command execution facts for UI display", () => {
  const detail = toolStreamDetail("tool.completed", {
    toolName: "shell_command",
    input: {
      commandLine: "pnpm dev",
      cwd: "apps/web",
    },
    durationMs: 1530,
    output: {
      summary: "dev server started",
      result: {
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
    },
  });

  assert.equal(detail.display?.kind, "command_summary");
  assert.equal(detail.display?.kind === "command_summary" ? detail.display.durationMs : undefined, 1530);
  assert.equal(detail.display?.kind === "command_summary" ? detail.display.pid : undefined, 1234);
  assert.equal(detail.display?.kind === "command_summary" ? detail.display.logPath : undefined, "C:/Temp/agentarbor-command-logs/pnpm-dev.log");
  assert.equal(detail.display?.kind === "command_summary" ? detail.display.stopCommand : undefined, "taskkill /pid 1234 /T /F");
  assert.equal(detail.display?.kind === "command_summary" ? detail.display.portReady : undefined, true);
  assert.equal(detail.preview?.includes("exit 0"), true);
  assert.equal(detail.preview?.includes("1.5s"), true);
  assert.equal(detail.preview?.includes("后台 pid 1234"), true);
  assert.equal(detail.preview?.includes("port 5173 ready"), true);
  assert.equal(detail.preview?.includes("stdout truncated 1200 chars 340 omitted"), true);
  assert.equal(detail.preview?.includes("stderr not truncated 0 chars"), true);
});

test("tool stream projection carries edit diff preview in the file display", () => {
  const detail = toolStreamDetail("tool.completed", {
    toolName: "edit_file",
    input: {
      path: "src/app/example.ts",
      edits: [{ oldText: "old text", newText: "new text" }],
    },
    output: {
      summary: "文件已更新",
      result: {
        path: "src/app/example.ts",
        replacements: 1,
        previousLength: 15,
        nextLength: 15,
      },
    },
  });

  assert.equal(detail.preview?.includes("文件已更新"), false);
  assert.equal(detail.preview?.includes("- old text"), true);
  assert.equal(detail.preview?.includes("+ new text"), true);
  assert.equal(detail.display?.kind, "file_diff_preview");
  assert.equal(detail.display?.kind === "file_diff_preview" ? detail.display.path : undefined, "src/app/example.ts");
  assert.equal(detail.display?.kind === "file_diff_preview" ? detail.display.operation : undefined, "edit");
  assert.equal(detail.display?.kind === "file_diff_preview" ? detail.display.replacements : undefined, 1);
  assert.equal(detail.display?.kind === "file_diff_preview" ? detail.display.preview?.includes("- old text") : false, true);
  assert.equal(detail.display?.kind === "file_diff_preview" ? detail.display.preview?.includes("+ new text") : false, true);
});

test("tool stream projection uses the file diff as the edit preview", () => {
  const detail = toolStreamDetail("tool.completed", {
    toolName: "edit_file",
    input: {
      path: "src/app/example.ts",
      edits: [{ oldText: "old text", newText: "new text" }],
    },
    output: {
      summary: "src/app/example.ts · 1 处修改",
      result: {
        path: "src/app/example.ts",
        replacements: 1,
      },
    },
  });

  assert.equal(detail.preview?.includes("- old text"), true);
  assert.equal(detail.preview?.includes("+ new text"), true);
  assert.equal(detail.preview?.includes("变更预览"), false);
  assert.equal(detail.preview?.includes("替换：1 处"), false);
});

test("tool stream projection keeps edit preview focused on file-level summary", () => {
  const detail = toolStreamDetail("tool.completed", {
    toolName: "edit_file",
    input: {
      path: "src/app/example.ts",
      edits: [{ oldText: "same", newText: "updated", occurrence: 2, startLine: 4, endLine: 4 }],
    },
    output: {
      summary: "src/app/example.ts · 1 处修改",
      result: {
        path: "src/app/example.ts",
        replacements: 1,
        previousLength: 15,
        nextLength: 18,
      },
    },
  });

  assert.equal(detail.preview?.includes("@@ occurrence 2 · line 4"), true);
  assert.equal(detail.preview?.includes("- same"), true);
  assert.equal(detail.preview?.includes("+ updated"), true);
  assert.equal(detail.preview?.includes("变更预览"), false);
  assert.equal(detail.preview?.includes("替换：1 处"), false);
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
      action: "list_context_attachment_files",
      summary: "项目:. · 9 of 29 entries · depth 1 · truncated",
      result: {
        path: ".",
        depth: 1,
        entriesReturned: 9,
        totalEntries: 29,
        entries: [
          { path: "README.md", name: "README.md", kind: "file", bytes: 120, depth: 1 },
          { path: "src", name: "src", kind: "directory", depth: 1 },
        ],
      },
      truncated: true,
    },
  });

  assert.equal(detail.display?.kind, "directory_listing");
  assert.equal(detail.display?.kind === "directory_listing" ? detail.display.totalEntries : undefined, 29);
  assert.equal(detail.display?.kind === "directory_listing" ? detail.display.entries[0]?.path : undefined, "README.md");
  assert.equal(detail.preview?.includes("项目"), true);
});

test("tool stream projection shows MCP preview without raw media payload", () => {
  const detail = toolStreamDetail("tool.completed", {
    toolName: "docs__lookup",
    input: {
      query: "AgentArbor MCP",
    },
    output: {
      summary: "找到 MCP 能力底座说明。",
      result: {
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
      display: {
        kind: "generic_tool_summary",
        action: "MCP 查询",
        summary: "找到 MCP 能力底座说明。",
        items: [
          "MCP 工具已通过冻结快照进入普通 Agent。",
          "非文本内容：image，MIME：image/png，约 128 字节",
        ],
      },
    },
  });

  assert.equal(detail.preview?.includes("冻结快照"), true);
  assert.equal(detail.display?.kind, "generic_tool_summary");
  assert.equal(JSON.stringify(detail).includes("RAW_BASE64_SENTINEL"), false);
});

test("tool stream projection keeps model result fields out of UI detail", () => {
  const payload = {
    toolName: "shell_command",
    input: { commandLine: "pnpm test" },
    output: {
      canonicalResult: {
        content: [{ type: "text", text: "stdout sentinel" }],
        structuredContent: {
          commandLine: "pnpm test",
          exitCode: 0,
          stdout: "stdout sentinel",
        },
      },
      presentation: {
        explanation: {
          text: "测试命令返回了可查看的输出。",
          source: "runtime_fallback",
        },
        displayShape: "terminal",
      },
      result: {
        commandLine: "pnpm test",
        exitCode: 0,
      },
    },
  };

  const detail = toolStreamDetail("tool.completed", payload);
  const summary = toolSummary("tool.completed", payload);
  const detailRecord = detail as Readonly<Record<string, unknown>>;

  assert.equal(summary.includes("测试命令返回了可查看的输出"), false);
  assert.equal(summary.includes("pnpm test"), true);
  assert.equal(detail.display?.kind, "command_summary");
  assert.equal(detail.command, "pnpm test");
  assert.equal(detailRecord.presentation, undefined);
  assert.equal(detailRecord.canonicalResult, undefined);
});
