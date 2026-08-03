import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { WebSocket } from "ws";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import {
  REMOTE_COLLABORATION_PROTOCOL_VERSION,
  remoteServerFrameSchema,
  type RemoteServerFrame,
} from "./protocol.js";
import { createRemoteCollaborationFeature } from "./desktop-feature.js";
import { createRemoteDesktopStore } from "./desktop-store.js";
import { startRemoteRelayServer } from "./relay-server.js";
import { createRemoteRelayStore } from "./relay-store.js";

test("desktop connector applies a mobile command once and returns result and snapshot", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-remote-desktop-"));
  const relayDatabase = new SqliteRuntimeDatabase(path.join(root, "relay.sqlite"));
  const desktopDatabase = new SqliteRuntimeDatabase(path.join(root, "desktop.sqlite"));
  const relayStore = createRemoteRelayStore({ database: relayDatabase, codeFactory: () => "135790" });
  const relay = await startRemoteRelayServer({ store: relayStore, port: 0 });
  const desktopStore = createRemoteDesktopStore(desktopDatabase);
  t.after(async () => {
    await relay.close();
    relayDatabase.close();
    desktopDatabase.close();
    await rm(root, { recursive: true, force: true });
  });

  const desktop = relayStore.createPairing("Desktop");
  const mobile = relayStore.joinPairing(desktop.pairingCode, "Phone");
  relayStore.confirmPairing(desktop.pairingId, desktop.claimSecret, desktop.pairingCode);
  relayStore.confirmPairing(mobile.pairingId, mobile.claimSecret, mobile.pairingCode);
  const desktopToken = relayStore.issueDeviceToken(desktop.pairingId, desktop.claimSecret).accessToken;
  relayStore.issueDeviceToken(mobile.pairingId, mobile.claimSecret);
  desktopStore.saveBinding({
    relayUrl: relay.url,
    deviceId: desktop.deviceId,
    peerDeviceId: mobile.deviceId,
    peerDeviceName: mobile.deviceName,
    lastInboxSequence: 0,
    updatedAt: "2026-08-03T00:00:00.000Z",
  });

  let applied = 0;
  let deleted = false;
  const feature = createRemoteCollaborationFeature({
    store: desktopStore,
    credentials: {
      async readSecret() { return desktopToken; },
      async writeSecret() {},
      async deleteSecret() { deleted = true; },
    },
    commandHandler: {
      async apply(command) {
        applied += 1;
        return {
          result: {
            kind: "command.result",
            eventId: `result-${applied}`,
            commandId: command.commandId,
            status: "applied",
          },
          snapshots: [{ kind: "space.snapshot", eventId: `space-${applied}`, spaces: [] }],
        };
      },
    },
    now: () => "2026-08-03T00:00:00.000Z",
  });
  t.after(() => feature.release());

  await feature.commands.connect();
  const mobileSocket = await connect(relay.websocketUrl, relayStore.issueDeviceToken(mobile.pairingId, mobile.claimSecret).accessToken);
  t.after(() => mobileSocket.close());

  const firstResult = waitForFrame(mobileSocket, isCommandResult);
  const firstSnapshot = waitForFrame(mobileSocket, isSpaceSnapshot);
  mobileSocket.send(JSON.stringify({
    protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
    type: "message.submit",
    clientMessageId: "mobile-message-1",
    content: {
      type: "command",
      command: { kind: "space.create", commandId: "mobile-command-1", spaceId: "space-1", title: "Phone space" },
    },
  }));
  await Promise.all([firstResult, firstSnapshot]);
  assert.equal(applied, 1);
  assert.equal(desktopStore.pendingOutbox().length, 0);

  const duplicateResult = waitForFrame(mobileSocket, isCommandResult);
  mobileSocket.send(JSON.stringify({
    protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
    type: "message.submit",
    clientMessageId: "mobile-message-1",
    content: {
      type: "command",
      command: { kind: "space.create", commandId: "mobile-command-1", spaceId: "space-1", title: "Phone space" },
    },
  }));
  await duplicateResult;
  assert.equal(applied, 1);

  await feature.commands.forgetDevice();
  assert.equal(deleted, true);
  assert.equal(desktopStore.getBinding(), undefined);
  assert.throws(() => relayStore.authenticate(desktopToken));
});

async function connect(url: string, token: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const ready = waitForFrame(socket, (frame) => frame.type === "server.ready");
  socket.send(JSON.stringify({
    protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
    type: "client.hello",
    token,
    cursor: 0,
  }));
  await ready;
  return socket;
}

function waitForFrame(socket: WebSocket, predicate: (frame: RemoteServerFrame) => boolean): Promise<RemoteServerFrame> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for Relay frame"));
    }, 5_000);
    const onMessage = (raw: WebSocket.RawData) => {
      const frame = remoteServerFrameSchema.parse(JSON.parse(raw.toString()) as unknown);
      if (!predicate(frame)) return;
      cleanup();
      resolve(frame);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Relay socket closed before the expected frame"));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("close", onClose);
    };
    socket.on("message", onMessage);
    socket.once("close", onClose);
  });
}

function isCommandResult(frame: RemoteServerFrame): boolean {
  return frame.type === "message.deliver" && frame.message.content.type === "event"
    && frame.message.content.event.kind === "command.result";
}

function isSpaceSnapshot(frame: RemoteServerFrame): boolean {
  return frame.type === "message.deliver" && frame.message.content.type === "event"
    && frame.message.content.event.kind === "space.snapshot";
}
