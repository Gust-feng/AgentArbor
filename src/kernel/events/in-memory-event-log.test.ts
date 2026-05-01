import assert from "node:assert/strict";
import test from "node:test";
import type { ArborMessage } from "../../domain/contracts.js";
import { createMessage } from "../messages/create-message.js";
import { InMemoryEventLog, type EventLogEntry } from "./in-memory-event-log.js";

type MutablePayload = {
  nested: {
    count: number;
    labels: string[];
  };
};

test("EventLog list and replay do not expose mutable internal message facts", () => {
  const eventLog = new InMemoryEventLog();
  const message = createMessage<MutablePayload>({
    traceId: "trace-eventlog",
    from: { id: "test-agent", role: "underground_center" },
    to: { group: "runtime" },
    type: "goal.received",
    intent: "test_event_log_fact_immutability",
    payload: {
      nested: {
        count: 1,
        labels: ["original"],
      },
    },
  });

  const appended = eventLog.append(message) as EventLogEntry<MutablePayload>;
  appended.message.payload.nested.count = 10;
  appended.message.payload.nested.labels.push("appended-mutated");

  const listed = eventLog.list() as EventLogEntry<MutablePayload>[];
  listed[0]?.message.payload.nested.labels.push("list-mutated");
  if (listed[0] !== undefined) {
    listed[0].message.payload.nested.count = 20;
  }

  const replayed = eventLog.replay() as ArborMessage<MutablePayload>[];
  replayed[0]?.payload.nested.labels.push("replay-mutated");
  if (replayed[0] !== undefined) {
    replayed[0].payload.nested.count = 30;
  }

  const storedAgain = eventLog.list() as EventLogEntry<MutablePayload>[];
  assert.equal(storedAgain[0]?.message.payload.nested.count, 1);
  assert.deepEqual(storedAgain[0]?.message.payload.nested.labels, ["original"]);
});
