import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptNode } from "../domain/basic-agent/index.js";
import {
  activityItemsForNodes,
  activityLineForNode,
  displayActivityItemsForNodes,
  readableThinkingCopy,
} from "./panel-transcript-activity-copy.js";
import { activityVisibleNodes } from "./panel-transcript-node-projection.js";

test("thinking copy keeps a single readable expandable detail without a label", () => {
  const text = "## 判断\n\n- 先检查工作区\n- 再决定是否需要确认";
  const copy = readableThinkingCopy(text);

  assert.equal(copy?.detail, "判断 先检查工作区 再决定是否需要确认");
  assert.equal(copy?.expandedDetail, undefined);
  assert.equal(copy?.label, undefined);
});

test("thinking copy folds normal Kimi reasoning text without duplicating the summary", () => {
  const text = [
    `The user is asking me to evaluate my own capabilities—essentially asking "what do you think of your abilities?"`,
    `"This is a reflective/metacognitive question about myself-assessment."`,
    "Interesting—there are already several capability demo files in the workspace.",
    "Let me look at one of them to see if there's previous context, and then give my honest self-assessment.",
    "The file exists but the summary doesn't show content. Let me read it with a maxLength to see content.",
  ].join("\n");
  const copy = readableThinkingCopy(text);

  assert.match(copy?.detail ?? "", /The user is asking me to evaluate my own capabilities/);
  assert.doesNotMatch(copy?.expandedDetail ?? "", /The user is asking me to evaluate my own capabilities/);
  assert.doesNotMatch(copy?.expandedDetail ?? "", /reflective\/metacognitive question/);
  assert.match(copy?.expandedDetail ?? "", /Let me look at one of them/);
  assert.match(copy?.expandedDetail ?? "", /maxLength to see content/);
});

test("thinking copy does not invent spaces in compact model text", () => {
  const text = "Theuserisaskingmetodemonstratemycapabilities.\nLetmeshowthemwhatIcandobyexploringthecurrentworkspace.";
  const copy = readableThinkingCopy(text);

  assert.equal(
    copy?.detail,
    "Theuserisaskingmetodemonstratemycapabilities. LetmeshowthemwhatIcandobyexploringthecurrentworkspace."
  );
  assert.equal(copy?.expandedDetail, undefined);
});

test("thinking copy preserves inline code and model punctuation", () => {
  const text = "OK, so `cmd` is rejected by sandbox policy. Good, file created. Node.js v24.15.0 works.";
  const copy = readableThinkingCopy(text);

  assert.equal(
    copy?.detail,
    "OK, so `cmd` is rejected by sandbox policy. Good, file created."
  );
  assert.equal(copy?.expandedDetail, "Node.js v24.15.0 works.");
});

test("thinking copy preserves natural mixed Chinese and English", () => {
  const text = "让我先看看当前工作环境，然后给你一个坦诚的评估。\nThe model output already contains spaces; the UI must not rewrite it.";
  const copy = readableThinkingCopy(text);

  assert.equal(copy?.detail, "让我先看看当前工作环境，然后给你一个坦诚的评估。 The model output already contains spaces; the UI must not rewrite it.");
  assert.equal(copy?.expandedDetail, undefined);
});

test("thinking copy keeps expanded detail to the folded overflow only", () => {
  const text = [
    "Let me analyze the results:",
    "",
    "**list_dir**: Workspace has37 entries, mostly markdown files related to capability demos.",
    "**search**: Successfully returned web search results about AI Agent capabilities in2025.",
    "**run_command**: Failed - python3 was rejected by sandbox policy.",
  ].join("\n");
  const copy = readableThinkingCopy(text);

  assert.match(copy?.detail ?? "", /^Let me analyze the results:/);
  assert.doesNotMatch(copy?.expandedDetail ?? "", /^Let me analyze the results:/);
  assert.doesNotMatch(copy?.expandedDetail ?? "", /^nt capabilities/);
  assert.match(copy?.expandedDetail ?? "", /python3 was rejected/);
});

test("confirmation copy presents concrete confirmation action", () => {
  const copy = activityLineForNode(node({
    kind: "confirmation",
    phase: "waiting_approval",
    summary: "删除文件：Z:\\AgentArbor\\tmp.txt",
    confirmation: {
      confirmationId: "confirmation-1",
      runId: "run-1",
      title: "需要你判断",
      actionSummary: "删除文件：Z:\\AgentArbor\\tmp.txt",
      affectedResources: [],
      riskLevel: "medium",
      requestedAt: "2026-06-04T00:00:00.000Z",
      sourceRefs: [],
    },
  }));

  assert.equal(copy?.label, "待处理");
  assert.equal(copy?.detail, "删除文件：Z:\\AgentArbor\\tmp.txt");
});

test("tool activity copy presents concrete generic targets", () => {
  const copy = activityLineForNode(node({
    kind: "tool",
    eventType: "tool.requested",
    phase: "preparing",
    toolName: "delete_file",
    display: {
      kind: "generic_tool_summary",
      action: "删除文件",
      summary: "删除文件：Z:\\AgentArbor\\tmp.txt",
    },
  }));

  assert.equal(copy?.label, "删除");
  assert.equal(copy?.detail, "Z:\\AgentArbor\\tmp.txt");
});

test("tool activity copy removes redundant target prefixes", () => {
  const read = activityLineForNode(node({
    kind: "tool",
    eventType: "tool.requested",
    phase: "executing",
    toolName: "read_file",
    display: {
      kind: "generic_tool_summary",
      action: "读取文件",
      summary: "目标：ability_live_demo_2025-07-31.md",
    },
  }));
  const search = activityLineForNode(node({
    kind: "tool",
    eventType: "tool.requested",
    phase: "executing",
    toolName: "search",
    display: {
      kind: "generic_tool_summary",
      action: "搜索",
      summary: "搜索：能力|capability|demo",
    },
  }));
  const command = activityLineForNode(node({
    kind: "tool",
    eventType: "tool.requested",
    phase: "executing",
    toolName: "shell_command",
    display: {
      kind: "generic_tool_summary",
      action: "命令",
      summary: "命令：dir *.md",
    },
  }));

  assert.deepEqual(read, { label: "读取", detail: "ability_live_demo_2025-07-31.md" });
  assert.deepEqual(search, { label: "搜索", detail: "能力|capability|demo" });
  assert.deepEqual(command, { label: "命令", detail: "dir *.md" });
});

test("tool activity copy prefers concrete command text over generic status", () => {
  const copy = activityLineForNode(node({
    kind: "tool",
    eventType: "tool.requested",
    phase: "executing",
    toolName: "shell_command",
    display: {
      kind: "command_summary",
      command: "git",
      args: ["diff", "--check"],
    },
  }));

  assert.deepEqual(copy, {
    label: "命令",
    detail: "git diff --check",
  });
});

test("tool activity copy keeps aggregated file details expandable", () => {
  const copy = activityLineForNode(node({
    kind: "tool",
    eventType: "tool.completed",
    phase: "completed",
    toolName: "read_file",
    display: {
      kind: "generic_tool_summary",
      action: "读取文件",
      items: ["README.md", "package.json"],
    },
  }));

  assert.deepEqual(copy, {
    label: "读取",
    detail: "2 个文件",
    expandedDetail: "README.md\npackage.json",
  });
});

test("tool activity copy prefers summary while keeping multi-item details expandable", () => {
  const copy = activityLineForNode(node({
    kind: "tool",
    eventType: "tool.completed",
    phase: "completed",
    toolName: "list_dir",
    display: {
      kind: "generic_tool_summary",
      action: "浏览目录",
      summary: ". · 30 entries",
      items: ["file README.md", "file package.json", "[truncated]"],
    },
  }));

  assert.deepEqual(copy, {
    label: "查看",
    detail: "当前目录 · 30 entries",
    expandedDetail: "README.md\npackage.json\n[truncated]",
  });
});

test("tool activity copy surfaces safe failed command details", () => {
  const copy = activityLineForNode(node({
    kind: "tool",
    eventType: "tool.failed",
    phase: "failed",
    toolName: "shell_command",
    display: {
      kind: "command_summary",
      command: "pnpm",
      args: ["test"],
      exitCode: 1,
      errorSummary: "测试失败：1 个断言未通过",
    },
  }));

  assert.deepEqual(copy, {
    label: "命令",
    detail: "pnpm test · 测试失败：1 个断言未通过",
  });
});

test("tool activity copy omits generic events without concrete target", () => {
  const requested = activityLineForNode(node({
    kind: "tool",
    eventType: "tool.requested",
    phase: "executing",
    toolName: "unknown_tool",
  }));
  const completed = activityLineForNode(node({
    kind: "tool",
    eventType: "tool.completed",
    phase: "completed",
    toolName: "unknown_tool",
  }));

  assert.equal(requested, undefined);
  assert.equal(completed, undefined);
});

test("narration copy strips markdown emphasis and numbered emoji prefixes", () => {
  const copy = activityLineForNode(node({
    kind: "system",
    eventType: "model.side.completed",
    phase: "completed",
    summary: "**2. 🔍 文本搜索 — 在工作区中搜索关键词：**",
  }));

  assert.deepEqual(copy, {
    detail: "文本搜索 — 在工作区中搜索关键词：",
  });
});

test("narration copy keeps dotted product and version text together", () => {
  const copy = activityLineForNode(node({
    kind: "system",
    eventType: "model.side.completed",
    phase: "completed",
    summary: "✅ 命令执行成功 — Node.js v24.15.0 可用",
  }));

  assert.deepEqual(copy, {
    detail: "命令执行成功 — Node.js v24.15.0 可用",
  });
});

test("user decision activity copy preserves visible decision text", () => {
  const copy = activityLineForNode(node({
    kind: "user_decision",
    eventType: "user.guidance",
    phase: "guidance",
    summary: "已收到补充要求：不要删除文件，只列出将要删除的路径。",
  }));

  assert.deepEqual(copy, {
    detail: "不要删除文件，只列出将要删除的路径。",
  });
});

test("user decision activity copy strips restored guidance boilerplate", () => {
  const copy = activityLineForNode(node({
    kind: "user_decision",
    eventType: "user.guidance",
    phase: "guidance",
    summary: "用户已补充要求：只列出路径，不执行删除。",
  }));

  assert.deepEqual(copy, {
    detail: "只列出路径，不执行删除。",
  });
});

test("user decision activity copy omits generic approval progress", () => {
  const copy = activityLineForNode(node({
    kind: "user_decision",
    eventType: "run.resumed",
    phase: "approved",
    summary: "继续处理。",
  }));

  assert.equal(copy, undefined);
});

test("activity item projection derives stable render metadata outside React components", () => {
  const items = activityItemsForNodes([
    node({
      kind: "thinking",
      eventType: "model.reasoning.completed",
      phase: "completed",
      text: "先判断目标",
    }),
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "read_file",
      summary: "README.md",
    }),
  ]);

  assert.equal(items.length, 2);
  assert.equal(items[0]?.tone, "thinking");
  assert.equal(items[0]?.phase, "completed");
  assert.equal(items[0]?.key.includes("thinking"), true);
  assert.equal(items[1]?.tone, "tool");
});

test("display activity items collapse requested and terminal tool phases into one expandable action", () => {
  const items = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.requested",
      phase: "executing",
      toolName: "read_file",
      summary: "目标：README.md",
      refs: [{ kind: "tool_call", id: "tool-1" }],
    }),
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "read_file",
      summary: "README.md · 120 bytes",
      refs: [{ kind: "tool_call", id: "tool-1" }],
    }),
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.copy.label, "读取");
  assert.equal(items[0]?.copy.detail, "README.md");
  assert.equal(items[0]?.copy.expandedDetail, undefined);
});

test("display activity items show a pending command approval once with the concrete command", () => {
  const nodes = [
    node({
      kind: "tool",
      eventType: "tool.requested",
      phase: "preparing",
      toolName: "shell_command",
      display: {
        kind: "command_summary",
        command: "pnpm",
        args: ["test"],
      },
      refs: [{ kind: "tool_call", id: "tool-1" }],
    }),
    node({
      kind: "confirmation",
      eventType: "confirmation.needed",
      phase: "waiting_approval",
      summary: "执行 Shell：pnpm test",
      confirmation: {
        confirmationId: "confirmation-tool-1",
        runId: "run-1",
        title: "执行 Shell",
        actionSummary: "执行 Shell：pnpm test",
        affectedResources: [],
        riskLevel: "medium",
        requestedAt: "2026-06-04T00:00:00.000Z",
        sourceRefs: [],
      },
      refs: [{ kind: "tool_call", id: "tool-1" }],
    }),
  ];
  const items = displayActivityItemsForNodes(activityVisibleNodes(nodes));

  assert.deepEqual(items.map((item) => item.tone), ["confirmation"]);
  assert.equal(items[0]?.copy.label, "待处理");
  assert.equal(items[0]?.copy.detail, "执行 Shell：pnpm test");
});

test("activity item keys stay stable while reasoning settles", () => {
  const delta = activityItemsForNodes([
    node({
      kind: "thinking",
      eventType: "model.reasoning.delta",
      phase: "noted",
      text: "先判断目标",
      refs: [{ kind: "model_call", id: "model-1" }],
    }),
  ]);
  const completed = activityItemsForNodes([
    node({
      kind: "thinking",
      eventType: "model.reasoning.completed",
      phase: "completed",
      text: "先判断目标，再读取文件",
      refs: [{ kind: "model_call", id: "model-1" }],
    }),
  ]);

  assert.equal(delta[0]?.key, completed[0]?.key);
});

function node(input: {
  readonly kind: TranscriptNode["kind"];
  readonly eventType?: string;
  readonly phase: TranscriptNode["phase"];
  readonly title?: string;
  readonly summary?: string;
  readonly text?: string;
  readonly toolName?: string;
  readonly display?: TranscriptNode["display"];
  readonly confirmation?: TranscriptNode["confirmation"];
  readonly refs?: TranscriptNode["refs"];
}): TranscriptNode {
  return {
    nodeId: "node-1",
    runId: "run-1",
    sequence: 1,
    eventType: input.eventType ?? "agent.note.completed",
    kind: input.kind,
    phase: input.phase,
    title: input.title ?? input.kind,
    summary: input.summary,
    text: input.text,
    timestamp: "2026-06-04T00:00:00.000Z",
    toolName: input.toolName,
    display: input.display,
    confirmation: input.confirmation,
    refs: input.refs ?? [],
  };
}
