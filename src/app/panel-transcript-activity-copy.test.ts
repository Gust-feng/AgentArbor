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

test("thinking copy keeps the line minimal and puts the full thought in detail", () => {
  const text = "## 判断\n\n- 先检查工作区\n- 再决定是否需要确认";
  const copy = readableThinkingCopy(text);

  assert.equal(copy?.detail, "思考中");
  assert.equal(copy?.expandedDetail, "判断\n\n先检查工作区\n再决定是否需要确认");
  assert.equal(copy?.label, undefined);
});

test("thinking copy keeps normal Kimi reasoning fully expandable", () => {
  const text = [
    `The user is asking me to evaluate my own capabilities—essentially asking "what do you think of your abilities?"`,
    `"This is a reflective/metacognitive question about myself-assessment."`,
    "Interesting—there are already several capability demo files in the workspace.",
    "Let me look at one of them to see if there's previous context, and then give my honest self-assessment.",
    "The file exists but the summary doesn't show content. Let me read it with a maxLength to see content.",
  ].join("\n");
  const copy = readableThinkingCopy(text);

  assert.equal(copy?.detail, "思考中");
  assert.match(copy?.expandedDetail ?? "", /The user is asking me to evaluate my own capabilities/);
  assert.match(copy?.expandedDetail ?? "", /reflective\/metacognitive question/);
  assert.match(copy?.expandedDetail ?? "", /Let me look at one of them/);
  assert.match(copy?.expandedDetail ?? "", /maxLength to see content/);
});

test("thinking copy does not invent spaces in compact model text", () => {
  const text = "Theuserisaskingmetodemonstratemycapabilities.\nLetmeshowthemwhatIcandobyexploringthecurrentworkspace.";
  const copy = readableThinkingCopy(text);

  assert.equal(copy?.detail, "思考中");
  assert.equal(copy?.expandedDetail, "Theuserisaskingmetodemonstratemycapabilities.\nLetmeshowthemwhatIcandobyexploringthecurrentworkspace.");
});

test("thinking copy preserves inline code and model punctuation", () => {
  const text = "OK, so `cmd` is rejected by sandbox policy. Good, file created. Node.js v24.15.0 works.";
  const copy = readableThinkingCopy(text);

  assert.equal(copy?.detail, "思考中");
  assert.equal(copy?.expandedDetail, "OK, so `cmd` is rejected by sandbox policy. Good, file created. Node.js v24.15.0 works.");
});

test("thinking copy preserves natural mixed Chinese and English", () => {
  const text = "让我先看看当前工作环境，然后给你一个坦诚的评估。\nThe model output already contains spaces; the UI must not rewrite it.";
  const copy = readableThinkingCopy(text);

  assert.equal(copy?.detail, "思考中");
  assert.equal(copy?.expandedDetail, "让我先看看当前工作环境，然后给你一个坦诚的评估。\nThe model output already contains spaces; the UI must not rewrite it.");
});

test("thinking copy keeps the entire thought in the expanded detail", () => {
  const text = [
    "Let me analyze the results:",
    "",
    "**list_dir**: Workspace has37 entries, mostly markdown files related to capability demos.",
    "**search**: Successfully returned web search results about AI Agent capabilities in2025.",
    "**run_command**: Failed - python3 was rejected by sandbox policy.",
  ].join("\n");
  const copy = readableThinkingCopy(text);

  assert.equal(copy?.detail, "思考中");
  assert.match(copy?.expandedDetail ?? "", /^Let me analyze the results:/);
  assert.match(copy?.expandedDetail ?? "", /Agent capabilities/);
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

test("tool activity copy labels write_file as write when only summary carries the path", () => {
  const copy = activityLineForNode(node({
    kind: "tool",
    eventType: "tool.requested",
    phase: "executing",
    toolName: "write_file",
    summary: "路径：src/generated.txt",
  }));

  assert.deepEqual(copy, {
    label: "写入",
    detail: "src/generated.txt",
  });
});

test("display activity items keep generic file write summaries visible", () => {
  const items = displayActivityItemsForNodes(activityVisibleNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "filesystem_tool",
      display: {
        kind: "generic_tool_summary",
        action: "写入文件",
        summary: "路径：src/generated.txt",
      },
    }),
  ]));

  assert.equal(items.length, 1);
  assert.equal(items[0]?.copy.label, "写入");
  assert.equal(items[0]?.copy.detail, "src/generated.txt");
  assert.equal(items[0]?.statusBadge?.label, "已完成");
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

test("generic directory activity collapses into one structured entries section", () => {
  const items = displayActivityItemsForNodes([node({
    kind: "tool",
    eventType: "tool.completed",
    phase: "completed",
    toolName: "list_dir",
    display: {
      kind: "generic_tool_summary",
      action: "浏览目录",
      summary: ". · 29 entries · depth 1",
      items: [
        ". · 29 entries · depth 1",
        "-57cdf8cd11eed6fe.jpg depth=1",
        "1758895603614.png depth=1",
        "[truncated]",
      ],
    },
  })]);

  assert.equal(items[0]?.copy.label, "查看");
  assert.equal(items[0]?.copy.detail, "当前目录 · 29 项 · 深度 1");
  assert.equal(items[0]?.copy.expandedDetail, undefined);
  assert.deepEqual(items[0]?.expandedSections?.map((section) => section.title), ["条目"]);
  assert.equal(items[0]?.expandedSections?.[0]?.content, "-57cdf8cd11eed6fe.jpg\n1758895603614.png");
  assert.equal(items[0]?.expandedSections?.some((section) => section.title === "摘要" || section.title === "详情"), false);
});

test("generic article tool results collapse into source and excerpt sections", () => {
  const articleText = [
    "Title: OpenAI unveils GPT-5.6 amid US AI regulatory drama | The Verge",
    "URL: https://www.theverge.com/ai-artificial-intelligence/957845/openai-gpt-5-6-trump-administration-ai-preview",
    "Published: 2026-06-26T17:00:00.000Z",
    "Author: Hayden Field",
    "Highlights:",
    "# OpenAI unveils GPT-5.6 amid US AI regulatory drama",
    "Less than 24 hours after news broke that OpenAI would stagger its next model release, that model, GPT-5.6, is here.",
  ].join("\n");
  const items = displayActivityItemsForNodes([node({
    kind: "tool",
    eventType: "tool.completed",
    phase: "completed",
    toolName: "mcp_article_read",
    display: {
      kind: "generic_tool_summary",
      action: "动作",
      summary: articleText,
      items: [articleText],
    },
  })]);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.copy.label, "网页");
  assert.equal(items[0]?.copy.detail, "OpenAI unveils GPT-5.6 amid US AI regulatory drama | The Verge · www.theverge.com");
  assert.deepEqual(items[0]?.expandedSections?.map((section) => section.title), ["来源", "摘录"]);
  assert.equal(items[0]?.expandedSections?.[0]?.format, "source");
  assert.equal(
    items[0]?.expandedSections?.[0]?.href,
    "https://www.theverge.com/ai-artificial-intelligence/957845/openai-gpt-5-6-trump-administration-ai-preview"
  );
  assert.deepEqual(
    items[0]?.expandedSections?.[0]?.meta?.map((item) => item.value),
    ["www.theverge.com", "2026-06-26 17:00 UTC", "Hayden Field"]
  );
  assert.equal(items[0]?.expandedSections?.[1]?.format, "quote");
  assert.match(items[0]?.expandedSections?.[1]?.content ?? "", /Less than 24 hours/);
  assert.doesNotMatch(items[0]?.expandedSections?.[1]?.content ?? "", /^OpenAI unveils GPT-5\.6/m);
  assert.equal((items[0]?.expandedSections?.[1]?.content.match(/Less than 24 hours/g) ?? []).length, 1);
});

test("directory listing activity uses total counts and structured sections", () => {
  const items = displayActivityItemsForNodes(activityVisibleNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "list_dir",
      display: {
        kind: "directory_listing",
        path: ".",
        depth: 1,
        entriesReturned: 9,
        totalEntries: 29,
        unreadableDirectories: 1,
        unreadableSamples: [{ path: "node_modules/.cache", errorCode: "EPERM" }],
        entries: [
          { path: "README.md", kind: "file", bytes: 120, depth: 1 },
          { path: "src", kind: "directory", depth: 1 },
        ],
      },
    }),
  ]));

  assert.equal(items[0]?.copy.label, "查看");
  assert.equal(items[0]?.copy.detail, "当前目录 · 29 项 · 深度 1");
  assert.deepEqual(items[0]?.badges?.map((badge) => badge.label), ["29 项", "深度 1", "1 个异常目录"]);
  assert.deepEqual(items[0]?.expandedSections?.map((section) => section.title), ["条目", "异常目录"]);
  assert.equal(items[0]?.expandedSections?.some((section) => section.title === "摘要" || section.title === "详情"), false);
  assert.equal(items[0]?.expandedSections?.some((section) => section.title === "目录"), false);
});

test("completed directory activity does not expand into request/result boilerplate when empty", () => {
  const items = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.requested",
      phase: "executing",
      toolName: "list_dir",
      display: {
        kind: "directory_listing",
        path: ".",
        depth: 1,
        entries: [],
        totalEntries: 0,
      },
      refs: [{ kind: "tool_call", id: "tool-list-empty" }],
    }),
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "list_dir",
      display: {
        kind: "directory_listing",
        path: ".",
        depth: 1,
        entries: [],
        totalEntries: 0,
      },
      refs: [{ kind: "tool_call", id: "tool-list-empty" }],
    }),
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.copy.detail, "当前目录 · 0 项 · 深度 1");
  assert.equal(items[0]?.copy.expandedDetail, undefined);
  assert.equal(items[0]?.expandedSections, undefined);
});

test("file search activity keeps query, matches, and skipped details structured", () => {
  const items = displayActivityItemsForNodes(activityVisibleNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "search_context_attachment_files",
      display: {
        kind: "file_search_results",
        query: "needle",
        path: ".",
        searchedFiles: 12,
        skippedFiles: 3,
        skippedBinaryFiles: 1,
        matches: [
          { path: "src/index.ts", line: 4, preview: "needle found here" },
          { path: "README.md", line: 8 },
        ],
        skippedSamples: [{ path: "dist/app.bin", reason: "binary", bytes: 42 }],
      },
    }),
  ]));

  assert.equal(items[0]?.copy.label, "搜索");
  assert.equal(items[0]?.copy.detail, "needle · 当前目录 · 2 处匹配");
  assert.deepEqual(items[0]?.badges?.map((badge) => badge.label), ["2 处匹配", "12 个文件", "3 个跳过"]);
  assert.deepEqual(items[0]?.expandedSections?.map((section) => section.title), ["命中", "跳过"]);
  assert.equal(items[0]?.expandedSections?.some((section) => section.title === "查询"), false);
});

test("file search activity treats match limit as low-noise expanded context", () => {
  const matches = Array.from({ length: 30 }, (_, index) => ({
    path: `src/file-${index}.ts`,
    line: index + 1,
    preview: `needle ${index}`,
  }));
  const item = displayActivityItemsForNodes(activityVisibleNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "grep_files",
      display: {
        kind: "file_search_results",
        query: "needle",
        path: ".",
        matches,
        matchesReturned: 30,
        truncated: true,
      },
    }),
  ]))[0];

  assert.equal(item?.copy.detail, "needle · 当前目录 · 30 处匹配");
  assert.equal(item?.badges?.some((badge) => badge.label === "已截断"), false);
  const hitSection = item?.expandedSections?.find((section) => section.title === "命中");
  assert.equal(hitSection?.content.includes("src/file-29.ts:30 - needle 29"), true);
  assert.equal(hitSection?.content.includes("仅显示前"), true);
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

test("tool activity copy keeps named generic tool calls visible", () => {
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

  assert.deepEqual(requested, { label: "动作", detail: "unknown tool" });
  assert.deepEqual(completed, { label: "动作", detail: "unknown tool" });
});

test("tool activity copy omits empty nameless tool events", () => {
  const copy = activityLineForNode(node({
    kind: "tool",
    eventType: "tool.completed",
    phase: "completed",
  }));

  assert.equal(copy, undefined);
});

test("tool activity copy keeps action-only generic summaries visible", () => {
  const copy = activityLineForNode(node({
    kind: "tool",
    eventType: "tool.completed",
    phase: "completed",
    toolName: "mcp_tool",
    display: {
      kind: "generic_tool_summary",
      action: "浏览目录",
    },
  }));

  assert.deepEqual(copy, {
    label: "查看",
    detail: "浏览目录",
  });
});

test("tool activity copy keeps result-only search tools visible", () => {
  const copy = activityLineForNode(node({
    kind: "tool",
    eventType: "tool.completed",
    phase: "completed",
    toolName: "web_search",
    display: {
      kind: "search_results",
      results: [
        { title: "AgentArbor README", url: "https://example.com/readme" },
      ],
    },
  }));

  assert.deepEqual(copy, {
    label: "搜索",
    detail: "AgentArbor README",
  });
});

test("tool activity copy keeps preview-only read results visible", () => {
  const copy = activityLineForNode(node({
    kind: "tool",
    eventType: "tool.completed",
    phase: "completed",
    toolName: "read_file",
    display: {
      kind: "read_result",
      contentPreview: "export const value = 1;\nexport const next = 2;",
    },
  }));

  assert.deepEqual(copy, {
    label: "读取",
    detail: "export const value = 1;",
  });
});

test("file change activity remains visible when only the preview is available", () => {
  const item = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "edit_file",
      display: {
        kind: "file_diff_preview",
        preview: "@@ line 1\n- old\n+ new",
      },
    }),
  ])[0];

  assert.equal(item?.copy.label, "编辑");
  assert.equal(item?.copy.detail, "内容变更");
  assert.equal(item?.expandedSections?.[0]?.format, "diff");
});

test("file change activity uses event summary as diff when display preview is missing", () => {
  const item = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "edit_file",
      summary: "@@ line 1\n- old\n+ new",
      display: {
        kind: "file_diff_preview",
        path: "src/app.ts",
        replacements: 1,
      },
    }),
  ])[0];

  assert.equal(item?.copy.label, "编辑");
  assert.equal(item?.copy.detail, "src/app.ts");
  assert.equal(item?.expandedSections?.[0]?.format, "diff");
  assert.equal(item?.expandedSections?.[0]?.content.includes("- old"), true);
  assert.equal(item?.expandedSections?.[0]?.content.includes("+ new"), true);
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

test("activity copy labels model failures distinctly from generic problems", () => {
  const copy = activityLineForNode(node({
    kind: "system",
    eventType: "model.failed",
    phase: "failed",
    summary: "工具已执行，但后续模型续跑失败。模型服务连接失败。",
  }));

  assert.deepEqual(copy, {
    label: "模型",
    detail: "工具已执行，但后续模型续跑失败。 模型服务连接失败。",
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
  assert.equal(items[0]?.copy.detail, "思考中");
  assert.equal(items[0]?.copy.expandedDetail, "先判断目标");
  assert.equal(items[0]?.key.includes("thinking"), true);
  assert.equal(items[1]?.tone, "tool");
});

test("activity item projection marks context compaction as a dedicated status row", () => {
  const items = activityItemsForNodes([
    node({
      kind: "system",
      eventType: "context.compaction.requested",
      phase: "executing",
      summary: "正在压缩较早上下文…",
    }),
    node({
      kind: "system",
      eventType: "context.compaction.completed",
      phase: "completed",
      summary: "已整理 18 条较早上下文，后续继续当前任务。",
    }),
  ]);

  assert.deepEqual(items.map((item) => item.variant), ["context_compaction", "context_compaction"]);
  assert.deepEqual(items.map((item) => item.copy.detail), ["正在上下文压缩", "上下文压缩完成"]);
  assert.deepEqual(items.map((item) => item.statusBadge?.label), ["压缩中", "压缩完成"]);
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

test("read result activity keeps the target line minimal", () => {
  const item = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "read_file",
      display: {
        kind: "read_result",
        uri: "Agent.md · 11567 bytes · lines 300-319 of 319",
        truncated: true,
      },
    }),
  ])[0];

  assert.equal(item?.copy.label, "读取");
  assert.equal(item?.copy.detail, "Agent.md");
  assert.equal(item?.statusBadge?.label, "已完成");
  assert.deepEqual(item?.badges?.map((badge) => badge.label), ["已截断"]);
});

test("display activity items omit duplicate run failure after the concrete failure cause", () => {
  const items = displayActivityItemsForNodes([
    node({
      kind: "system",
      eventType: "model.failed",
      phase: "failed",
      summary: "模型服务连接失败。",
    }),
    node({
      kind: "system",
      eventType: "run.failed",
      phase: "failed",
      summary: "模型服务连接失败。",
    }),
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.copy.label, "模型");
  assert.equal(items[0]?.copy.detail, "模型服务连接失败。");
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

test("activity items expose command status badges and structured sections", () => {
  const item = activityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "shell_command",
      display: {
        kind: "command_summary",
        command: "pnpm",
        args: ["test"],
        exitCode: 0,
        durationMs: 1530,
        cwd: "Z:/AgentArbor",
        outputSummary: "全部测试通过",
      },
    }),
  ])[0];

  assert.equal(item?.statusBadge?.label, "已完成");
  assert.equal(item?.badges, undefined);
  assert.deepEqual(item?.expandedSections?.map((section) => section.title), ["输出摘要"]);
});

test("display activity items preserve requested detail and terminal preview for file edits", () => {
  const items = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.requested",
      phase: "executing",
      toolName: "edit_file",
      display: {
        kind: "file_diff_preview",
        path: "src/app.ts",
      },
      refs: [{ kind: "tool_call", id: "tool-edit-1" }],
    }),
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "edit_file",
      display: {
        kind: "file_diff_preview",
        path: "src/app.ts",
        replacements: 1,
        preview: "@@ line 2\n- old\n+ new",
      },
      refs: [{ kind: "tool_call", id: "tool-edit-1" }],
    }),
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.copy.label, "编辑");
  assert.equal(items[0]?.copy.detail, "src/app.ts");
  assert.equal(items[0]?.statusBadge?.label, "已完成");
  assert.deepEqual(items[0]?.expandedSections?.map((section) => section.title), ["差异预览"]);
  assert.equal(items[0]?.expandedSections?.[0]?.format, "diff");
  assert.equal(items[0]?.badges, undefined);
  assert.deepEqual(items[0]?.lineDelta, { added: 1, removed: 1 });
});

test("display activity items keep requested file diff when completion has no preview", () => {
  const items = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.requested",
      phase: "executing",
      toolName: "edit_file",
      display: {
        kind: "file_diff_preview",
        path: "src/app.ts",
        preview: "@@ line 2\n- old\n+ new",
      },
      refs: [{ kind: "tool_call", id: "tool-edit-request-preview" }],
    }),
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "edit_file",
      display: {
        kind: "file_diff_preview",
        path: "src/app.ts",
        replacements: 1,
      },
      refs: [{ kind: "tool_call", id: "tool-edit-request-preview" }],
    }),
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.copy.detail, "src/app.ts");
  assert.deepEqual(items[0]?.expandedSections?.map((section) => section.title), ["差异预览"]);
  assert.equal(items[0]?.expandedSections?.[0]?.format, "diff");
  assert.equal(items[0]?.expandedSections?.[0]?.content.includes("- old"), true);
  assert.equal(items[0]?.expandedSections?.[0]?.content.includes("+ new"), true);
  assert.deepEqual(items[0]?.lineDelta, { added: 1, removed: 1 });
});

test("file creation activity shows new content as a file change diff", () => {
  const item = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "create_file",
      display: {
        kind: "file_change_summary",
        operation: "create",
        path: "src/new-file.ts",
        bytes: 19,
        preview: "+ export const value = 1;",
      },
    }),
  ])[0];

  assert.equal(item?.copy.label, "创建");
  assert.equal(item?.copy.detail, "src/new-file.ts");
  assert.equal(item?.badges, undefined);
  assert.deepEqual(item?.expandedSections?.map((section) => section.title), ["新增内容"]);
  assert.equal(item?.expandedSections?.[0]?.format, "diff");
  assert.deepEqual(item?.lineDelta, { added: 1, removed: 0 });
});

test("file edit activity line delta ignores diff file headers", () => {
  const item = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "edit_file",
      display: {
        kind: "file_diff_preview",
        path: "src/app.ts",
        preview: [
          "--- a/src/app.ts",
          "+++ b/src/app.ts",
          "@@ line 2",
          "- old",
          "- stale",
          "+ new",
          "+ fresh",
          "+ extra",
        ].join("\n"),
      },
    }),
  ])[0];

  assert.deepEqual(item?.lineDelta, { added: 3, removed: 2 });
});

test("file deletion activity remains visible even without a content preview", () => {
  const item = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "delete_file",
      display: {
        kind: "file_change_summary",
        operation: "delete",
        path: "src/obsolete.ts",
        previousLength: 88,
      },
    }),
  ])[0];

  assert.equal(item?.copy.label, "删除");
  assert.equal(item?.copy.detail, "src/obsolete.ts");
  assert.equal(item?.expandedSections, undefined);
});

test("display activity items suppress sub-agent parent tool rows when a sub-agent card is present", () => {
  const items = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "call_sub_agent",
      summary: "已调用子 Agent：research-expert",
      refs: [{ kind: "tool_call", id: "tool-sub-agent-1" }],
    }),
    node({
      kind: "sub_agent",
      eventType: "sub_agent.completed",
      phase: "completed",
      summary: "research-expert 已完成 RAG 选型。",
      refs: [{ kind: "tool_call", id: "tool-sub-agent-1" }],
    }),
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.variant, "sub_agent");
});

test("sub-agent activity copy separates agent name, status, and task", () => {
  const items = displayActivityItemsForNodes([
    node({
      kind: "sub_agent",
      eventType: "sub_agent.started",
      phase: "executing",
      title: "子 Agent",
      summary: "code-expert 开始运行：请检查这段代码的边界问题。",
      subAgentName: "code-expert",
      subAgentTask: "请检查这段代码的边界问题。",
    }),
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.variant, "sub_agent");
  assert.equal(items[0]?.copy.label, "code-expert");
  assert.equal(items[0]?.copy.detail, "请检查这段代码的边界问题。");
});

function node(input: {
  readonly kind: TranscriptNode["kind"];
  readonly eventType?: string;
  readonly phase: TranscriptNode["phase"];
  readonly title?: string;
  readonly summary?: string;
  readonly text?: string;
  readonly toolName?: string;
  readonly subAgentName?: string;
  readonly subAgentTask?: string;
  readonly display?: TranscriptNode["display"];
  readonly confirmation?: TranscriptNode["confirmation"];
  readonly refs?: TranscriptNode["refs"];
  readonly nodeId?: string;
  readonly sequence?: number;
}): TranscriptNode {
  return {
    nodeId: input.nodeId ?? "node-1",
    runId: "run-1",
    sequence: input.sequence ?? 1,
    eventType: input.eventType ?? "agent.note.completed",
    kind: input.kind,
    phase: input.phase,
    title: input.title ?? input.kind,
    summary: input.summary,
    text: input.text,
    timestamp: "2026-06-04T00:00:00.000Z",
    toolName: input.toolName,
    subAgentName: input.subAgentName,
    subAgentTask: input.subAgentTask,
    display: input.display,
    confirmation: input.confirmation,
    refs: input.refs ?? [],
  };
}
