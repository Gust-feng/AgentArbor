import assert from "node:assert/strict";
import test from "node:test";

import {
  REMOTE_COLLABORATION_PROTOCOL_VERSION,
  parseRemoteClientFrame,
  parseRemoteMessageContent,
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

test("client hello carries a durable cursor", () => {
  const frame = parseRemoteClientFrame({
    protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
    type: "client.hello",
    token: "x".repeat(32),
    cursor: 41,
  });
  assert.equal(frame.type, "client.hello");
  assert.equal(frame.cursor, 41);
});
