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
      message: "任务没有完成。",
      tone: "warning",
    }
  );
});

test("visible run problem keeps lost live execution recovery internal", () => {
  assert.equal(
    visibleRunProblem(
      { status: "blocked" },
      { headline: "任务没有完成", currentAction: "等待运行恢复" },
      {
        error: {
          code: "execution_continuation_lost",
          message: "The live execution was interrupted when the process restarted.",
        },
      },
      undefined,
    ),
    undefined,
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
      message: "模型连接失败",
      tone: "error",
    }
  );
});

test("visible run problem preserves failed run detail text", () => {
  const problem = visibleRunProblem(
    { status: "failed" },
    { currentAction: "已经输出过的动作" },
    { error: { code: "provider", message: "模型连接失败。\nraw provider response: sk-test-secret" } },
    undefined
  );

  assert.deepEqual(problem, {
    message: "模型连接失败。\nraw provider response: sk-test-secret",
    tone: "error",
  });
  assert.equal(JSON.stringify(problem).includes("raw provider"), true);
  assert.equal(JSON.stringify(problem).includes("sk-test-secret"), true);
});

test("visible run problem preserves concrete tool and MCP errors without generic failure titles", () => {
  for (const error of [
    { code: "tool_boundary_resolution_failed", message: "工具边界不可用" },
    { code: "mcp_request_timeout", message: "MCP 服务超时" },
    { code: "ordinary_execution_failed", message: "执行已停止" },
  ]) {
    assert.deepEqual(
      visibleRunProblem({ status: "failed" }, undefined, { error }, undefined),
      { message: error.message, tone: "error" },
    );
  }
});

test("visible result text follows the product answer priority", () => {
  assert.equal(
    visibleResultText({
      restoredResult: { summary: "restored", content: "restored content" },
    }),
    "restored content"
  );
  assert.equal(
    visibleResultText({
      restoredResult: { summary: "restored" },
    }),
    "restored"
  );
});
