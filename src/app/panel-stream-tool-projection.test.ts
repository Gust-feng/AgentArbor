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
      envelope: {
        agentSummary: "安全命令摘要",
        evidenceRefs: ["tool:tool-1"],
        rawRetention: "none",
        redacted: false,
      },
    },
  };

  const detail = toolStreamDetail("tool.completed", payload);

  assert.equal(toolSummary("tool.completed", payload).includes("测试已通过"), true);
  assert.equal(detail.command, "pnpm test");
  assert.equal(detail.preview, "测试已通过");
  assert.equal(detail.display?.kind, "command_summary");
  assert.equal(detail.display?.kind === "command_summary" ? detail.display.commandLine : undefined, "pnpm test");
  assert.equal(detail.envelope?.rawRetention, "none");
  assert.equal(JSON.stringify(detail).includes("RAW_STDOUT_SENTINEL"), false);
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
  assert.equal(detail.preview, `node -e "console.log('fragile quoted shell')"`);
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

  assert.equal(detail.preview, "dir");
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

  assert.equal(detail.preview?.includes("src/app/example.ts · 1 处修改"), true);
  assert.equal(detail.preview?.includes("变更预览"), true);
  assert.equal(detail.preview?.includes("替换：1 处"), true);
  assert.equal(detail.preview?.includes("occurrence"), false);
  assert.equal(detail.preview?.includes("same"), false);
  assert.equal(detail.preview?.includes("updated"), false);
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
      envelope: {
        agentSummary: "找到 MCP 能力底座说明。",
        evidenceRefs: ["tool:call-mcp"],
        rawRetention: "none",
        redacted: false,
      },
    },
  });

  assert.equal(detail.preview?.includes("冻结快照"), true);
  assert.equal(detail.display?.kind, "generic_tool_summary");
  assert.equal(detail.envelope?.rawRetention, "none");
  assert.equal(JSON.stringify(detail).includes("RAW_BASE64_SENTINEL"), false);
});
