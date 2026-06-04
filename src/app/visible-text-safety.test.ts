import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeAssistantVisibleText, sanitizeConversationHistoryText } from "./visible-text-safety.js";

test("assistant visible text keeps ordinary hyphenated language", () => {
  assert.equal(
    sanitizeAssistantVisibleText("This is a run-of-the-mill example."),
    "This is a run-of-the-mill example."
  );
});

test("assistant visible text still redacts concrete internal run references", () => {
  assert.equal(
    sanitizeAssistantVisibleText("requestId: model-request-abc\nResult from run-0003 is ready."),
    "Result from [运行引用] is ready."
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

test("conversation history sanitizer uses the same internal id boundary", () => {
  assert.equal(
    sanitizeConversationHistoryText("A run-of-the-mill note mentions model-request-abc."),
    "A run-of-the-mill note mentions [运行引用]."
  );
});
