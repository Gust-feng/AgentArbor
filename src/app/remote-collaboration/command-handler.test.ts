import assert from "node:assert/strict";
import test from "node:test";

import {
  createRemoteCommandHandler,
  RemoteCommandConflict,
  type RemoteCommandHandlerPorts,
} from "./command-handler.js";

test("remote command handler reuses command id as Ordinary submission id", async () => {
  let submitted: Parameters<RemoteCommandHandlerPorts["ordinary"]["submit"]>[0] | undefined;
  const ports = fakePorts();
  ports.ordinary.submit = async (input) => {
    submitted = input;
    return { conversationId: "conversation-1", runId: "run-1" };
  };
  const application = await createRemoteCommandHandler({ ports, idFactory: () => "event-1" }).apply({
    kind: "conversation.submit",
    commandId: "mobile-command-1",
    conversationId: "conversation-1",
    message: "continue",
  });
  assert.equal(submitted?.submissionId, "mobile-command-1");
  assert.equal(application.result.status, "applied");
  assert.deepEqual(application.result.entity, { conversationId: "conversation-1" });
  assert.deepEqual(application.snapshots.map((snapshot) => snapshot.kind), ["conversation.index", "conversation.page", "run.snapshot"]);
});

test("remote command handler forwards only the opaque model selection", async () => {
  let submitted: Parameters<RemoteCommandHandlerPorts["ordinary"]["submit"]>[0] | undefined;
  const ports = fakePorts();
  ports.ordinary.submit = async (input) => {
    submitted = input;
    return { conversationId: "conversation-1", runId: "run-1" };
  };
  await createRemoteCommandHandler({ ports, idFactory: () => "event-1" }).apply({
    kind: "conversation.submit",
    commandId: "mobile-command-model",
    conversationId: "conversation-1",
    message: "continue",
    modelSelectionId: '["profile-1","model-1"]',
  });
  assert.equal(submitted?.modelSelectionId, '["profile-1","model-1"]');
  assert.equal(JSON.stringify(submitted).includes("apiKey"), false);
  assert.equal(JSON.stringify(submitted).includes("baseUrl"), false);
});

test("remote command handler exposes Ordinary cursor conflicts without guessing", async () => {
  const ports = fakePorts();
  ports.ordinary.conversationPage = async () => {
    throw new RemoteCommandConflict("conversation_cursor_invalid", "The conversation cursor is unavailable");
  };
  const application = await createRemoteCommandHandler({ ports, idFactory: () => "event-conflict" }).apply({
    kind: "conversation.page.request",
    commandId: "page-command",
    conversationId: "conversation-1",
  });
  assert.equal(application.result.status, "conflict");
  assert.equal(application.result.error?.code, "conversation_cursor_invalid");
  assert.deepEqual(application.snapshots, []);
});

test("remote command handler batches Ordinary live deltas before a durable state snapshot", async () => {
  const ports = fakePorts();
  let emit: Parameters<RemoteCommandHandlerPorts["ordinary"]["subscribe"]>[1] | undefined;
  ports.ordinary.subscribe = (_runId, listener) => {
    emit = listener;
    return () => undefined;
  };
  const events: import("./protocol.js").RemoteEvent[] = [];
  const handler = createRemoteCommandHandler({ ports, idFactory: () => `event-${events.length + 1}` });
  handler.watchRun("run-1", (next) => events.push(...next));

  emit?.({ kind: "text_delta", sequence: 1, delta: "partial" });
  emit?.({ kind: "text_delta", sequence: 2, delta: " answer" });
  emit?.({ kind: "state_changed", sequence: 3 });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(events.map((event) => event.kind), ["run.delta", "run.snapshot"]);
  assert.equal(events[0]?.kind === "run.delta" ? events[0].delta : undefined, "partial answer");
  assert.equal(events[0]?.kind === "run.delta" ? events[0].activitySequence : undefined, 2);
});

function fakePorts(): RemoteCommandHandlerPorts {
  const conversationIndex = {
    kind: "conversation.index" as const,
    eventId: "conversation-index-event",
    conversations: [{
      conversationId: "conversation-1",
      title: "Conversation",
      updatedAt: "2026-08-03T00:00:00.000Z",
      status: "running" as const,
      activeRunId: "run-1",
    }],
  };
  const conversationPage = {
    kind: "conversation.page" as const,
    eventId: "conversation-page-event",
    conversationId: "conversation-1",
    turns: [],
    hasMore: false,
  };
  const runSnapshot = {
    kind: "run.snapshot" as const,
    eventId: "run-event",
    runId: "run-1",
    conversationId: "conversation-1",
    status: "running" as const,
    pendingConfirmations: [],
    updatedAt: "2026-08-03T00:00:00.000Z",
  };
  return {
    ordinary: {
      async submit() { return { conversationId: "conversation-1", runId: "run-1" }; },
      async cancel() {},
      async decide() {},
      async conversationIndex() { return conversationIndex; },
      async conversationPage() { return conversationPage; },
      async runSnapshot() { return runSnapshot; },
      subscribe() { return () => undefined; },
    },
  };
}
