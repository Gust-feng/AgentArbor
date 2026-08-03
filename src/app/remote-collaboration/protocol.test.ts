import assert from "node:assert/strict";
import test from "node:test";

import {
  REMOTE_COLLABORATION_PROTOCOL_VERSION,
  parseRemoteClientFrame,
  parseRemoteMessageContent,
  parseRemoteSyncSnapshot,
} from "./protocol.js";

test("remote protocol accepts mobile commands and requires guidance text", () => {
  const valid = parseRemoteMessageContent({
    type: "command",
    command: {
      kind: "confirmation.decide",
      commandId: "command-1",
      runId: "run-1",
      confirmationId: "confirmation-1",
      decision: "guidance",
      guidance: "只读取，不要修改",
    },
  });
  assert.equal(valid.type, "command");
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

test("remote protocol rejects external and escaping managed paths", () => {
  const base = {
    type: "command",
    command: {
      kind: "managed_file.replace_text",
      commandId: "command-file",
      referenceId: "managed-reference",
      expectedFingerprint: `sha256:${"a".repeat(64)}`,
      text: "content",
    },
  };
  for (const relativePath of ["C:\\Users\\me\\secret.txt", "/etc/passwd", "../secret.txt", "folder//file.txt"]) {
    assert.throws(() => parseRemoteMessageContent({
      ...base,
      command: { ...base.command, relativePath },
    }), relativePath);
  }
  const parsed = parseRemoteMessageContent({
    ...base,
    command: { ...base.command, relativePath: "notes/today.md" },
  });
  assert.equal(parsed.type, "command");
});

test("remote protocol exposes only the syncable Space reference whitelist", () => {
  assert.throws(() => parseRemoteMessageContent({
    type: "command",
    command: {
      kind: "space.reference.add",
      commandId: "command-ref",
      referenceId: "reference-1",
      spaceId: "space-1",
      title: "Local workspace",
      reference: { kind: "workspace_folder", path: "C:\\workspace" },
    },
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

test("durable synchronization rejects conversation and command bodies", () => {
  assert.throws(() => parseRemoteSyncSnapshot({
    kind: "conversation.snapshot",
    eventId: "conversation-event",
    conversationId: "conversation-1",
    title: "Private",
    updatedAt: "2026-08-03T00:00:00.000Z",
    turns: [],
  }));
  assert.doesNotThrow(() => parseRemoteSyncSnapshot({
    kind: "space.snapshot",
    eventId: "space-event",
    spaces: [],
  }));
});

test("paged content snapshots require valid page metadata and UTF-8 byte limits", () => {
  const base = {
    kind: "asset.snapshot",
    eventId: "asset-event",
    snapshotId: "asset-snapshot",
    pageIndex: 0,
    pageCount: 1,
    assets: [],
  };
  assert.doesNotThrow(() => parseRemoteSyncSnapshot(base));
  assert.throws(() => parseRemoteSyncSnapshot({ ...base, pageIndex: 1 }));

  assert.throws(() => parseRemoteMessageContent({
    type: "command",
    command: {
      kind: "asset.replace_text",
      commandId: "asset-command",
      assetId: "asset-1",
      expectedFingerprint: `sha256:${"a".repeat(64)}`,
      text: "中".repeat(200_000),
    },
  }));
});
