import assert from "node:assert/strict";
import test from "node:test";
import {
  assistantFailureParts,
  assistantTerminalNoticeTitle,
  assistantTerminalStatus,
  transcriptNodesWithoutFailureEcho,
} from "./panel-assistant-failure.js";

test("assistant terminal status maps blocked and cancelled turns to distinct notices", () => {
  assert.equal(assistantTerminalStatus("blocked"), "blocked");
  assert.equal(assistantTerminalStatus("cancelled"), "cancelled");
  assert.equal(assistantTerminalStatus("completed"), undefined);
  assert.equal(assistantTerminalNoticeTitle("blocked"), "需要处理");
  assert.equal(assistantTerminalNoticeTitle("cancelled"), "已取消");
});

test("assistant failure projection preserves previous output before the error marker", () => {
  assert.deepEqual(
    assistantFailureParts("已经输出的内容。\n\n错误信息：上游模型连接中断。"),
    {
      previous: "已经输出的内容。",
      error: "错误信息：上游模型连接中断。",
    }
  );
});

test("assistant failure projection strips internal control markup from failures", () => {
  assert.deepEqual(
    assistantFailureParts("草稿。<tool_call>{}</tool_call>\n\n错误信息：401 status code (no body)"),
    {
      previous: "草稿。",
      error: "错误信息：HTTP 401",
    }
  );
});

test("assistant failure projection presents stream parse failures as compatibility issues", () => {
  const projected = assistantFailureParts("已输出。\n\n错误信息：OpenAI-compatible provider stream response could not be parsed.");

  assert.equal(projected.previous, "已输出。");
  assert.equal(projected.error.includes("流式返回格式不兼容"), true);
  assert.equal(projected.error.includes("OpenAI-compatible provider"), false);
});

test("assistant failure projection treats plain failed content as the error message", () => {
  assert.deepEqual(
    assistantFailureParts("模型不可用。"),
    {
      previous: "",
      error: "模型不可用。",
    }
  );
});

test("assistant failure projection strips failed system nodes from workflow timeline", () => {
  const failure = assistantFailureParts("错误信息：模型输出校验失败。");
  const nodes = transcriptNodesWithoutFailureEcho([
    node({
      nodeId: "tool-1",
      eventType: "tool.failed",
      kind: "tool",
      phase: "failed",
      summary: "读取模型能力信息失败",
    }),
    node({
      nodeId: "system-1",
      eventType: "model.failed",
      kind: "system",
      phase: "failed",
      summary: "模型输出校验失败。",
    }),
    node({
      nodeId: "system-2",
      eventType: "run.failed",
      kind: "system",
      phase: "failed",
      summary: "模型输出校验失败。",
    }),
  ], failure);

  assert.deepEqual(nodes?.map((item) => item.nodeId), ["tool-1"]);
});

test("assistant failure projection keeps non-failed system narration in workflow timeline", () => {
  const failure = assistantFailureParts("错误信息：模型输出校验失败。");
  const nodes = transcriptNodesWithoutFailureEcho([
    node({
      nodeId: "system-1",
      eventType: "model.side.completed",
      kind: "system",
      phase: "completed",
      summary: "已切换到回退路径。",
    }),
  ], failure);

  assert.deepEqual(nodes?.map((item) => item.nodeId), ["system-1"]);
});

function node(input: {
  readonly nodeId: string;
  readonly eventType: string;
  readonly kind: "thinking" | "tool" | "confirmation" | "user_decision" | "answer" | "body" | "system";
  readonly phase: "noted" | "preparing" | "waiting_approval" | "approved" | "denied" | "guidance" | "executing" | "completed" | "failed" | "blocked" | "cancelled";
  readonly text?: string;
  readonly summary?: string;
}) {
  return {
    nodeId: input.nodeId,
    runId: "run-1",
    sequence: 1,
    eventType: input.eventType,
    kind: input.kind,
    phase: input.phase,
    text: input.text,
    summary: input.summary,
    title: "",
    timestamp: "2026-06-20T00:00:00.000Z",
    refs: [],
  };
}
