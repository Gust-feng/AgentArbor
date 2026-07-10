import assert from "node:assert/strict";
import test from "node:test";
import { projectToolApprovalRequired, projectToolFailure, projectToolResult, redactOrdinaryMarkdownFragment } from "./safe-projection.js";

test("custom file write action projects as file change display", () => {
  const projection = projectToolResult({
    request: {
      callId: "call-custom-write",
      toolName: "workspace__write_file",
      input: { path: "notes/custom.md", content: "RAW_CUSTOM_BODY" },
    },
    output: {
      action: "write_file",
      summary: "notes/custom.md written",
      result: {
        path: "notes/custom.md",
        bytes: 15,
      },
    },
  });

  assert.equal(projection.display?.kind, "file_change_summary");
  assert.equal(projection.display?.kind === "file_change_summary" ? projection.display.path : undefined, "notes/custom.md");
  assert.equal(projection.display?.kind === "file_change_summary" ? projection.display.operation : undefined, "write");
  assert.equal(projection.envelope?.uiDisplay?.kind, "file_change_summary");
  assert.equal(projection.envelope?.uiDisplay?.kind === "file_change_summary" ? projection.envelope.uiDisplay.operation : undefined, "write");
  assert.equal(projection.envelope?.evidenceRefs.includes("file:notes/custom.md"), true);
  assert.equal(JSON.stringify(projection.display).includes("RAW_CUSTOM_BODY"), false);
});

test("tool model result preserves read_file content and path facts", () => {
  const projection = projectToolResult({
    request: {
      callId: "call-canonical-read-file",
      toolName: "read_file",
      input: { path: "src/app.ts" },
    },
    output: {
      action: "read_file",
      summary: "文件已读取。",
      result: {
        path: "src/app.ts",
        startLine: 10,
        endLine: 12,
        totalLines: 30,
        content: "export const value = 1;\nexport const next = 2;",
      },
    },
  });

  assert.equal(projection.modelResult?.content[0]?.type, "text");
  assert.match(projection.modelResult?.content[0]?.type === "text" ? projection.modelResult.content[0].text : "", /export const value/);
  const structured = projection.modelResult?.structuredContent as {
    readonly path?: string;
    readonly startLine?: number;
    readonly endLine?: number;
  };
  assert.equal(structured.path, "src/app.ts");
  assert.equal(structured.startLine, 10);
  assert.equal(structured.endLine, 12);
  assert.equal(/已完成|完成/.test(projection.uiSummary ?? ""), false);
});

test("tool model result preserves stdout stderr and exit facts", () => {
  const projection = projectToolResult({
    request: {
      callId: "call-canonical-command",
      toolName: "shell_command",
      input: { commandLine: "pnpm test" },
    },
    output: {
      action: "shell_command",
      summary: "pnpm test · exit 1",
      result: {
        commandLine: "pnpm test",
        cwd: "Z:/AgentArbor",
        exitCode: 1,
        stdout: "stdout sentinel line",
        stderr: "stderr sentinel line",
        logRef: "command-log://run/tool",
      },
    },
  });

  const structured = projection.modelResult?.structuredContent as {
    readonly commandLine?: string;
    readonly cwd?: string;
    readonly exitCode?: number;
    readonly stdout?: string;
    readonly stderr?: string;
    readonly logRef?: string;
  };

  assert.equal(projection.modelResult?.isError, true);
  assert.equal(structured.commandLine, "pnpm test");
  assert.equal(structured.cwd, "Z:/AgentArbor");
  assert.equal(structured.exitCode, 1);
  assert.equal(structured.stdout, "stdout sentinel line");
  assert.equal(structured.stderr, "stderr sentinel line");
  assert.equal(structured.logRef, "command-log://run/tool");
  assert.equal(JSON.stringify(projection.modelResult).includes("safe summary"), false);
  assert.equal(projection.display?.kind, "command_summary");
});

test("tool model result preserves MCP content structuredContent and isError", () => {
  const projection = projectToolResult({
    request: {
      callId: "call-canonical-mcp",
      toolName: "docs__lookup",
      input: { query: "tool result" },
    },
    output: {
      summary: "Lookup failed with useful text.",
      mcpResult: {
        content: [{ type: "text", text: "Server says the lookup failed but returned context." }],
        structuredContent: {
          code: "LOOKUP_FAILED",
          retryable: false,
        },
        isError: true,
      },
      result: {
        text: "Server says the lookup failed but returned context.",
        structuredContent: {
          code: "LOOKUP_FAILED",
          retryable: false,
        },
      },
      isError: true,
    },
  });

  assert.equal(projection.modelResult?.isError, true);
  assert.deepEqual(projection.modelResult?.structuredContent, {
    code: "LOOKUP_FAILED",
    retryable: false,
  });
  assert.equal(projection.modelResult?.content[0]?.type, "text");
  const agentContent = projection.agentContent as {
    readonly content?: readonly { readonly type?: string; readonly text?: string }[];
    readonly structuredContent?: unknown;
    readonly isError?: boolean;
  };
  assert.deepEqual(agentContent.structuredContent, {
    code: "LOOKUP_FAILED",
    retryable: false,
  });
  assert.equal(agentContent.isError, true);
  assert.equal(agentContent.content?.[0]?.text, "Server says the lookup failed but returned context.");
  assert.deepEqual(projection.modelResult?.structuredContent, {
    code: "LOOKUP_FAILED",
    retryable: false,
  });
  assert.equal(projection.modelResult?.isError, true);
});

test("tool model result keeps multi-file diffs as separate file blocks", () => {
  const diff = [
    "diff --git a/src/one.ts b/src/one.ts",
    "@@ line 1",
    "- old one",
    "+ new one",
    "diff --git a/src/two.ts b/src/two.ts",
    "@@ line 2",
    "- old two",
    "+ new two",
  ].join("\n");
  const projection = projectToolResult({
    request: {
      callId: "call-canonical-edit",
      toolName: "edit_file",
      input: { path: "src/one.ts" },
    },
    output: {
      action: "edit_file",
      summary: "2 files changed",
      display: {
        kind: "file_diff_preview",
        preview: diff,
      },
      result: {
        path: "src/one.ts",
        replacements: 2,
      },
    },
  });

  const structured = projection.modelResult?.structuredContent as {
    readonly files?: readonly { readonly path?: string; readonly diff: string }[];
  };

  assert.equal(projection.display?.kind, "file_diff_preview");
  assert.equal(structured.files?.length, 2);
  assert.equal(structured.files?.[0]?.path, "src/one.ts");
  assert.equal(structured.files?.[1]?.path, "src/two.ts");
  assert.equal(structured.files?.[0]?.diff.includes("new two"), false);
  assert.equal(structured.files?.[1]?.diff.includes("new one"), false);
});

test("approval projection exposes model approval shape", () => {
  const projection = projectToolApprovalRequired({
    request: {
      callId: "call-approval",
      toolName: "shell_command",
      input: { commandLine: "pnpm publish" },
    },
    toolName: "shell_command",
    operationType: "execute",
    actionSummary: "执行命令：pnpm publish",
  });

  const structured = projection.modelResult?.structuredContent as { readonly status?: string; readonly actionSummary?: string };
  assert.equal(structured.status, "waiting_approval");
  assert.equal(structured.actionSummary, "执行命令：pnpm publish");
  assert.equal(projection.modelResult?.content[0]?.type, "text");
  assert.equal(projection.uiSummary, "执行命令：pnpm publish");
});
