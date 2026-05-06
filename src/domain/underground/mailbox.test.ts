import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryMailbox } from "./index.js";

type NestedPayloadMessage = {
  readonly payload: {
    readonly nested: {
      value: string;
    };
  };
};

test("Mailbox routes messages to addressed agents without cross-agent leakage", () => {
  const mailbox = new InMemoryMailbox();
  mailbox.route({
    id: "message-a",
    traceId: "trace-mailbox",
    fromAgentId: "upstream",
    toAgentId: "agent-a",
    type: "goal.received",
    payload: { goalId: "goal-a" },
    createdAt: "2026-05-06T00:00:00.000Z",
  });
  mailbox.route({
    id: "message-b",
    traceId: "trace-mailbox",
    fromAgentId: "upstream",
    toAgentId: "agent-b",
    type: "candidate_pool.updated",
    payload: { poolId: "pool-b" },
    createdAt: "2026-05-06T00:00:01.000Z",
  });

  assert.equal(mailbox.pending("agent-a"), 1);
  assert.equal(mailbox.pending("agent-b"), 1);
  assert.equal(mailbox.pending("agent-c"), 0);
  assert.deepEqual(mailbox.drain("agent-a").map((message) => message.id), ["message-a"]);
  assert.deepEqual(mailbox.drain("agent-b").map((message) => message.id), ["message-b"]);
});

test("Mailbox can drain only one routed message type and leave the rest queued", () => {
  const mailbox = new InMemoryMailbox();
  mailbox.route({
    id: "goal-message",
    traceId: "trace-mailbox-type",
    fromAgentId: "upstream",
    toAgentId: "agent-a",
    type: "goal.received",
    payload: {},
    createdAt: "2026-05-06T00:00:00.000Z",
  });
  mailbox.route({
    id: "pool-message",
    traceId: "trace-mailbox-type",
    fromAgentId: "upstream",
    toAgentId: "agent-a",
    type: "candidate_pool.updated",
    payload: {},
    createdAt: "2026-05-06T00:00:01.000Z",
  });

  assert.deepEqual(mailbox.drainByType("agent-a", "goal.received").map((message) => message.id), [
    "goal-message",
  ]);
  assert.deepEqual(mailbox.drain("agent-a").map((message) => message.id), ["pool-message"]);
});

test("Mailbox snapshots routed messages so callers cannot mutate queued payloads", () => {
  const mailbox = new InMemoryMailbox();
  const payload = { nested: { value: "original" } };
  mailbox.route({
    id: "immutable-message",
    traceId: "trace-mailbox-immutable",
    fromAgentId: "upstream",
    toAgentId: "agent-a",
    type: "goal.received",
    payload,
    createdAt: "2026-05-06T00:00:00.000Z",
  });

  payload.nested.value = "mutated before drain";
  const [peeked] = mailbox.peek("agent-a") as readonly NestedPayloadMessage[];
  peeked.payload.nested.value = "mutated through peek";

  const [drained] = mailbox.drain("agent-a") as readonly NestedPayloadMessage[];
  assert.equal(drained.payload.nested.value, "original");
});
