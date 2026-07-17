import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptNode } from "../../../domain/basic-agent/index.js";
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
    "**shell_command**: Failed - python3 was rejected by sandbox policy.",
  ].join("\n");
  const copy = readableThinkingCopy(text);

  assert.equal(copy?.detail, "思考中");
  assert.match(copy?.expandedDetail ?? "", /^Let me analyze the results:/);
  assert.match(copy?.expandedDetail ?? "", /Agent capabilities/);
  assert.match(copy?.expandedDetail ?? "", /python3 was rejected/);
});

test("model request progress uses the same activity layer as tools", () => {
  const items = activityItemsForNodes([
    node({
      kind: "system",
      eventType: "model.requested",
      phase: "executing",
      summary: "分析工具结果",
    }),
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.tone, "thinking");
  assert.equal(items[0]?.toolKind, "thinking");
  assert.equal(items[0]?.copy.detail, "分析工具结果");
});

test("confirmation copy presents concrete confirmation action", () => {
  const copy = activityLineForNode(node({
    kind: "confirmation",
    phase: "waiting_approval",
    summary: "删除文件：Z:\\AgentArbor\\tmp.txt",
    confirmation: {
      confirmationId: "confirmation-1",
      ownerRunId: "run-1",
      toolCallFactId: "tool-fact-1",
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
  assert.equal(items[0]?.statusBadge, undefined);
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
  assert.deepEqual(command, { label: "命令", detail: "终端" });
});

test("tool activity strips internal incomplete wrappers from concrete targets", () => {
  const items = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.failed",
      phase: "failed",
      toolName: "list_dir",
      display: {
        kind: "generic_tool_summary",
        action: "浏览目录",
        summary: "浏览目录未完成: assets.",
      },
    }),
    node({
      kind: "tool",
      eventType: "tool.failed",
      phase: "failed",
      toolName: "read_file",
      display: {
        kind: "generic_tool_summary",
        action: "读取文件",
        summary: "读取文件未完成: app.js.",
      },
      nodeId: "node-2",
      sequence: 2,
    }),
  ]);

  assert.deepEqual(items.map((item) => item.lead?.subject), ["assets", "app.js"]);
  assert.deepEqual(items.map((item) => item.statusBadge), [undefined, undefined]);
});

test("completed generic file deletion does not create a redundant content card", () => {
  const item = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "delete_file",
      display: {
        kind: "generic_tool_summary",
        action: "删除文件",
        summary: "删除文件完成：index.html。",
      },
    }),
  ])[0];

  assert.deepEqual(item?.lead, { action: "删除", subject: "index.html" });
  assert.equal(item?.expandedSections, undefined);
});

test("tool activity copy keeps a running command concise", () => {
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
    detail: "终端",
  });
});

test("tool activity leads preserve complete paths instead of inserting ellipses", () => {
  const path = `src/${"nested-directory/".repeat(16)}implementation.ts`;
  const item = displayActivityItemsForNodes([node({
    kind: "tool",
    eventType: "tool.completed",
    phase: "completed",
    toolName: "read_file",
    display: {
      kind: "read_result",
      title: path,
      contentPreview: "export const value = true;",
    },
  })])[0];

  assert.equal(item?.lead?.subject, path);
  assert.equal(item?.lead?.subject.includes("…"), false);
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

test("batch research reads use a plain source count and list each source once", () => {
  const item = displayActivityItemsForNodes([node({
    kind: "tool",
    eventType: "tool.completed",
    phase: "completed",
    toolName: "read",
    display: {
      kind: "generic_tool_summary",
      action: "资料读取",
      summary: "2 个来源",
      items: ["First source", "Second source"],
    },
  })])[0];

  assert.deepEqual(item?.lead, { action: "读取", subject: "2 个来源" });
  assert.deepEqual(item?.expandedSections?.map((section) => section.title), ["条目"]);
  assert.equal(item?.expandedSections?.[0]?.content, "First source\nSecond source");
  assert.equal(item?.expandedSections?.some((section) => section.content.includes("2 个来源")), false);
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
  assert.equal(items[0]?.copy.detail, "当前目录");
  assert.deepEqual(items[0]?.lead, {
    action: "查看",
    subject: "当前目录",
    monospace: true,
  });
  assert.equal(items[0]?.copy.expandedDetail, undefined);
  assert.deepEqual(items[0]?.expandedSections?.map((section) => section.title), ["条目"]);
  assert.equal(items[0]?.expandedSections?.[0]?.format, "path_list");
  assert.deepEqual(items[0]?.expandedSections?.[0]?.items, [
    { title: "-57cdf8cd11eed6fe.jpg", monospace: true },
    { title: "1758895603614.png", monospace: true },
  ]);
  assert.equal(items[0]?.expandedSections?.[0]?.content, "-57cdf8cd11eed6fe.jpg\n1758895603614.png");
  assert.equal(items[0]?.expandedSections?.some((section) => section.title === "摘要" || section.title === "详情"), false);
});

test("generic article tool results keep only the source and omit partial excerpts", () => {
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
  assert.equal(items[0]?.copy.detail, "OpenAI unveils GPT-5.6 amid US AI regulatory drama | The Verge");
  assert.deepEqual(items[0]?.expandedSections?.map((section) => section.title), ["来源"]);
  assert.equal(items[0]?.expandedSections?.[0]?.format, "source");
  assert.equal(
    items[0]?.expandedSections?.[0]?.href,
    "https://www.theverge.com/ai-artificial-intelligence/957845/openai-gpt-5-6-trump-administration-ai-preview"
  );
  assert.equal(items[0]?.expandedSections?.[0]?.meta, undefined);
  assert.equal(JSON.stringify(items[0]?.expandedSections).includes("Less than 24 hours"), false);
});

test("remote reads and browser snapshots expose links without partial page previews", () => {
  const [readItem, browserItem] = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "read",
      display: {
        kind: "read_result",
        title: "AgentArbor guide",
        url: "https://example.com/guide",
        contentPreview: "This is only the beginning of a much longer article...",
      },
    }),
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "browser_snapshot",
      display: {
        kind: "browser_snapshot",
        title: "AgentArbor guide",
        url: "https://example.com/guide",
      },
    }),
  ]);

  assert.deepEqual(readItem?.expandedSections?.map((section) => section.title), ["来源"]);
  assert.deepEqual(browserItem?.expandedSections?.map((section) => section.title), ["来源"]);
  assert.equal(JSON.stringify([readItem, browserItem]).includes("incomplete"), false);
  assert.equal(JSON.stringify([readItem, browserItem]).includes("only the beginning"), false);
});

test("generic lookup tools show the query as the record and keep output in detail", () => {
  const item = displayActivityItemsForNodes([node({
    kind: "tool",
    eventType: "tool.completed",
    phase: "completed",
    toolName: "vendor__lookup",
    display: {
      kind: "generic_tool_summary",
      action: "MCP 工具",
      summary: "AgentArbor tool display",
      items: ["Official AgentArbor documentation"],
    },
  })])[0];

  assert.deepEqual(item?.lead, {
    action: "搜索",
    subject: "AgentArbor tool display",
  });
  assert.deepEqual(item?.expandedSections?.map((section) => section.title), ["条目"]);
  assert.equal(item?.expandedSections?.[0]?.content, "Official AgentArbor documentation");
});

test("directory listing activity keeps only scannable paths and real warnings", () => {
  const items = displayActivityItemsForNodes(activityVisibleNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "list_dir",
      display: {
        kind: "directory_listing",
        path: ".",
        unreadableDirectories: 1,
        unreadableSamples: [{ path: "node_modules/.cache", errorCode: "EPERM" }],
        entries: [
          { path: "README.md", kind: "file" },
          { path: "src", kind: "directory" },
        ],
      },
    }),
  ]));

  assert.equal(items[0]?.copy.label, "查看");
  assert.equal(items[0]?.copy.detail, "当前目录");
  assert.deepEqual(items[0]?.lead, {
    action: "查看",
    subject: "当前目录",
    monospace: true,
  });
  assert.deepEqual(items[0]?.badges?.map((badge) => badge.label), ["部分目录不可读"]);
  assert.deepEqual(items[0]?.expandedSections?.map((section) => section.title), ["条目", "异常目录"]);
  assert.equal(items[0]?.expandedSections?.[0]?.format, "path_list");
  assert.deepEqual(items[0]?.expandedSections?.[0]?.items, [
    { title: "README.md", monospace: true },
    { title: "src/", monospace: true },
  ]);
  assert.equal(items[0]?.expandedSections?.[0]?.content, "README.md\nsrc/");
  assert.equal(items[0]?.expandedSections?.some((section) => section.title === "摘要" || section.title === "详情"), false);
  assert.equal(items[0]?.expandedSections?.some((section) => section.title === "目录"), false);
});

test("completed empty directory activity stays minimal", () => {
  const items = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.requested",
      phase: "executing",
      toolName: "list_dir",
      display: {
        kind: "directory_listing",
        path: ".",
        entries: [],
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
        entries: [],
      },
      refs: [{ kind: "tool_call", id: "tool-list-empty" }],
    }),
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.copy.detail, "当前目录");
  assert.deepEqual(items[0]?.lead, {
    action: "查看",
    subject: "当前目录",
    monospace: true,
  });
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
        matches: [
          { path: "src/index.ts", line: 4, preview: "needle found here" },
          { path: "README.md", line: 8 },
        ],
      },
    }),
  ]));

  assert.equal(items[0]?.copy.label, "搜索");
  assert.equal(items[0]?.copy.detail, "needle");
  assert.deepEqual(items[0]?.lead, {
    action: "搜索",
    subject: "needle",
    monospace: true,
  });
  assert.equal(items[0]?.badges, undefined);
  assert.deepEqual(items[0]?.expandedSections?.map((section) => section.title), ["匹配位置"]);
  assert.equal(items[0]?.expandedSections?.[0]?.format, "path_list");
  assert.deepEqual(items[0]?.expandedSections?.[0]?.items, [
    { title: "src/index.ts:4", detail: "needle found here", monospace: true },
    { title: "README.md:8", detail: undefined, monospace: true },
  ]);
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
      },
    }),
  ]))[0];

  assert.equal(item?.copy.detail, "needle");
  assert.equal(item?.badges?.some((badge) => badge.label === "已截断") ?? false, false);
  const hitSection = item?.expandedSections?.find((section) => section.title === "匹配位置");
  assert.equal(hitSection?.content.includes("src/file-29.ts:30 - needle 29"), true);
  assert.equal(hitSection?.content.includes("仅显示前"), false);
});

test("command copy keeps failure detail out of the primary headline", () => {
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
      stderrPreview: "测试失败：1 个断言未通过",
    },
  }));

  assert.deepEqual(copy, {
    label: "命令",
    detail: "终端",
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

test("HTTP activity uses a concrete request verb", () => {
  const copy = activityLineForNode(node({
    kind: "tool",
    eventType: "tool.completed",
    phase: "completed",
    toolName: "http_request",
    display: {
      kind: "http_response",
      method: "GET",
      url: "http://127.0.0.1:4173/",
      statusCode: 200,
      statusText: "OK",
    },
  }));

  assert.deepEqual(copy, {
    label: "请求",
    detail: "GET http://127.0.0.1:4173/",
  });
});

test("search activity keeps sources structured for the evidence view", () => {
  const item = displayActivityItemsForNodes(activityVisibleNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "web_search",
      display: {
        kind: "search_results",
        query: "AgentArbor",
        results: [{
          title: "AgentArbor README",
          url: "https://example.com/readme",
          source: "example.com",
        }],
      },
    }),
  ]))[0];

  assert.deepEqual(item?.lead, {
    action: "搜索",
    subject: "AgentArbor",
  });
  assert.equal(item?.expandedSections?.[0]?.format, "source_list");
  assert.deepEqual(item?.expandedSections?.[0]?.items, [{
    title: "AgentArbor README",
    href: "https://example.com/readme",
    meta: [{ value: "example.com" }],
  }]);
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

test("tool activity derives the default line from display instead of presentation", () => {
  const item = activityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "shell_command",
      display: {
        kind: "command_summary",
        commandLine: "pnpm test",
        exitCode: 0,
      },
    }),
  ])[0];

  assert.equal(item?.copy.label, "命令");
  assert.equal(item?.copy.detail, "终端");
  assert.equal(item?.toolKind, "command");
  assert.equal(item?.statusBadge, undefined);
  assert.deepEqual(item?.lead, {
    action: "运行",
    subject: "终端",
  });
  assert.deepEqual(item?.expandedSections, [{ title: "命令", content: "$ pnpm test", format: "console" }]);
});

test("tool activity derives display kind from display instead of presentation", () => {
  const item = activityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "custom_runner",
      display: {
        kind: "file_diff_preview",
        path: "src/app.ts",
      },
    }),
  ])[0];

  assert.equal(item?.copy.label, "编辑");
  assert.equal(item?.copy.detail, "src/app.ts");
  assert.equal(item?.toolKind, "edit");
  assert.deepEqual(item?.lead, {
    action: "编辑",
    subject: "src/app.ts",
    monospace: true,
  });
});

test("failed command lead keeps raw stderr in detail instead of repeating it in the record", () => {
  const item = activityItemsForNodes([node({
    kind: "tool",
    eventType: "tool.failed",
    phase: "failed",
    toolName: "shell_command",
    display: {
      kind: "command_summary",
      command: "pnpm",
      args: ["test"],
      exitCode: 1,
      stderrPreview: "1 个断言未通过",
    },
  })])[0];

  assert.deepEqual(item?.lead, {
    action: "运行",
    subject: "终端",
    context: "运行失败",
  });
  assert.equal(item?.expandedSections?.find((section) => section.title === "输出")?.content, "1 个断言未通过");
  assert.equal(item?.badges, undefined);
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
      },
    }),
  ])[0];

  assert.equal(item?.copy.label, "读取");
  assert.equal(item?.copy.detail, "Agent.md");
  assert.deepEqual(item?.lead, {
    action: "读取",
    subject: "Agent.md",
    monospace: true,
  });
  assert.equal(item?.statusBadge, undefined);
  assert.equal(item?.badges?.some((badge) => badge.label.includes("截断")) ?? false, false);
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
        ownerRunId: "run-1",
        toolCallFactId: "tool-fact-1",
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
        stdoutPreview: "全部测试通过",
      },
    }),
  ])[0];

  assert.equal(item?.statusBadge, undefined);
  assert.equal(item?.badges, undefined);
  assert.deepEqual(item?.lead, {
    action: "运行",
    subject: "终端",
  });
  assert.deepEqual(item?.expandedSections?.map((section) => section.title), ["命令", "输出"]);
  assert.equal(item?.expandedSections?.[0]?.content, "$ pnpm test");
});

test("command detail prefers full bounded stdout and stderr previews", () => {
  const stdout = Array.from({ length: 10 }, (_, index) => `stdout ${index + 1}`).join("\n");
  const stderr = "warning one\nwarning two";
  const item = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "shell_command",
      display: {
        kind: "command_summary",
        commandLine: "pnpm test",
        exitCode: 1,
        stdoutPreview: stdout,
        stderrPreview: stderr,
      },
    }),
  ])[0];

  assert.deepEqual(item?.expandedSections?.map((section) => section.title), ["命令", "输出"]);
  assert.equal(item?.expandedSections?.[1]?.content, `${stdout}\n${stderr}`);
  assert.equal(item?.expandedSections?.some((section) => section.title === "标准输出" || section.title === "标准错误"), false);
});

test("long command summaries stay short while detail preserves the exact command", () => {
  const command = "python - <<'PY' from pathlib import Path; html = Path('index.html').read_text(encoding='utf-8'); print(len(html))";
  const item = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "shell_command",
      display: {
        kind: "command_summary",
        commandLine: command,
        exitCode: 0,
      },
    }),
  ])[0];

  assert.equal(item?.lead?.subject, "终端");
  assert.equal(item?.expandedSections?.[0]?.title, "命令");
  assert.equal(item?.expandedSections?.[0]?.content, `$ ${command}`);

  const server = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "shell_command",
      display: {
        kind: "command_summary",
        commandLine: "python -m http.server 4173 --bind 0.0.0.0",
        exitCode: 0,
      },
    }),
  ])[0];
  assert.equal(server?.lead?.subject, "终端");
});

test("one multi-file tool call becomes one activity with per-file diffs", () => {
  const item = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "workspace_patch",
      display: {
        kind: "file_change_group",
        files: [
          { path: "src/app.ts", operation: "edit", preview: "@@ -1 +1 @@\n-old\n+new" },
          { path: "src/app.test.ts", operation: "create", preview: "+test('app', () => true)" },
        ],
      },
    }),
  ])[0];

  assert.equal(item?.toolKind, "edit");
  assert.deepEqual(item?.lead, { action: "编辑", subject: "2 个文件" });
  assert.deepEqual(item?.lineDelta, { added: 2, removed: 1 });
  assert.deepEqual(item?.expandedSections?.map((section) => section.title), ["src/app.ts", "src/app.test.ts"]);
  assert.equal(item?.expandedSections?.every((section) => section.format === "diff"), true);
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
        preview: "@@ line 2\n- old\n+ new",
      },
      refs: [{ kind: "tool_call", id: "tool-edit-1" }],
    }),
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.copy.label, "编辑");
  assert.equal(items[0]?.copy.detail, "src/app.ts");
  assert.equal(items[0]?.statusBadge, undefined);
  assert.deepEqual(items[0]?.expandedSections?.map((section) => section.title), ["差异预览"]);
  assert.equal(items[0]?.expandedSections?.[0]?.format, "diff");
  assert.equal(items[0]?.badges, undefined);
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
        preview: "+ export const value = 1;",
      },
    }),
  ])[0];

  assert.equal(item?.copy.label, "创建");
  assert.equal(item?.copy.detail, "src/new-file.ts");
  assert.equal(item?.badges, undefined);
  assert.deepEqual(item?.expandedSections?.map((section) => section.title), ["新增内容"]);
  assert.equal(item?.expandedSections?.[0]?.format, "diff");
});

test("file edit activity keeps full diff headers in detail", () => {
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

  assert.equal(item?.expandedSections?.[0]?.content.includes("--- a/src/app.ts"), true);
  assert.deepEqual(item?.lineDelta, { added: 3, removed: 2 });
});

test("file edit line delta counts code that begins with diff header characters", () => {
  const item = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "edit_file",
      display: {
        kind: "file_diff_preview",
        path: "src/counter.ts",
        preview: [
          "--- a/src/counter.ts",
          "+++ b/src/counter.ts",
          "@@ -1,2 +1,2 @@",
          "---counter;",
          "+++counter;",
        ].join("\r\n"),
      },
    }),
  ])[0];

  assert.deepEqual(item?.lineDelta, { added: 1, removed: 1 });
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
      },
    }),
  ])[0];

  assert.equal(item?.copy.label, "删除");
  assert.equal(item?.copy.detail, "src/obsolete.ts");
  assert.equal(item?.expandedSections, undefined);
});

test("sub-agent AgentTool facts remain visible as standard tool activity", () => {
  const items = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      toolName: "call_sub_agent",
      summary: "已调用子 Agent：research-expert",
      refs: [{ kind: "tool_call", id: "tool-sub-agent-1" }],
    }),
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.tone, "tool");
  assert.equal(items[0]?.variant, undefined);
});

test("sub-agent activity shows the specialist and delegated task instead of generic tool copy", () => {
  const item = displayActivityItemsForNodes([node({
    kind: "tool",
    eventType: "tool.requested",
    phase: "executing",
    toolName: "call_sub_agent",
    display: {
      kind: "agent_task",
      agentName: "review-expert",
      task: "检查工具展示的信息层级",
    },
  })])[0];

  assert.deepEqual(item?.copy, { label: "委派", detail: "review-expert" });
  assert.deepEqual(item?.lead, {
    action: "委派",
    subject: "review-expert",
    context: "检查工具展示的信息层级",
  });
  assert.equal(item?.toolKind, "agent");
});

test("directory activity uses its own tool kind and concrete path", () => {
  const item = displayActivityItemsForNodes([node({
    kind: "tool",
    eventType: "tool.requested",
    phase: "executing",
    toolName: "list_dir",
    display: {
      kind: "directory_listing",
      path: "src/components",
      entries: [],
    },
  })])[0];

  assert.deepEqual(item?.lead, { action: "查看", subject: "src/components", monospace: true });
  assert.equal(item?.toolKind, "directory");
});

test("live file and directory activity state names the action and concrete target", () => {
  const [file, directory] = displayActivityItemsForNodes([
    node({
      kind: "tool",
      eventType: "tool.requested",
      phase: "executing",
      toolName: "read_file",
      display: {
        kind: "read_result",
        title: "src/app/panel-ui/src/components/transcript-timeline.tsx",
      },
    }),
    node({
      kind: "tool",
      eventType: "tool.requested",
      phase: "executing",
      toolName: "list_dir",
      display: {
        kind: "directory_listing",
        path: "src/app/panel-ui/src/components",
        entries: [],
      },
      nodeId: "node-2",
      sequence: 2,
    }),
  ]);

  assert.deepEqual(file?.lead, {
    action: "读取",
    subject: "src/app/panel-ui/src/components/transcript-timeline.tsx",
    monospace: true,
  });
  assert.deepEqual(directory?.lead, {
    action: "查看",
    subject: "src/app/panel-ui/src/components",
    monospace: true,
  });
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
    display: input.display,
    confirmation: input.confirmation,
    refs: input.refs ?? [],
  };
}
