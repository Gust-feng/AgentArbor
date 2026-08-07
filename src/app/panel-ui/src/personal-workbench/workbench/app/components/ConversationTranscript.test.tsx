import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { WorklineProjectedTurn } from "../../../../../../panel-read-model/assistant/panel-assistant-workline";
import type { ConversationTurn } from "../../../../contracts/conversation";
import type { TranscriptNode } from "../../../../contracts/run";
import { resetTranscriptCache } from "../../../../panel-ui-transcript-store";
import { ConfirmationCard } from "./ConfirmationCard";
import { ConversationTranscript } from "./ConversationTranscript";

beforeEach(() => resetTranscriptCache());

test("conversation transcript expands structured activity into its canonical tool result", () => {
  const turns: readonly ConversationTurn[] = [{
    turnId: "user-1",
    role: "user",
    content: "运行检查",
    status: "completed",
  }];
  const projectedTurns: readonly WorklineProjectedTurn<ConversationTurn>[] = [{
    turn: turns[0]!,
    claimedCurrentRun: false,
  }];
  const nodes = [toolNode()];

  render(<ConversationTranscript
    conversationId="conversation-1"
    projectedTurns={projectedTurns}
    turns={turns}
    currentRunId="run-1"
    currentRunNodes={nodes}
    currentRunToolResults={[{
      callId: "provider-call-1",
      factId: "tool-fact-1",
      toolName: "Shell",
      input: { command: "pnpm test" },
      output: { stdout: "29 tests passed", stderr: "" },
      status: "completed",
      durationMs: 90,
    }]}
    showModelUsage={false}
    developerModeEnabled
    standaloneRun={{
      currentRunId: "run-1",
      runStatus: "completed",
      runProjection: { nodes },
    }}
    models={[]}
    selectedModelId=""
    onDecision={() => undefined}
    confirmationBusy={false}
  />);

  fireEvent.click(screen.getByRole("button", { name: /完成 1 项操作/ }));
  fireEvent.click(screen.getByRole("button", { name: /运行 终端/ }));

  expect(screen.getByText("完整工具结果")).toBeTruthy();
  expect(screen.getAllByText(/29 tests passed/)).toHaveLength(2);
  expect(screen.getByText("tool-fact-1")).toBeTruthy();
});

test("conversation transcript keeps normal tool evidence while hiding the canonical result", () => {
  const turns: readonly ConversationTurn[] = [{
    turnId: "user-1",
    role: "user",
    content: "运行检查",
    status: "completed",
  }];
  const projectedTurns: readonly WorklineProjectedTurn<ConversationTurn>[] = [{
    turn: turns[0]!,
    claimedCurrentRun: false,
  }];
  const nodes = [toolNode()];

  render(<ConversationTranscript
    conversationId="conversation-normal"
    projectedTurns={projectedTurns}
    turns={turns}
    currentRunId="run-1"
    currentRunNodes={nodes}
    currentRunToolResults={[{
      callId: "provider-call-1",
      factId: "tool-fact-1",
      toolName: "Shell",
      input: { command: "pnpm test" },
      output: { stdout: "29 tests passed", stderr: "" },
      status: "completed",
      durationMs: 90,
    }]}
    showModelUsage={false}
    developerModeEnabled={false}
    standaloneRun={{
      currentRunId: "run-1",
      runStatus: "completed",
      runProjection: { nodes },
    }}
    models={[]}
    selectedModelId=""
    onDecision={() => undefined}
    confirmationBusy={false}
  />);

  expect(screen.getByText("完成 1 项操作")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /完成 1 项操作/ }));
  fireEvent.click(screen.getByRole("button", { name: /运行 终端/ }));

  expect(screen.getByText("运行 终端")).toBeTruthy();
  expect(screen.getByText("pnpm test")).toBeTruthy();
  expect(screen.getByText("29 tests passed")).toBeTruthy();
  expect(screen.queryByText("完整工具结果")).toBeNull();
  expect(screen.queryByText("tool-fact-1")).toBeNull();
});

test("conversation transcript renders thinking separately from the tool workflow", () => {
  const turns: readonly ConversationTurn[] = [{
    turnId: "user-1",
    role: "user",
    content: "读取 README",
    status: "completed",
  }];
  const projectedTurns: readonly WorklineProjectedTurn<ConversationTurn>[] = [{
    turn: turns[0]!,
    claimedCurrentRun: false,
  }];
  const thinkingNode: TranscriptNode = {
    nodeId: "thinking-node-1",
    runId: "run-1",
    sequence: 1,
    eventType: "model.reasoning.completed",
    kind: "thinking",
    phase: "completed",
    title: "思考",
    text: "先确认用户意图，再读取文件。",
    summary: "先确认用户意图，再读取文件。",
    timestamp: "2026-07-31T00:00:00.000Z",
    refs: [{ kind: "model_call", id: "model-1" }],
  };
  const nodes = [thinkingNode, toolNode()];

  render(<ConversationTranscript
    conversationId="conversation-thinking"
    projectedTurns={projectedTurns}
    turns={turns}
    currentRunId="run-1"
    currentRunNodes={nodes}
    currentRunToolResults={[]}
    showModelUsage={false}
    developerModeEnabled={false}
    standaloneRun={{
      currentRunId: "run-1",
      runStatus: "completed",
      runProjection: { nodes },
    }}
    models={[]}
    selectedModelId=""
    onDecision={() => undefined}
    confirmationBusy={false}
  />);

  // 思考拥有独立展示块，正文直接可见。
  expect(screen.getByRole("button", { name: /展开思考|收起思考/ })).toBeTruthy();
  expect(screen.getByText("先确认用户意图，再读取文件。")).toBeTruthy();

  // 工具工作流只统计工具条目，思考不再计入“操作”。
  expect(screen.getByText("完成 1 项操作")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /完成 1 项操作/ }));
  const timeline = document.querySelector(".aa-activity-timeline");
  expect(timeline?.textContent).not.toContain("先确认用户意图");
  expect(timeline?.textContent).toContain("运行 终端");
});

test("conversation transcript uses the shared markdown renderer without hover layout shifts", () => {
  const turns: readonly ConversationTurn[] = [
    { turnId: "user-1", role: "user", content: "整理工具", status: "completed" },
    {
      turnId: "assistant-1",
      role: "assistant",
      content: "| 工具 | 用途 |\n| --- | --- |\n| `Read` | 读取文件 |\n\n第一段   不应保留多余空格。",
      status: "completed",
    },
  ];
  const projectedTurns: readonly WorklineProjectedTurn<ConversationTurn>[] = turns.map((turn) => ({
    turn,
    claimedCurrentRun: false,
  }));

  render(<ConversationTranscript
    conversationId="conversation-markdown"
    projectedTurns={projectedTurns}
    turns={turns}
    currentRunNodes={[]}
    currentRunToolResults={[]}
    showModelUsage={false}
    developerModeEnabled={false}
    models={[]}
    selectedModelId=""
    onDecision={() => undefined}
    confirmationBusy={false}
  />);

  expect(document.querySelector(".rich-table")).not.toBeNull();
  const answer = document.querySelector(".aa-answer-block");
  expect(answer).not.toBeNull();
  expect(screen.getByRole("button", { name: "复制回答" })).toBeTruthy();
  const before = answer?.querySelectorAll(".aa-answer-copy").length;
  fireEvent.mouseEnter(answer!);
  expect(answer?.querySelectorAll(".aa-answer-copy").length).toBe(before);
});

test("confirmation keeps approval and denial behavior without legacy transcript styling", () => {
  const onDecision = vi.fn();
  render(<ConfirmationCard
    confirmation={{
      confirmationId: "confirmation-1",
      title: "允许修改文件",
      question: "写入 README.md",
      consequence: "文件内容会更新",
      affectedResources: ["README.md"],
      riskLevel: "medium",
    }}
    busy={false}
    onDecision={onDecision}
  />);

  fireEvent.click(screen.getByRole("button", { name: "执行" }));
  fireEvent.click(screen.getByRole("button", { name: "不执行" }));

  expect(onDecision).toHaveBeenNthCalledWith(1, "approve_once");
  expect(onDecision).toHaveBeenNthCalledWith(2, "deny");
  expect(document.querySelector(".confirmation-node-body")).toBeNull();
});

function toolNode(): TranscriptNode {
  return {
    nodeId: "tool-node-1",
    runId: "run-1",
    sequence: 1,
    eventType: "tool.completed",
    kind: "tool",
    phase: "completed",
    title: "Shell",
    toolName: "Shell",
    timestamp: "2026-07-31T00:00:00.000Z",
    display: {
      kind: "command_summary",
      command: "pnpm test",
      exitCode: 0,
      stdoutPreview: "29 tests passed",
    },
    refs: [{ kind: "tool_call", id: "tool-fact-1" }],
  };
}
