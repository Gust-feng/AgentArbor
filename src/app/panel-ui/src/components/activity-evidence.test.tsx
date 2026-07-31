import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import type { ActivityItem } from "../../../panel-read-model/transcript/panel-transcript-activity-copy";
import type { ToolCallResult } from "../../../../domain/tools";
import { ActivityEvidencePanel } from "./activity-evidence";

test("activity evidence renders sources with only title, link, and domain", () => {
  render(<ActivityEvidencePanel item={item({
    title: "来源",
    content: "Official guide · developers.openai.com",
    format: "source_list",
    items: [{
      title: "Official guide",
      detail: "Tool calling reference",
      href: "https://developers.openai.com/",
      meta: [{ value: "legacy author metadata" }],
    }],
  })} />);

  expect(screen.getByRole("link", { name: "Official guide" }).getAttribute("href"))
    .toBe("https://developers.openai.com/");
  expect(screen.queryByText("Tool calling reference")).toBeNull();
  expect(screen.getByText("developers.openai.com")).toBeTruthy();
  expect(screen.queryByText("legacy author metadata")).toBeNull();
  expect(screen.queryByText("来源")).toBeNull();
  expect(screen.queryByText("搜索结果")).toBeNull();
  expect(screen.queryByText("命中结果")).toBeNull();
});

test("activity evidence keeps file locations scannable without parsing display text", () => {
  render(<ActivityEvidencePanel item={item({
    title: "匹配位置",
    content: "src/index.ts:4 - needle",
    format: "path_list",
    items: [{ title: "src/index.ts:4", detail: "needle", monospace: true }],
  })} />);

  expect(screen.getByText("src/index.ts:4").getAttribute("data-monospace")).toBe("true");
  expect(screen.getByText("needle")).toBeTruthy();
  expect(screen.queryByText("匹配位置")).toBeNull();
});

test("linked read evidence keeps only the source and omits partial page content", () => {
  const readItem: ActivityItem = {
    nodeId: "read-node",
    key: "read-item",
    eventType: "tool.completed",
    copy: { label: "读取", detail: "AgentArbor documentation" },
    tone: "tool",
    phase: "completed",
    toolKind: "read",
    lead: { action: "读取", subject: "AgentArbor documentation" },
    expandedSections: [
      {
        title: "来源",
        content: "AgentArbor   documentation",
        format: "source",
        href: "https://www.example.com/docs",
      },
      {
        title: "内容",
        content: "The workbench keeps tool evidence secondary.",
        format: "quote",
      },
    ],
  };

  render(<ActivityEvidencePanel item={readItem} />);

  expect(document.querySelector(".agent-evidence-source-title")).toBeNull();
  expect(screen.getByRole("link", { name: "example.com" })).toBeTruthy();
  expect(screen.queryByText("The workbench keeps tool evidence secondary.")).toBeNull();
  expect(screen.queryByText("来源")).toBeNull();
  expect(screen.queryByText("内容")).toBeNull();
});

test("web search evidence renders one source link and ignores duplicate excerpts", () => {
  const searchItem: ActivityItem = {
    nodeId: "search-node",
    key: "search-item",
    eventType: "tool.completed",
    copy: { label: "搜索", detail: "AgentArbor" },
    tone: "tool",
    phase: "completed",
    toolKind: "search",
    lead: { action: "搜索", subject: "AgentArbor" },
    expandedSections: [
      {
        title: "来源",
        content: "AgentArbor guide",
        format: "source",
        href: "https://www.example.com/guide",
      },
      {
        title: "摘录",
        content: "This is only the first incomplete paragraph...",
        format: "quote",
      },
      {
        title: "内容",
        content: "A second repeated and incomplete page fragment...",
        format: "plain",
      },
    ],
  };

  render(<ActivityEvidencePanel item={searchItem} />);

  expect(document.querySelector('a.agent-evidence-source[href="https://www.example.com/guide"]')).toBeTruthy();
  expect(screen.getByText("AgentArbor guide")).toBeTruthy();
  expect(screen.getByText("example.com")).toBeTruthy();
  expect(screen.queryByText("This is only the first incomplete paragraph...")).toBeNull();
  expect(screen.queryByText("A second repeated and incomplete page fragment...")).toBeNull();
});

test("command evidence keeps the command and output without internal execution metadata", () => {
  const commandItem: ActivityItem = {
    nodeId: "command-node",
    key: "command-item",
    eventType: "tool.completed",
    copy: { label: "命令", detail: "pnpm test" },
    tone: "tool",
    phase: "completed",
    toolKind: "command",
    expandedSections: [
      { title: "命令", content: "$ pnpm test", format: "console" },
      { title: "输出", content: "10 tests passed", format: "console" },
      { title: "更多信息", content: "目录：Z:/AgentArbor\nShell：PowerShell\n耗时：1.5s", format: "diagnostics" },
    ],
  };

  render(<ActivityEvidencePanel item={commandItem} />);

  expect(screen.getByText("pnpm test")).toBeTruthy();
  expect(screen.getByText("10 tests passed")).toBeTruthy();
  expect(screen.queryByText("更多信息")).toBeNull();
  expect(screen.queryByText("目录：Z:/AgentArbor")).toBeNull();
  expect(screen.queryByText("Shell：PowerShell")).toBeNull();
  expect(screen.queryByText("耗时：1.5s")).toBeNull();
});

test("activity evidence keeps structured sections and exposes the complete canonical tool result", () => {
  const toolResult: ToolCallResult = {
    callId: "provider-call-1",
    factId: "tool-fact-1",
    toolName: "Shell",
    input: { command: "pnpm test" },
    output: {
      stdout: "complete stdout\nlast line",
      stderr: "warning from stderr",
      truncated: true,
      continuation: { ref: "tool-output:1", nextInput: { offset: 2048 } },
    },
    status: "failed",
    error: "Command exited with code 1",
    errorDomain: "process_error",
    failureAttribution: "execution_failure",
    errorFacts: { exitCode: "1" },
    durationMs: 1250,
  };

  render(<ActivityEvidencePanel item={item({
    title: "输出",
    content: "bounded summary",
    format: "console",
  })} toolResult={toolResult} />);

  expect(screen.getByText("bounded summary")).toBeTruthy();
  expect(screen.getByText("完整工具结果")).toBeTruthy();
  expect(screen.getByText("失败 · 1250 ms")).toBeTruthy();
  expect(screen.getByText("provider-call-1")).toBeTruthy();
  expect(screen.getByText("tool-fact-1")).toBeTruthy();
  expect(screen.getByText("结果已截断 · 保留了继续读取信息")).toBeTruthy();
  expect(screen.getByText(/complete stdout/)).toBeTruthy();
  expect(screen.getByText(/warning from stderr/)).toBeTruthy();
  expect(screen.getByText("Command exited with code 1")).toBeTruthy();
  expect(screen.getByText("execution_failure")).toBeTruthy();
  expect(screen.getByText(/tool-output:1/)).toBeTruthy();
});

function item(section: NonNullable<ActivityItem["expandedSections"]>[number]): ActivityItem {
  return {
    nodeId: "node-1",
    key: "item-1",
    eventType: "tool.completed",
    copy: { label: "搜索", detail: "AgentArbor" },
    tone: "tool",
    phase: "completed",
    toolKind: "search",
    expandedSections: [section],
  };
}
