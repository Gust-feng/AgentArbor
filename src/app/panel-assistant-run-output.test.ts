import assert from "node:assert/strict";
import test from "node:test";
import { visibleResultText, visibleRunProblem } from "./panel-assistant-run-output.js";

test("visible run problem prefers app-level errors", () => {
  assert.deepEqual(
    visibleRunProblem({ status: "failed" }, undefined, { error: { code: "provider", message: "provider failed" } }, "系统错误：连接失败"),
    {
      title: "出现错误",
      message: "连接失败",
      tone: "error",
    }
  );
});

test("visible run problem gives out-of-fuel a recoverable paused message", () => {
  assert.deepEqual(
    visibleRunProblem(
      { status: "paused" },
      { headline: "任务没有完成", currentAction: "内部状态" },
      { error: { code: "out_of_fuel", message: "raw out_of_fuel" } },
      undefined
    ),
    {
      title: "任务没有完成",
      message: "这轮调用次数已到上限，任务没有完成。你可以继续发送消息让我接着处理。",
      tone: "warning",
    }
  );
});

test("visible run problem surfaces failed run details without inventing a report", () => {
  assert.deepEqual(
    visibleRunProblem(
      { status: "failed" },
      { currentAction: "已经输出过的动作" },
      { error: { code: "provider", message: "模型连接失败" } },
      undefined
    ),
    {
      title: "运行失败",
      message: "模型连接失败",
      tone: "error",
    }
  );
});

test("visible result text follows the product answer priority", () => {
  assert.equal(
    visibleResultText({
      canvas: {
        agent: { answer: { answer: "agent answer" } },
        workSession: {
          directAnswer: { answer: "direct answer" },
          report: { decisionSummary: "report summary" },
        },
      },
      restoredResult: { summary: "restored" },
    }),
    "agent answer"
  );
  assert.equal(
    visibleResultText({
      canvas: {
        workSession: {
          report: { decisionSummary: "report summary" },
        },
      },
      restoredResult: { summary: "restored" },
    }),
    "report summary"
  );
  assert.equal(
    visibleResultText({
      canvas: {
        workSession: {
          report: { decisionSummary: " " },
        },
      },
      restoredResult: { summary: "restored" },
    }),
    "restored"
  );
});
