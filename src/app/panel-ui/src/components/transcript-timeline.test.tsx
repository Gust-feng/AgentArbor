import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { ActivityItem } from "../../../panel-read-model/transcript/panel-transcript-activity-copy";
import { projectAgentWorkTimelineView } from "../../../panel-read-model/assistant/panel-agent-work-timeline-view";
import { projectStableAssistantWorkflowDisplay } from "../../../panel-read-model/assistant/panel-assistant-workflow-display";
import type { TranscriptNode } from "../contracts/run";
import { AgentWorkTimeline, type ConfirmationProjection } from "./transcript-timeline";

test("command activity keeps the summary concise and leaves evidence in disclosure", () => {
  const item: ActivityItem = {
    nodeId: "node-1",
    key: "tool-1",
    eventType: "tool.completed",
    copy: { label: "命令", detail: "命令已执行" },
    tone: "tool",
    phase: "completed",
    toolKind: "command",
    lead: { action: "命令", subject: "pnpm test", monospace: true },
    expandedSections: [{ title: "输出", content: "0 problems", format: "console" }],
  };

  render(
    <AgentWorkTimeline
      view={{
        nodes: [],
        items: [item],
        confirmation: {},
        hasContent: true,
      }}
      lifecycle="settled"
      confirmationBusy={false}
    />,
  );

  const summary = document.querySelector("summary.agent-record-summary");
  expect(summary?.textContent).toBe("终端");
  expect(summary?.textContent).not.toContain("pnpm test");
  expect(screen.queryByText("命令已执行")).toBeNull();
  const output = screen.getByText("0 problems");
  const disclosure = output.closest("details");
  expect(disclosure?.open).toBe(false);

  fireEvent.click(summary!);
  expect(disclosure?.open).toBe(true);
});

test("delegation keeps nested sub-agent calls visible without expanding tool results", () => {
  const child: ActivityItem = {
    nodeId: "nested-read",
    key: "nested-read",
    eventType: "tool.requested",
    copy: { label: "读取", detail: "src/config.ts" },
    tone: "tool",
    phase: "executing",
    toolKind: "read",
    lead: { action: "读取", subject: "src/config.ts", monospace: true },
  };
  const parent: ActivityItem = {
    nodeId: "delegate",
    key: "delegate",
    eventType: "tool.requested",
    copy: { label: "委派", detail: "review-expert" },
    tone: "tool",
    phase: "executing",
    toolKind: "agent",
    lead: { action: "委派", subject: "review-expert", context: "检查配置文件" },
    expandedSections: [{ title: "结果", content: "子 Agent 已完成检查。" }],
    children: [child],
  };

  render(
    <AgentWorkTimeline
      view={{ nodes: [], items: [parent], confirmation: {}, hasContent: true }}
      lifecycle="open"
      confirmationBusy={false}
    />,
  );

  const nested = screen.getByLabelText("子 Agent 操作");
  expect(nested.textContent).toContain("src/config.ts");
  expect(nested.closest("details.agent-record")).toBeNull();
  const resultDisclosure = screen.getByText("子 Agent 已完成检查。").closest("details");
  expect(resultDisclosure?.open).toBe(false);
});

test("a long running command gains a quiet timer and removes it immediately after settlement", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-17T00:00:00.000Z"));
  const running: ActivityItem = {
    nodeId: "node-live-command",
    key: "tool-live-command",
    eventType: "tool.requested",
    copy: { label: "命令", detail: "运行命令" },
    tone: "tool",
    phase: "executing",
    toolKind: "command",
    startedAt: "2026-07-17T00:00:00.000Z",
  };
  const rendered = render(
    <AgentWorkTimeline
      view={{ nodes: [], items: [running], confirmation: {}, hasContent: true }}
      presentation="agent_work"
      lifecycle="open"
      confirmationBusy={false}
    />,
  );

  expect(screen.queryByLabelText("已运行 2 秒")).toBeNull();
  act(() => vi.advanceTimersByTime(2_000));
  expect(screen.getByLabelText("已运行 2 秒").textContent).toBe("2s");
  expect(document.querySelector('.agent-record[data-current="true"]')).toBeTruthy();

  rendered.rerender(
    <AgentWorkTimeline
      view={{ nodes: [], items: [{ ...running, phase: "completed" }], confirmation: {}, hasContent: true }}
      presentation="agent_work"
      lifecycle="open"
      confirmationBusy={false}
    />,
  );
  expect(screen.queryByLabelText(/已运行/u)).toBeNull();
  expect(document.querySelector('.agent-record[data-current="true"]')).toBeNull();
  vi.useRealTimers();
});

test("collapsed activity uses one readable summary instead of metric icons", () => {
  const items: ActivityItem[] = ["tool-1", "tool-2"].map((key, index) => ({
    nodeId: `node-${index + 1}`,
    key,
    eventType: "tool.completed",
    copy: { label: "命令", detail: "命令已执行" },
    tone: "tool",
    phase: "completed",
    toolKind: "command",
  }));

  render(
    <AgentWorkTimeline
      view={{
        nodes: [],
        items,
        confirmation: {},
        hasContent: true,
      }}
      collapsed
      lifecycle="settled"
      confirmationBusy={false}
    />,
  );

  const summaryText = screen.getByText("过程");
  const summary = summaryText.closest("summary");
  expect(summary?.firstElementChild?.classList.contains("agent-workline-summary-chevron")).toBe(true);
  expect(summary?.querySelector(".agent-workline-summary-metrics")).toBeNull();
});

test("expandable tool rows read as one direct action with a quiet disclosure affordance", () => {
  const item: ActivityItem = {
    nodeId: "node-read",
    key: "tool-read",
    eventType: "tool.completed",
    copy: { label: "查看", detail: "当前目录" },
    tone: "tool",
    phase: "completed",
    toolKind: "read",
    lead: { action: "查看", subject: "当前目录", context: "1 项", monospace: true },
    expandedSections: [{ title: "条目", content: "README.md", format: "path_list" }],
  };

  render(
    <AgentWorkTimeline
      view={{
        nodes: [],
        items: [item],
        confirmation: {},
        hasContent: true,
      }}
      lifecycle="settled"
      confirmationBusy={false}
    />,
  );

  const line = screen.getByText("当前目录").closest("summary");
  const children = Array.from(line?.children ?? []);
  expect(children[0]?.classList.contains("agent-record-icon")).toBe(true);
  expect(children[1]?.classList.contains("agent-record-content")).toBe(true);
  expect(children[2]?.classList.contains("agent-record-trailing")).toBe(true);
  expect(line?.querySelector(".agent-activity-record-dot")).toBeNull();
  expect(screen.queryByText("查看")).toBeNull();
  expect(screen.getByLabelText("查看 当前目录")).toBeTruthy();
  expect(screen.getByText("1 项")).toBeTruthy();
  expect(line?.querySelector(".agent-record-chevron")).toBeTruthy();
});

test("search activity shows the query once without category or result labels", () => {
  const item: ActivityItem = {
    nodeId: "node-search",
    key: "tool-search",
    eventType: "tool.completed",
    copy: { label: "搜索", detail: "AgentArbor" },
    tone: "tool",
    phase: "completed",
    toolKind: "search",
    lead: { action: "搜索", subject: "AgentArbor" },
    expandedSections: [{
      title: "来源",
      content: "AgentArbor documentation",
      format: "source_list",
      items: [{ title: "AgentArbor documentation", href: "https://example.com/docs" }],
    }],
  };

  render(
    <AgentWorkTimeline
      view={{ nodes: [], items: [item], confirmation: {}, hasContent: true }}
      lifecycle="settled"
      confirmationBusy={false}
    />,
  );

  const summary = screen.getByText("AgentArbor").closest("summary");
  expect(summary?.textContent).toBe("AgentArbor");
  expect(screen.queryByText("搜索")).toBeNull();
  expect(screen.queryByText("搜索结果")).toBeNull();
  expect(screen.queryByText("命中结果")).toBeNull();
  fireEvent.click(summary!);
  expect(screen.getByText("AgentArbor documentation")).toBeTruthy();
});

test("one multi-file edit stays one record and exposes each file inside it", () => {
  const item: ActivityItem = {
    nodeId: "node-multi-edit",
    key: "tool-multi-edit",
    eventType: "tool.completed",
    copy: { label: "编辑", detail: "2 个文件" },
    tone: "tool",
    phase: "completed",
    toolKind: "edit",
    lead: { action: "编辑", subject: "2 个文件" },
    lineDelta: { added: 2, removed: 1 },
    expandedSections: [
      { title: "src/app.ts", content: "@@ -1 +1 @@\n-old\n+new", format: "diff" },
      { title: "src/app.test.ts", content: "+test('app', () => true)", format: "diff" },
    ],
  };

  render(
    <AgentWorkTimeline
      view={{ nodes: [], items: [item], confirmation: {}, hasContent: true }}
      lifecycle="settled"
      confirmationBusy={false}
    />,
  );

  expect(screen.queryByText("编辑")).toBeNull();
  expect(screen.getByLabelText("编辑 2 个文件")).toBeTruthy();
  expect(screen.getByText("2 个文件")).toBeTruthy();
  expect(screen.getByLabelText("新增 2 行，删除 1 行")).toBeTruthy();
  expect(screen.getByText("+2")).toBeTruthy();
  expect(screen.getByText("-1")).toBeTruthy();
  expect(document.querySelectorAll(".agent-record.tool")).toHaveLength(1);
  expect(document.querySelector(".agent-activity-line-delta")).toBeNull();
  fireEvent.click(screen.getByText("2 个文件").closest("summary")!);
  expect(screen.getByText("src/app.ts")).toBeTruthy();
  expect(screen.getByText("src/app.test.ts")).toBeTruthy();
});

test("single-file edit keeps the path in one place", () => {
  const item: ActivityItem = {
    nodeId: "node-single-edit",
    key: "tool-single-edit",
    eventType: "tool.completed",
    copy: { label: "编辑", detail: "src/app.ts" },
    tone: "tool",
    phase: "completed",
    toolKind: "edit",
    lead: { action: "编辑", subject: "src/app.ts", monospace: true },
    expandedSections: [
      { title: "src/app.ts", content: "@@ -1 +1 @@\n-old\n+new", format: "diff" },
    ],
  };

  render(
    <AgentWorkTimeline
      view={{ nodes: [], items: [item], confirmation: {}, hasContent: true }}
      lifecycle="settled"
      confirmationBusy={false}
    />,
  );

  const summary = screen.getByText("src/app.ts").closest("summary");
  expect(screen.getAllByText("src/app.ts")).toHaveLength(1);
  fireEvent.click(summary!);
  expect(screen.getAllByText("src/app.ts")).toHaveLength(1);
  expect(screen.getByLabelText("src/app.ts")).toBeTruthy();
});

test("long commands stay out of the summary and remain complete in detail", () => {
  const command = "python - <<'PY' from pathlib import Path; html = Path('index.html').read_text(encoding='utf-8')";
  const item: ActivityItem = {
    nodeId: "node-long-command",
    key: "tool-long-command",
    eventType: "tool.completed",
    copy: { label: "命令", detail: command },
    tone: "tool",
    phase: "completed",
    toolKind: "command",
    lead: { action: "命令", subject: command, monospace: true },
    expandedSections: [{ title: "命令", content: `$ ${command}`, format: "console" }],
  };

  render(
    <AgentWorkTimeline
      view={{ nodes: [], items: [item], confirmation: {}, hasContent: true }}
      lifecycle="settled"
      confirmationBusy={false}
    />,
  );

  const summary = document.querySelector("summary.agent-record-summary");
  expect(summary?.textContent).toBe("终端");
  expect(summary?.textContent).not.toContain(command);
  fireEvent.click(summary!);
  expect(screen.getByText(command)).toBeTruthy();
});

test("active ordinary timeline uses tool progress without retaining prefatory dots", () => {
  const item: ActivityItem = {
    nodeId: "node-active-command",
    key: "tool-active-command",
    eventType: "tool.requested",
    copy: { label: "命令", detail: "pnpm test" },
    tone: "tool",
    phase: "executing",
    toolKind: "command",
    lead: { action: "命令", subject: "pnpm test", monospace: true },
    expandedSections: [{ title: "输出", content: "test output", format: "console" }],
  };

  const view = {
    nodes: [],
    items: [item],
    confirmation: {},
    hasContent: true,
  } as const;
  const rendered = render(
    <AgentWorkTimeline
      view={view}
      presentation="agent_work"
      lifecycle="open"
      collapsed={false}
      confirmationBusy={false}
    />,
  );

  expect(screen.queryByRole("status", { name: "正在运行命令" })).toBeNull();
  expect(document.querySelectorAll(".typing-dots > span")).toHaveLength(0);
  expect(document.querySelector(".agent-workline")?.getAttribute("data-surface")).toBe("tools");
  expect(screen.queryByText("正在运行命令")).toBeNull();
  expect(screen.queryByText("AI 正在工作")).toBeNull();
  expect(screen.queryByText("正在分析并规划下一步")).toBeNull();
  const recordSummary = screen.getByText("过程").closest("summary");
  const recordDisclosure = recordSummary?.closest("details");
  expect(screen.queryByText("pnpm test")).toBeNull();
  expect(recordDisclosure?.open).toBe(true);
  expect(recordDisclosure?.textContent).toContain("终端");
  const toolResultDisclosure = screen.getByText("test output").closest("details");
  expect(toolResultDisclosure?.open).toBe(false);

  fireEvent.click(screen.getByText("终端").closest("summary")!);
  expect(toolResultDisclosure?.open).toBe(true);

  rendered.rerender(
    <AgentWorkTimeline
      view={view}
      presentation="agent_work"
      lifecycle="settled"
      collapsed
      confirmationBusy={false}
    />,
  );
  expect(recordDisclosure?.open).toBe(false);

  fireEvent.click(recordSummary!);
  expect(recordDisclosure?.open).toBe(true);
});

test("visible model activity does not recreate the prefatory dots", () => {
  const item: ActivityItem = {
    nodeId: "node-thinking",
    key: "thinking-1",
    eventType: "model.reasoning.delta",
    copy: { detail: "思考中", expandedDetail: "正在分析当前问题。" },
    tone: "thinking",
    phase: "executing",
    toolKind: "thinking",
  };

  render(
    <AgentWorkTimeline
      view={{ nodes: [], items: [item], confirmation: {}, hasContent: true }}
      presentation="agent_work"
      lifecycle="open"
      confirmationBusy={false}
    />,
  );

  expect(screen.queryByRole("status", { name: "正在处理" })).toBeNull();
  expect(document.querySelectorAll(".typing-dots > span")).toHaveLength(0);
  expect(screen.queryByText("正在处理")).toBeNull();
  expect(screen.queryByText("AI 正在工作")).toBeNull();
  expect(screen.queryByText("正在分析并规划下一步")).toBeNull();
  const reasoning = screen.getByText("思考中").closest("details");
  expect(reasoning?.open).toBe(true);
  expect(reasoning?.contains(screen.getByText("正在分析当前问题。"))).toBe(true);
  expect(reasoning?.querySelectorAll("details")).toHaveLength(0);
});

test("ordinary process keeps real command calls without a synthetic group", () => {
  const items: ActivityItem[] = ["pnpm typecheck", "pnpm test"].map((subject, index) => ({
    nodeId: `node-command-${index}`,
    key: `tool-command-${index}`,
    eventType: "tool.completed",
    copy: { label: "命令", detail: subject },
    tone: "tool",
    phase: "completed",
    toolKind: "command",
    lead: { action: "命令", subject, monospace: true },
    expandedSections: [{ title: "命令", content: `$ ${subject}`, format: "console" }],
  }));

  render(
    <AgentWorkTimeline
      view={{ nodes: [], items, confirmation: {}, hasContent: true }}
      presentation="agent_work"
      collapsed
      lifecycle="settled"
      confirmationBusy={false}
    />,
  );

  const processDisclosure = screen.getByText("过程").closest("details");
  expect(processDisclosure?.open).toBe(false);
  fireEvent.click(screen.getByText("过程").closest("summary")!);

  const records = document.querySelectorAll<HTMLDetailsElement>('details.agent-record[data-tool-kind="command"]');
  expect(records).toHaveLength(2);
  expect(records[0]?.open).toBe(false);
  expect(records[1]?.open).toBe(false);
  expect(Array.from(records).map((record) => record.querySelector("summary")?.textContent)).toEqual(["终端", "终端"]);
  expect(screen.queryByText("执行命令")).toBeNull();
  expect(screen.queryByText(/运行了 \d+ 个命令/)).toBeNull();
  fireEvent.click(records[0]!.querySelector("summary")!);
  expect(records[0]?.open).toBe(true);
  expect(records[1]?.open).toBe(false);
  expect(screen.getByText("pnpm typecheck")).toBeTruthy();
});

test("records presentation keeps active Multi-Agent activity directly selectable", () => {
  const item: ActivityItem = {
    nodeId: "node-deep-command",
    key: "tool-deep-command",
    eventType: "tool.requested",
    copy: { label: "命令", detail: "pnpm test" },
    tone: "tool",
    phase: "executing",
    toolKind: "command",
    lead: { action: "命令", subject: "pnpm test", monospace: true },
  };

  render(
    <AgentWorkTimeline
      view={{ nodes: [], items: [item], confirmation: {}, hasContent: true }}
      presentation="records"
      lifecycle="open"
      selectedItemKey={item.key}
      selectableItemKeys={[item.key]}
      onSelectItem={() => undefined}
      confirmationBusy={false}
    />,
  );

  expect(screen.queryByText("AI 正在工作")).toBeNull();
  expect(screen.queryByText("过程 · 1")).toBeNull();
  expect(document.querySelector('.agent-workline[data-surface="records"]')).toBeTruthy();
  const selectedCommand = document.querySelector('button[data-selectable="true"]');
  expect(selectedCommand?.textContent).toContain("终端");
  expect(selectedCommand?.textContent).not.toContain("pnpm test");
});

test("pending confirmation stays directly visible while prior work records remain expanded", () => {
  const item: ActivityItem = {
    nodeId: "node-confirm-command",
    key: "tool-confirm-command",
    eventType: "tool.completed",
    copy: { label: "命令", detail: "git push" },
    tone: "tool",
    phase: "completed",
    toolKind: "command",
    lead: { action: "命令", subject: "git push", monospace: true },
  };

  render(
    <AgentWorkTimeline
      view={{
        nodes: [],
        items: [item],
        confirmation: {
          current: {
            confirmationId: "confirmation-1",
            title: "需要你的确认",
            question: "是否执行？",
            consequence: "将推送当前分支",
            riskLevel: "medium",
          },
        },
        hasContent: true,
      }}
      presentation="agent_work"
      lifecycle="attention"
      confirmationBusy={false}
      onDecision={() => undefined}
    />,
  );

  const confirmationTitle = screen.getByText("是否执行？");
  const recordDisclosure = screen.getByText("过程").closest("details");
  expect(recordDisclosure?.open).toBe(true);
  expect(recordDisclosure?.contains(confirmationTitle)).toBe(false);
  expect(screen.getByRole("button", { name: "执行" })).toBeTruthy();
});

test("ordinary attention state keeps failed tool evidence behind the process disclosure", () => {
  const item: ActivityItem = {
    nodeId: "node-failed-read",
    key: "tool-failed-read",
    eventType: "tool.failed",
    copy: { label: "读取", detail: "app.js" },
    tone: "tool",
    phase: "failed",
    toolKind: "read",
    lead: { action: "读取", subject: "app.js", monospace: true },
    expandedSections: [{ title: "错误", content: "文件不存在", tone: "danger" }],
  };

  render(
    <AgentWorkTimeline
      view={{ nodes: [], items: [item], confirmation: {}, hasContent: true }}
      presentation="agent_work"
      lifecycle="attention"
      confirmationBusy={false}
    />,
  );

  const disclosure = screen.getByText("过程").closest("details");
  expect(disclosure?.open).toBe(true);
  expect(disclosure?.contains(screen.getByText("app.js"))).toBe(true);
  expect(document.querySelector(".agent-workline > .agent-activity")).toBeNull();
});

test("ordinary timeline shows full reasoning while hiding the internal model request", () => {
  const view = projectAgentWorkTimelineView<TranscriptNode, ConfirmationProjection>({
    nodes: [
      transcriptNode({ nodeId: "thinking", kind: "thinking", eventType: "model.reasoning.delta", phase: "noted", text: "先分析工具结果" }),
      transcriptNode({ nodeId: "model-request", kind: "system", eventType: "model.requested", phase: "executing", summary: "分析工具结果", sequence: 2 }),
      transcriptNode({
        nodeId: "list-failed",
        kind: "tool",
        eventType: "tool.failed",
        phase: "failed",
        toolName: "list_dir",
        display: { kind: "generic_tool_summary", action: "浏览目录", summary: "浏览目录未完成: assets." },
        sequence: 3,
      }),
    ],
  });

  render(
    <AgentWorkTimeline
      view={view}
      presentation="agent_work"
      lifecycle="attention"
      confirmationBusy={false}
    />,
  );

  const disclosure = screen.getByText("过程").closest("details");
  expect(disclosure?.open).toBe(true);
  expect(disclosure?.contains(screen.getByText("assets"))).toBe(true);
  const reasoning = screen.getByText("思考中").closest("details");
  expect(reasoning?.open).toBe(true);
  expect(reasoning?.contains(screen.getByText("先分析工具结果"))).toBe(true);
  expect(screen.queryByText("分析工具结果")).toBeNull();
  expect(screen.queryByText("未完成")).toBeNull();
});

test("completed model reasoning uses one disclosure beside the final answer", () => {
  const reasoningText = "先确认用户意图，再组织最终回答。";
  const workflow = projectStableAssistantWorkflowDisplay<TranscriptNode, ConfirmationProjection>({
    content: "最终回答。",
    transcriptNodes: [
      transcriptNode({
        nodeId: "thinking-completed",
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: reasoningText,
      }),
      transcriptNode({
        nodeId: "answer-completed",
        kind: "answer",
        eventType: "final.result",
        phase: "completed",
        text: "最终回答。",
        sequence: 2,
      }),
    ],
    collapseTimeline: true,
  });
  const activity = workflow.workflow.segments.find((segment) => segment.kind === "activity");
  if (activity?.kind !== "activity") throw new Error("Expected a reasoning activity segment.");

  render(
    <AgentWorkTimeline
      view={activity.timeline}
      presentation="agent_work"
      lifecycle={activity.lifecycle}
      collapsed={activity.collapsed}
      confirmationBusy={false}
    />,
  );

  const process = screen.getByText("思考过程").closest("details");
  expect(process?.open).toBe(true);
  expect(process?.contains(screen.getByText(reasoningText))).toBe(true);
  expect(process?.querySelectorAll("details")).toHaveLength(0);
});

function transcriptNode(input: Partial<TranscriptNode> & Pick<TranscriptNode, "nodeId" | "kind" | "eventType" | "phase">): TranscriptNode {
  return {
    nodeId: input.nodeId,
    runId: "run-1",
    sequence: input.sequence ?? 1,
    eventType: input.eventType,
    kind: input.kind,
    phase: input.phase,
    title: input.title ?? input.kind,
    summary: input.summary,
    text: input.text,
    timestamp: "2026-07-17T00:00:00.000Z",
    toolName: input.toolName,
    display: input.display,
    confirmation: input.confirmation,
    refs: input.refs ?? [],
  };
}
