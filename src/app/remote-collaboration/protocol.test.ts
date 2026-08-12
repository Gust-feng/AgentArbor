import assert from "node:assert/strict";
import test from "node:test";

import {
  REMOTE_COLLABORATION_PROTOCOL_VERSION,
  parseRemoteClientFrame,
  parseRemoteMessageContent,
} from "./protocol.js";

test("remote protocol validates guidance decisions", () => {
  assert.doesNotThrow(() => parseRemoteMessageContent({
    type: "command",
    command: {
      kind: "confirmation.decide",
      commandId: "command-1",
      runId: "run-1",
      confirmationId: "confirmation-1",
      decision: "guidance",
      guidance: "只读取，不要修改",
    },
  }));
  assert.throws(() => parseRemoteMessageContent({
    type: "command",
    command: {
      kind: "confirmation.decide",
      commandId: "command-2",
      runId: "run-1",
      confirmationId: "confirmation-1",
      decision: "guidance",
    },
  }));
});

test("remote protocol requires an owner for a new conversation", () => {
  assert.throws(() => parseRemoteMessageContent({
    type: "command",
    command: {
      kind: "conversation.submit",
      commandId: "command-unowned",
      message: "create without an owner",
    },
  }));
  assert.doesNotThrow(() => parseRemoteMessageContent({
    type: "command",
    command: {
      kind: "conversation.submit",
      commandId: "command-space",
      message: "create in a Space",
      spaceId: "space-1",
    },
  }));
  assert.doesNotThrow(() => parseRemoteMessageContent({
    type: "command",
    command: {
      kind: "conversation.submit",
      commandId: "command-existing",
      conversationId: "conversation-1",
      message: "continue the owned conversation",
    },
  }));
});

test("remote protocol rejects content mutations and content snapshots", () => {
  for (const command of [
    { kind: "space.create", commandId: "legacy-space", spaceId: "space-1", title: "Legacy" },
    { kind: "note.replace", commandId: "legacy-note", notebookId: "global", expectedVersion: `sha256:${"a".repeat(64)}`, content: "Legacy" },
    { kind: "sync.snapshot.request", commandId: "legacy-snapshot" },
  ]) {
    assert.throws(() => parseRemoteMessageContent({ type: "command", command }), command.kind);
  }
  assert.throws(() => parseRemoteMessageContent({
    type: "event",
    event: { kind: "space.snapshot", eventId: "legacy-event", spaces: [] },
  }));
});

test("client hello carries only the device token", () => {
  const frame = parseRemoteClientFrame({
    protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
    type: "client.hello",
    token: "x".repeat(32),
  });
  assert.equal(frame.type, "client.hello");
  assert.deepEqual(Object.keys(frame).sort(), ["protocolVersion", "token", "type"]);
});
