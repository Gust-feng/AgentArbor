import assert from "node:assert/strict";
import test from "node:test";
import { assistantFailureParts } from "./panel-assistant-failure.js";

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
