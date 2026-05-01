import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryEventLog } from "../events/in-memory-event-log.js";
import { createMessage } from "./create-message.js";
import { InMemoryMessageBus, MessageBusPolicyError } from "./in-memory-message-bus.js";

test("message bus blocks direct private messages between internal agents", () => {
  const eventLog = new InMemoryEventLog();
  const bus = new InMemoryMessageBus(eventLog);

  assert.throws(
    () =>
      bus.publish(
        createMessage({
          traceId: "trace-test",
          from: { id: "aboveground-planner", role: "aboveground_center" },
          to: { id: "worker-agent" },
          type: "task.progress",
          intent: "private_chat",
          payload: {},
        })
      ),
    MessageBusPolicyError
  );
});
