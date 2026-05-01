import assert from "node:assert/strict";
import test from "node:test";
import { createMinimalRuntime } from "../../app/runtime.js";
import { createMessage } from "./create-message.js";
import { MessageBusPolicyError } from "./in-memory-message-bus.js";

test("message bus blocks direct private messages between internal agents", () => {
  const runtime = createMinimalRuntime();

  assert.throws(
    () =>
      runtime.bus.publish(
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
