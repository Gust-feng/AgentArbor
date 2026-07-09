import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeComparableText,
  sanitizeFailureCopy,
  userVisibleAnswer,
} from "./panel-assistant-visible-text.js";

test("panel assistant visible text removes internal control markup", () => {
  assert.equal(
    userVisibleAnswer("先回答。<tool_call>{\"name\":\"read\"}</tool_call>继续回答。"),
    "先回答。继续回答。"
  );
});

test("panel assistant visible text keeps product-facing assistant wording", () => {
  assert.equal(
    userVisibleAnswer("AgentArbor 桌面 Root Agent 可以继续。Root Agent 已处理。"),
    "AgentArbor 桌面助手 可以继续。助手 已处理。"
  );
});

test("panel failure copy normalizes SDK no-body status errors", () => {
  assert.equal(sanitizeFailureCopy("401 status code (no body)"), "HTTP 401");
});

test("panel failure copy presents stream parse failures as compatibility issues", () => {
  assert.equal(
    sanitizeFailureCopy("OpenAI-compatible provider stream response could not be parsed."),
    "模型服务的流式返回格式不兼容，已改用非流式方式重试；如果仍失败，请在设置中关闭该模型的流式输出。"
  );
});

test("panel comparable text uses the same visible answer normalization", () => {
  assert.equal(
    normalizeComparableText("Root Agent\n\n已处理 <internal_control>raw</internal_control>"),
    "助手 已处理"
  );
});
