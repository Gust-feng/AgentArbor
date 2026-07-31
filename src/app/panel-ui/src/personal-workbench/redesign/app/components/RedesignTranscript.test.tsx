import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { WorklineProjectedTurn } from "../../../../../../panel-read-model/assistant/panel-assistant-workline";
import type { ConversationTurn } from "../../../../contracts/conversation";
import type { TranscriptNode } from "../../../../contracts/run";
import { resetTranscriptCache } from "../../../../panel-ui-transcript-store";
import { ConfirmationCard } from "./ConfirmationCard";
import { RedesignTranscript } from "./RedesignTranscript";

beforeEach(() => resetTranscriptCache());

test("redesign transcript expands structured activity into its canonical tool result", () => {
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

  render(<RedesignTranscript
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

  fireEvent.click(screen.getByRole("button", { name: /工具调用 1 已完成/ }));
  fireEvent.click(screen.getByRole("button", { name: /运行 终端/ }));

  expect(screen.getByText("完整工具结果")).toBeTruthy();
  expect(screen.getAllByText(/29 tests passed/)).toHaveLength(2);
  expect(screen.getByText("tool-fact-1")).toBeTruthy();
});

test("redesign confirmation keeps approval and denial behavior without legacy transcript styling", () => {
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
