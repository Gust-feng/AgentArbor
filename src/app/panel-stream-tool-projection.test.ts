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
        exitCode: 0,
        outputSummary: "测试已通过",
      },
      envelope: {
        agentSummary: "安全命令摘要",
        evidenceRefs: ["tool:tool-1"],
        rawRetention: "diagnostic_ref_only",
        redacted: true,
      },
    },
  };

  const detail = toolStreamDetail("tool.completed", payload);

  assert.equal(toolSummary("tool.completed", payload).includes("测试已通过"), true);
  assert.equal(detail.command, "pnpm test");
  assert.equal(detail.preview, "测试已通过");
  assert.equal(detail.display?.kind, "command_summary");
  assert.equal(detail.envelope?.rawRetention, "diagnostic_ref_only");
  assert.equal(JSON.stringify(detail).includes("RAW_STDOUT_SENTINEL"), false);
});

test("tool stream projection shows file change metadata without raw replacement text", () => {
  const detail = toolStreamDetail("tool.completed", {
    toolName: "edit_file",
    input: {
      path: "src/app/example.ts",
      oldText: "secret old text",
      newText: "secret new text",
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

  assert.equal(detail.preview?.includes("文件已更新"), true);
  assert.equal(detail.preview?.includes("secret old text"), false);
  assert.equal(detail.preview?.includes("secret new text"), false);
});
