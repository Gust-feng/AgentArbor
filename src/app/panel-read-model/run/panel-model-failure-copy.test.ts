import assert from "node:assert/strict";
import test from "node:test";
import type { ArborMessage } from "../../../domain/common.js";
import type { EventLogEntry } from "../../../kernel/events/in-memory-event-log.js";
import { latestModelFailureTextForUser } from "./panel-model-failure-copy.js";

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
