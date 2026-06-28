import assert from "node:assert/strict";
import test from "node:test";
import { AppRunEventHub } from "./event-stream.js";

type TestRunEvent = {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: string;
  readonly value?: string;
};

test("AppRunEventHub deduplicates event ids within one run", () => {
  const hub = new AppRunEventHub<TestRunEvent>();

  const first = hub.publish({ id: "event-1", runId: "run-1", type: "started" });
  const second = hub.publish({ id: "event-2", runId: "run-1", type: "running" });
  const duplicate = hub.publish({ id: "event-2", runId: "run-1", type: "duplicate" });

  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.equal(duplicate.type, "running");
  assert.deepEqual(hub.replay("run-1").events.map((event) => event.type), ["started", "running"]);
});

test("AppRunEventHub replaces existing events and keeps sequence order", () => {
  const hub = new AppRunEventHub<TestRunEvent>();

  const first = hub.publish({ id: "event-1", runId: "run-1", type: "first" });
  hub.publish({ id: "event-2", runId: "run-1", type: "second" });
  hub.replace({ ...first, sequence: 3, value: "replaced" });
  const third = hub.publish({ id: "event-3", runId: "run-1", type: "third" });

  assert.equal(third.sequence, 4);
  assert.deepEqual(hub.cursor("run-1"), { runId: "run-1", lastSequence: 4, eventCount: 3 });
  assert.deepEqual(hub.replay("run-1").events.map((event) => event.id), ["event-2", "event-1", "event-3"]);
  assert.equal(hub.replay("run-1").events[1]?.value, "replaced");
});

test("AppRunEventHub isolates streams by runId", () => {
  const hub = new AppRunEventHub<TestRunEvent>();

  hub.publish({ id: "shared-event", runId: "run-a", type: "a-started" });
  hub.publish({ id: "shared-event", runId: "run-b", type: "b-started" });
  hub.publish({ id: "event-a-2", runId: "run-a", type: "a-running" });

  assert.deepEqual(hub.replay("run-a").events.map((event) => event.type), ["a-started", "a-running"]);
  assert.deepEqual(hub.replay("run-b").events.map((event) => event.type), ["b-started"]);
  assert.deepEqual(hub.cursor("run-a"), { runId: "run-a", lastSequence: 2, eventCount: 2 });
  assert.deepEqual(hub.cursor("run-b"), { runId: "run-b", lastSequence: 1, eventCount: 1 });
});

test("AppRunEventHub replays incrementally from cursors", () => {
  const hub = new AppRunEventHub<TestRunEvent>();

  hub.publish({ id: "event-1", runId: "run-1", type: "started", sequence: 10 });
  hub.publish({ id: "event-2", runId: "run-1", type: "running" });
  hub.publish({ id: "event-3", runId: "run-1", type: "completed" });

  assert.deepEqual(hub.cursor("missing-run"), { runId: "missing-run", lastSequence: 0, eventCount: 0 });
  assert.deepEqual(hub.replay("missing-run").events, []);
  assert.deepEqual(hub.all("missing-run"), []);
  assert.deepEqual(hub.cursor("run-1"), { runId: "run-1", lastSequence: 12, eventCount: 3 });
  assert.deepEqual(hub.replay("run-1", 10).events.map((event) => event.id), ["event-2", "event-3"]);
  assert.deepEqual(hub.all("run-1").map((event) => event.id), ["event-1", "event-2", "event-3"]);
});
