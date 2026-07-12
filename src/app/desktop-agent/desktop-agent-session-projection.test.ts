import assert from "node:assert/strict";
import test from "node:test";
import type { ArborMessage } from "../../domain/common.js";
import type { EventLogEntry } from "../../kernel/events/in-memory-event-log.js";
import { activityFromEventEntries, resultBlocksFrom } from "./desktop-agent-session-projection.js";

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

test("desktop agent activity derives tool facts from the flat output and omits large content", () => {
  const activities = activityFromEventEntries([
    event("tool.requested", {
      callId: "call-read",
      toolName: "read_file",
      input: { path: "notes.md" },
    }, 1),
    event("tool.completed", {
      callId: "call-read",
      toolName: "read_file",
      output: {
        refId: "workspace:file:notes.md",
        path: "notes.md",
        bytes: 120_000,
        content: "SECRET_FILE_BODY",
        truncated: true,
      },
    }, 2),
  ], "completed");
  const toolActivity = activities.find((item) => item.type === "tool_completed");

  assert.equal(toolActivity?.path, "notes.md");
  assert.equal(toolActivity?.truncated, true);
  assert.match(toolActivity?.summary ?? "", /notes\.md/);
  assert.doesNotMatch(toolActivity?.summary ?? "", /SECRET_FILE_BODY/);
});

test("desktop agent activity ignores late lifecycle events after the first terminal fact", () => {
  const activities = activityFromEventEntries([
    event("tool.completed", {
      callId: "call-read",
      toolName: "read_file",
      output: { path: "notes.md", bytes: 10 },
    }, 1),
    event("tool.requested", {
      callId: "call-read",
      toolName: "read_file",
      input: { path: "notes.md" },
    }, 2),
  ], "completed");

  assert.equal(activities.filter((item) => item.type === "tool_completed").length, 1);
  assert.equal(activities.some((item) => item.type === "tool_requested"), false);
});

test("desktop agent activity does not interpret legacy tool wrappers", () => {
  const activities = activityFromEventEntries([
    event("tool.completed", {
      callId: "call-legacy",
      toolName: "vendor__lookup",
      input: {},
      output: {
        action: "legacy action",
        summary: "legacy summary",
        result: { path: "legacy/path", text: "legacy body" },
      },
    }),
  ], "completed");
  const toolActivity = activities.find((item) => item.type === "tool_completed");

  assert.notEqual(toolActivity?.action, "legacy action");
  assert.doesNotMatch(toolActivity?.summary ?? "", /legacy (summary|body)/);
  assert.equal(toolActivity?.path, undefined);
});

test("desktop agent tool result blocks summarize facts without repeating tool bodies", () => {
  const blocks = resultBlocksFrom({
    answer: "done",
    evidenceRefs: [],
    toolCalls: [{
      callId: "call-read",
      toolName: "read_file",
      input: { path: "large.ts" },
      output: {
        refId: "workspace:file:large.ts",
        path: "large.ts",
        bytes: 120_000,
        content: "LARGE_TOOL_BODY",
        truncated: false,
      },
      status: "completed",
      durationMs: 4,
    }],
  });
  const summary = blocks.find((block) => block.kind === "tool_summary")?.summary ?? "";

  assert.match(summary, /large\.ts/);
  assert.doesNotMatch(summary, /LARGE_TOOL_BODY/);
});

function event(type: string, payload: Record<string, unknown>, sequence = 1): EventLogEntry {
  const timestamp = `2026-06-14T00:00:0${sequence}.000Z`;
  return {
    sequence,
    type: type as EventLogEntry["type"],
    message: {
      id: `message-${sequence}`,
      traceId: "trace-test",
      from: { id: "test", role: "runtime" },
      to: { role: "runtime" },
      type: type as ArborMessage["type"],
      intent: type.replaceAll(".", "_"),
      payload,
      createdAt: timestamp,
    },
    recordedAt: timestamp,
  };
}
