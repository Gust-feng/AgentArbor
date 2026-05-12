import assert from "node:assert/strict";
import test from "node:test";
import { BasicAgentRunEventHub } from "./basic-agent-run-event-hub.js";

test("BasicAgentRunEventHub publishes deduplicated events with replay cursors", () => {
  const hub = new BasicAgentRunEventHub();

  const started = hub.publish({
    id: "event-1",
    runId: "run-1",
    type: "run.started",
    title: "任务已开始",
    summary: "已接收任务。",
    status: "planning",
    timestamp: "2026-05-11T00:00:00.000Z",
    refs: [],
    visibility: "compact",
  });
  const running = hub.publish({
    id: "event-2",
    runId: "run-1",
    type: "tool.completed",
    title: "已读取上下文",
    summary: "README.md · 12 bytes",
    status: "running",
    timestamp: "2026-05-11T00:00:01.000Z",
    refs: [],
    visibility: "expanded",
  });
  const duplicate = hub.publish({
    id: "event-2",
    runId: "run-1",
    type: "tool.completed",
    title: "重复事件",
    status: "failed",
    timestamp: "2026-05-11T00:00:02.000Z",
    refs: [],
    visibility: "debug",
  });

  assert.equal(started.sequence, 1);
  assert.equal(running.sequence, 2);
  assert.equal(duplicate.title, "已读取上下文");
  assert.deepEqual(hub.cursor("run-1"), { runId: "run-1", lastSequence: 2, eventCount: 2 });
  assert.deepEqual(hub.replay("run-1", 1).events.map((event) => event.id), ["event-2"]);
  assert.equal(hub.status("run-1"), "running");
});

test("BasicAgentRunEventHub keeps run streams isolated", () => {
  const hub = new BasicAgentRunEventHub();

  hub.publish({
    id: "event-a",
    runId: "run-a",
    type: "run.completed",
    title: "完成",
    status: "completed",
    timestamp: "2026-05-11T00:00:00.000Z",
    refs: [],
    visibility: "compact",
  });
  hub.publish({
    id: "event-b",
    runId: "run-b",
    type: "run.failed",
    title: "失败",
    status: "failed",
    timestamp: "2026-05-11T00:00:00.000Z",
    refs: [],
    visibility: "compact",
  });

  assert.deepEqual(hub.replay("run-a").events.map((event) => event.id), ["event-a"]);
  assert.deepEqual(hub.replay("run-b").events.map((event) => event.id), ["event-b"]);
  assert.equal(hub.status("run-a"), "completed");
  assert.equal(hub.status("run-b"), "failed");
});
