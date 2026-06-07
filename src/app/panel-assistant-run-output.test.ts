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
      message: "任务没有完成。你可以继续发送消息让我接着处理。",
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

test("visible run problem sanitizes failed run detail text", () => {
  const problem = visibleRunProblem(
    { status: "failed" },
    { currentAction: "已经输出过的动作" },
    { error: { code: "provider", message: "模型连接失败。\nraw provider response: sk-test-secret" } },
    undefined
  );

  assert.deepEqual(problem, {
    title: "运行失败",
    message: "模型连接失败。",
    tone: "error",
  });
  assert.equal(JSON.stringify(problem).includes("raw provider"), false);
  assert.equal(JSON.stringify(problem).includes("sk-test-secret"), false);
});

test("visible result text follows the product answer priority", () => {
  assert.equal(
    visibleResultText({
      canvas: {
        kind: "desktop_agent_canvas",
        agent: { answer: { answer: "agent answer" } },
      },
      restoredResult: { summary: "restored" },
    }),
    "agent answer"
  );
  assert.equal(
    visibleResultText({
      canvas: {
        kind: "work_session_canvas",
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
        kind: "work_session_canvas",
        workSession: {
          report: { decisionSummary: " " },
        },
      },
      restoredResult: { summary: "restored" },
    }),
    "restored"
  );
});

test("visible result text treats work session canvas as explicit legacy compatibility only", () => {
  assert.equal(
    visibleResultText({
      canvas: {
        kind: "work_session_canvas",
        workSession: {
          directAnswer: { answer: "legacy direct answer" },
          report: { decisionSummary: "legacy report summary" },
        },
      },
      restoredResult: { summary: "restored" },
    }),
    "legacy direct answer"
  );
  assert.equal(
    visibleResultText({
      canvas: {
        workSession: {
          directAnswer: { answer: "untyped legacy answer" },
          report: { decisionSummary: "untyped legacy report" },
        },
      },
      restoredResult: { summary: "restored" },
    }),
    "restored"
  );
});
