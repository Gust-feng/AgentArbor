import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WebSocket } from "ws";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import { createRemoteCollaborationFeature } from "./desktop-feature.js";
import { createRemoteDesktopStore } from "./desktop-store.js";
import { REMOTE_COLLABORATION_PROTOCOL_VERSION, remoteServerFrameSchema, type RemoteServerFrame } from "./protocol.js";
import { startRemoteRelayServer } from "./relay-server.js";
import { createRemoteRelayStore } from "./relay-store.js";

test("desktop connector applies a retried mobile command once and can revoke the phone", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-remote-desktop-"));
  const relayDatabase = new SqliteRuntimeDatabase(path.join(root, "relay.sqlite"));
  const desktopDatabase = new SqliteRuntimeDatabase(path.join(root, "desktop.sqlite"));
  const relayStore = createRemoteRelayStore({ database: relayDatabase, codeFactory: () => "135790", allowOpenSignup: true });
  const relay = await startRemoteRelayServer({ store: relayStore, port: 0 });
  const activation = relayStore.activateAccount("Desktop");
  const pairing = relayStore.createPairingSession(activation.accessToken);
  const mobile = relayStore.joinPairing(pairing.pairingCode, "Phone");
  relayStore.approvePairing(activation.accessToken, pairing.pairingId, pairing.pairingCode);

  const store = createRemoteDesktopStore(desktopDatabase);
  store.saveBinding({
    relayUrl: relay.url,
    accountId: activation.account.accountId,
    accountHandle: activation.account.handle,
    displayName: activation.account.displayName,
    deviceId: activation.deviceId,
    deviceName: activation.deviceName,
    peerDeviceId: mobile.deviceId,
    peerDeviceName: mobile.deviceName,
    updatedAt: "2026-08-03T00:00:00.000Z",
  });
  let applied = 0;
  let deleted = false;
  const feature = createRemoteCollaborationFeature({
    store,
    credentials: {
      async readSecret() { return activation.accessToken; },
      async writeSecret() {},
      async deleteSecret() { deleted = true; },
    },
    commandHandler: {
      async apply(command) {
        if (command.kind === "space.create") applied += 1;
        return {
          result: { kind: "command.result", eventId: `${command.commandId}-result`, commandId: command.commandId, status: "applied" },
          snapshots: [],
        };
      },
      watchRun() { return () => undefined; },
      async snapshotsForRun() { return []; },
    },
  });
  t.after(async () => {
    await feature.release();
    await relay.close();
    desktopDatabase.close();
    relayDatabase.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  await feature.commands.connect();
  const mobileSocket = await connect(relay.websocketUrl, mobile.accessToken);
  t.after(() => mobileSocket.close());
  await waitFor(() => feature.queries.status().peerOnline);

  const command = {
    protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
    type: "message.submit",
    clientMessageId: "mobile-message-1",
    content: {
      type: "command",
      command: { kind: "space.create", commandId: "mobile-command-1", spaceId: "space-1", title: "Phone space" },
    },
  } as const;
  const firstResult = waitForFrame(mobileSocket, isCommandResult);
  mobileSocket.send(JSON.stringify(command));
  await acknowledgeDeliveries(mobileSocket, firstResult);
  assert.equal(applied, 1);

  const duplicateResult = waitForFrame(mobileSocket, isCommandResult);
  mobileSocket.send(JSON.stringify(command));
  await acknowledgeDeliveries(mobileSocket, duplicateResult);
  assert.equal(applied, 1);

  await feature.commands.revokePeerDevice();
  assert.equal(feature.queries.status().peerDeviceId, undefined);
  assert.throws(() => relayStore.authenticate(mobile.accessToken));
  assert.equal(deleted, false);
});

async function connect(url: string, token: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  const ready = waitForFrame(socket, (frame) => frame.type === "server.ready");
  socket.send(JSON.stringify({ protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION, type: "client.hello", token }));
  await ready;
  return socket;
}

async function acknowledgeDeliveries(socket: WebSocket, result: Promise<RemoteServerFrame>): Promise<void> {
  const onMessage = (raw: WebSocket.RawData) => {
    const frame = remoteServerFrameSchema.parse(JSON.parse(raw.toString()) as unknown);
    if (frame.type !== "message.deliver") return;
    socket.send(JSON.stringify({
      protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
      type: "message.received",
      messageId: frame.message.messageId,
    }));
  };
  socket.on("message", onMessage);
  try {
    await result;
  } finally {
    socket.off("message", onMessage);
  }
}

function waitForFrame(socket: WebSocket, predicate: (frame: RemoteServerFrame) => boolean): Promise<RemoteServerFrame> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for frame")), 5_000);
    const onMessage = (raw: WebSocket.RawData) => {
      const frame = remoteServerFrameSchema.parse(JSON.parse(raw.toString()) as unknown);
      if (!predicate(frame)) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(frame);
    };
    socket.on("message", onMessage);
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function isCommandResult(frame: RemoteServerFrame): boolean {
  return frame.type === "message.deliver" && frame.message.content.type === "event"
    && frame.message.content.event.kind === "command.result";
}
