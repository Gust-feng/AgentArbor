import assert from "node:assert/strict";
import test from "node:test";
import type { ArborMessage } from "../domain/common.js";
import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";
import { latestModelFailureTextForUser } from "./model-failure-visible-copy.js";
import {
  friendlyUserFacingModelFailureText,
  normalizeModelFacingText,
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

test("model-facing text normalizer preserves code indentation and internal spacing", () => {
  const code = [
    "Ran the command, stdout was:",
    "```",
    "name    status",
    "alpha   ok",
    "beta    pending",
    "```",
  ].join("\n");
  // Model-facing text must keep column alignment / indentation exactly as written.
  assert.equal(normalizeModelFacingText(code), code);
});

test("model-facing text normalizer only normalizes line endings and outer whitespace", () => {
  assert.equal(
    normalizeModelFacingText("  line one\n\n  line two\n\tindented  \r\n"),
    "line one\n\n  line two\n\tindented"
  );
  // Internal runs of spaces/tabs are preserved (not collapsed).
  assert.equal(normalizeModelFacingText("a\t\tb     c"), "a\t\tb     c");
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

test("latest model failure copy explains post-tool continuation failures", () => {
  const message = latestModelFailureTextForUser([
    event("tool.completed", "tool-message-1", { callId: "call-command" }),
    event("model.failed", "model-message-1", {
      failureKind: "provider_network",
      failureMessage: "fetch failed ECONNRESET",
      requestId: "model-request-after-tool",
    }),
  ]);

  assert.equal(message, "工具已执行，但后续模型续跑失败。模型服务连接失败。");
});

test("latest model failure copy keeps initial model failures concise", () => {
  const message = latestModelFailureTextForUser([
    event("model.failed", "model-message-1", {
      failureKind: "provider_network",
      failureMessage: "fetch failed ECONNRESET",
      requestId: "model-request-initial",
    }),
  ]);

  assert.equal(message, "模型服务连接失败。");
});

function event(type: string, id: string, payload: Record<string, unknown>): EventLogEntry {
  return {
    sequence: 1,
    type: type as EventLogEntry["type"],
    message: {
      id,
      traceId: "trace-test",
      from: { id: "test", role: "runtime" },
      to: { role: "runtime" },
      type: type as ArborMessage["type"],
      intent: "test",
      payload,
      createdAt: "2026-06-14T00:00:00.000Z",
    },
    recordedAt: "2026-06-14T00:00:00.000Z",
  };
}
