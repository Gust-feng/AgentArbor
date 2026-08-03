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
    message: "continue",
  });
  assert.equal(submitted?.submissionId, "mobile-command-1");
  assert.equal(application.result.status, "applied");
  assert.deepEqual(application.snapshots.map((snapshot) => snapshot.kind), ["conversation.snapshot", "run.snapshot"]);
});

test("remote command handler exposes CAS conflicts without applying a guessed merge", async () => {
  const ports = fakePorts();
  ports.notebooks.replace = async () => {
    throw new RemoteCommandConflict("note_version_conflict", "The notebook changed on desktop");
  };
  const application = await createRemoteCommandHandler({ ports, idFactory: () => "event-conflict" }).apply({
    kind: "note.replace",
    commandId: "note-command",
    notebookId: "notebook-1",
    expectedVersion: `sha256:${"a".repeat(64)}`,
    content: "mobile text",
  });
  assert.equal(application.result.status, "conflict");
  assert.equal(application.result.error?.code, "note_version_conflict");
  assert.deepEqual(application.snapshots, []);
});

test("remote command handler projects Ordinary live deltas and durable state snapshots", async () => {
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
  emit?.({ kind: "state_changed", sequence: 2 });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(events.map((event) => event.kind), ["run.delta", "run.snapshot"]);
  assert.equal(events[0]?.kind === "run.delta" ? events[0].delta : undefined, "partial");
});

function fakePorts(): RemoteCommandHandlerPorts {
  const conversationSnapshot = {
    kind: "conversation.snapshot" as const,
    eventId: "conversation-event",
    conversationId: "conversation-1",
    title: "Conversation",
    updatedAt: "2026-08-03T00:00:00.000Z",
    turns: [],
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
  const spaceSnapshot = { kind: "space.snapshot" as const, eventId: "space-event", spaces: [] };
  const notebookSnapshot = { kind: "notebook.snapshot" as const, eventId: "notebook-event", notebooks: [] };
  return {
    ordinary: {
      async submit() { return { conversationId: "conversation-1", runId: "run-1" }; },
      async cancel() {},
      async decide() {},
      async conversationSnapshot() { return conversationSnapshot; },
      async runSnapshot() { return runSnapshot; },
      async allConversationSnapshots() { return [conversationSnapshot]; },
      subscribe() { return () => undefined; },
    },
    spaces: {
      async create() {},
      async addReference() {},
      async snapshot() { return spaceSnapshot; },
    },
    notebooks: {
      async replace() {},
      async snapshot() { return notebookSnapshot; },
    },
    assets: {
      async replaceText() {},
      async snapshot() { return { kind: "asset.snapshot", eventId: "asset-event", assets: [] }; },
    },
    managedFiles: {
      async replaceText() {},
      async createText() {},
      async snapshot() { return { kind: "managed_folder.snapshot", eventId: "folder-event", folders: [] }; },
    },
  };
}
