import assert from "node:assert/strict";
import test from "node:test";
import {
  friendlyUserFacingModelFailureText,
  sanitizeAssistantVisibleText,
  sanitizeConversationHistoryText,
} from "./visible-text-safety.js";

test("assistant visible text keeps ordinary hyphenated language", () => {
  assert.equal(
    sanitizeAssistantVisibleText("This is a run-of-the-mill example."),
    "This is a run-of-the-mill example."
  );
});

test("assistant visible text keeps concrete run references", () => {
  assert.equal(
    sanitizeAssistantVisibleText("requestId: model-request-abc\nResult from run-0003 is ready."),
    "requestId: model-request-abc\nResult from run-0003 is ready."
  );
});

test("assistant visible text preserves ordinary task headings", () => {
  assert.equal(
    sanitizeAssistantVisibleText("## 当前任务\n先说明目标，再给出下一步。"),
    "## 当前任务\n先说明目标，再给出下一步。"
  );
});

test("assistant visible text preserves intentional blank lines", () => {
  assert.equal(
    sanitizeAssistantVisibleText("第一段\n\n\n第二段"),
    "第一段\n\n\n第二段"
  );
});

test("conversation history sanitizer keeps ordinary ids while compacting whitespace", () => {
  assert.equal(
    sanitizeConversationHistoryText("A run-of-the-mill note mentions model-request-abc."),
    "A run-of-the-mill note mentions model-request-abc."
  );
});

test("model failure visible text keeps diagnostic fields out of ordinary copy", () => {
  const message = friendlyUserFacingModelFailureText({
    failureKind: "output_validation",
    failureMessage: "Model output failed the requested output contract.",
    requestId: "model-request-abc",
    responseId: "model-response-abc",
    purpose: "desktop_agent",
    outputContract: { contractId: "desktop.agent_response.v1" },
  });

  assert.equal(message, "模型输出校验失败。");
  assert.equal(message.includes("desktop_agent"), false);
  assert.equal(message.includes("desktop.agent_response"), false);
  assert.equal(message.includes("model-request"), false);
  assert.equal(message.includes("model-response"), false);
});
