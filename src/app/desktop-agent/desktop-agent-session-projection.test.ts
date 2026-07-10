import assert from "node:assert/strict";
import test from "node:test";
import type { ArborMessage } from "../../domain/common.js";
import type { EventLogEntry } from "../../kernel/events/in-memory-event-log.js";
import { activityFromEventEntries } from "./desktop-agent-session-projection.js";

test("desktop agent activity preserves user-facing model failure kind", () => {
  const activities = activityFromEventEntries([
    event("model.failed", {
      requestId: "model-request-after-tool",
      failureKind: "provider_network",
      failureMessage: "fetch failed ECONNRESET",
    }),
  ], "failed");
  const modelFailure = activities.find((item) => item.type === "model_failed");

  assert.equal(modelFailure?.title, "回复失败");
  assert.equal(modelFailure?.summary, "模型服务连接失败。");
});

function event(type: string, payload: Record<string, unknown>): EventLogEntry {
  return {
    sequence: 1,
    type: type as EventLogEntry["type"],
    message: {
      id: "message-1",
      traceId: "trace-test",
      from: { id: "test", role: "runtime" },
      to: { role: "runtime" },
      type: type as ArborMessage["type"],
      intent: type.replaceAll(".", "_"),
      payload,
      createdAt: "2026-06-14T00:00:00.000Z",
    },
    recordedAt: "2026-06-14T00:00:00.000Z",
  };
}
