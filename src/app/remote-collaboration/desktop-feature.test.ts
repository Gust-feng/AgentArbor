import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WebSocket } from "ws";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import { createRemoteCollaborationFeature } from "./desktop-feature.js";
import { createRemoteDesktopStore } from "./desktop-store.js";
import {
  REMOTE_COLLABORATION_PROTOCOL_VERSION,
  remoteServerFrameSchema,
  type RemoteEvent,
  type RemoteServerFrame,
} from "./protocol.js";
import { startRemoteRelayServer } from "./relay-server.js";
import { createRemoteRelayStore } from "./relay-store.js";

test("unregistered desktop exposes the host username as the optional device-name default", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-remote-device-name-"));
  const database = new SqliteRuntimeDatabase(path.join(root, "desktop.sqlite"));
  const feature = createRemoteCollaborationFeature({
    store: createRemoteDesktopStore(database),
    credentials: {
      async readSecret() { return undefined; },
      async writeSecret() {},
      async deleteSecret() {},
    },
    commandHandler: {
      async apply(command) {
        return {
          result: { kind: "command.result", eventId: `${command.commandId}-result`, commandId: command.commandId, status: "applied" },
          snapshots: [],
        };
      },
      watchRun() { return () => undefined; },
      async snapshotsForRun() { return []; },
      async connectionSnapshot() { return []; },
    },
    defaultDeviceName: "feng",
  });
  t.after(async () => {
    await feature.release();
    database.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  assert.deepEqual(feature.queries.status(), {
    state: "unregistered",
    peerOnline: false,
    suggestedDeviceName: "feng",
  });
});

test("approving a phone automatically starts the desktop Relay connection", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-remote-pair-connect-"));
  const relayDatabase = new SqliteRuntimeDatabase(path.join(root, "relay.sqlite"));
  const desktopDatabase = new SqliteRuntimeDatabase(path.join(root, "desktop.sqlite"));
  const relayStore = createRemoteRelayStore({ database: relayDatabase, allowOpenSignup: true });
  const relay = await startRemoteRelayServer({ store: relayStore, port: 0 });
  let credential: string | undefined;
  const feature = createRemoteCollaborationFeature({
    store: createRemoteDesktopStore(desktopDatabase),
    credentials: {
      async readSecret() { return credential; },
      async writeSecret(_reference, value) { credential = value; },
      async deleteSecret() { credential = undefined; },
    },
    commandHandler: {
      async apply(command) {
        return {
          result: { kind: "command.result", eventId: `${command.commandId}-result`, commandId: command.commandId, status: "applied" },
          snapshots: [],
        };
      },
      watchRun() { return () => undefined; },
      async snapshotsForRun() { return []; },
      async connectionSnapshot() { return []; },
    },
  });
  t.after(async () => {
    await feature.release();
    await relay.close();
    desktopDatabase.close();
    relayDatabase.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  await feature.commands.activateAccount(relay.url, "Desktop");
  const pairing = await feature.commands.beginPairing();
  const mobile = relayStore.joinPairing(pairing.pairingCode, "Phone");
  await feature.commands.inspectPairing();
  await feature.commands.approvePairing();

  await waitFor(() => feature.queries.status().state === "connected");
  assert.equal(feature.queries.status().peerDeviceId, mobile.deviceId);
});

test("feature start with a persisted binding connects to the Relay automatically", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-remote-autostart-"));
  const relayDatabase = new SqliteRuntimeDatabase(path.join(root, "relay.sqlite"));
  const desktopDatabase = new SqliteRuntimeDatabase(path.join(root, "desktop.sqlite"));
  const relayStore = createRemoteRelayStore({ database: relayDatabase, allowOpenSignup: true });
  const relay = await startRemoteRelayServer({ store: relayStore, port: 0 });
  const activation = relayStore.activateAccount("Desktop");

  // 模拟应用重启：绑定已持久化，新的 feature 实例只调用 start()。
  const store = createRemoteDesktopStore(desktopDatabase);
  store.saveBinding({
    relayUrl: relay.url,
    accountId: activation.account.accountId,
    accountHandle: activation.account.handle,
    displayName: activation.account.displayName,
    deviceId: activation.deviceId,
    deviceName: activation.deviceName,
    updatedAt: "2026-08-13T00:00:00.000Z",
  });
  const feature = createRemoteCollaborationFeature({
    store,
    credentials: {
      async readSecret() { return activation.accessToken; },
      async writeSecret() {},
      async deleteSecret() {},
    },
    commandHandler: {
      async apply(command) {
        return {
          result: { kind: "command.result", eventId: `${command.commandId}-result`, commandId: command.commandId, status: "applied" },
          snapshots: [],
        };
      },
      watchRun() { return () => undefined; },
      async snapshotsForRun() { return []; },
      async connectionSnapshot() { return []; },
    },
  });
  t.after(async () => {
    await feature.release();
    await relay.close();
    desktopDatabase.close();
    relayDatabase.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  await feature.start();
  await waitFor(() => feature.queries.status().state === "connected");
});

test("feature start without a binding stays unregistered and opens no connection", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-remote-autostart-none-"));
  const database = new SqliteRuntimeDatabase(path.join(root, "desktop.sqlite"));
  const feature = createRemoteCollaborationFeature({
    store: createRemoteDesktopStore(database),
    credentials: {
      async readSecret() { return undefined; },
      async writeSecret() {},
      async deleteSecret() {},
    },
    commandHandler: {
      async apply(command) {
        return {
          result: { kind: "command.result", eventId: `${command.commandId}-result`, commandId: command.commandId, status: "applied" },
          snapshots: [],
        };
      },
      watchRun() { return () => undefined; },
      async snapshotsForRun() { return []; },
      async connectionSnapshot() { return []; },
    },
  });
  t.after(async () => {
    await feature.release();
    database.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  await feature.start();
  assert.equal(feature.queries.status().state, "unregistered");
});

test("desktop connector applies a retried mobile command once and can revoke the phone", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-remote-desktop-"));
  const relayDatabase = new SqliteRuntimeDatabase(path.join(root, "relay.sqlite"));
  const desktopDatabase = new SqliteRuntimeDatabase(path.join(root, "desktop.sqlite"));
  const relayStore = createRemoteRelayStore({ database: relayDatabase, codeFactory: () => "135790", allowOpenSignup: true });
  let notifyVault: ((event: { accountId: string; sourceDeviceId: string; cursor: number }) => void) | undefined;
  const relay = await startRemoteRelayServer({
    store: relayStore,
    contentVault: {
      async handle() { return false; },
      subscribe(listener) { notifyVault = listener; return () => { notifyVault = undefined; }; },
    },
    port: 0,
  });
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
  let notifiedVaultCursor = 0;
  const feature = createRemoteCollaborationFeature({
    store,
    credentials: {
      async readSecret() { return activation.accessToken; },
      async writeSecret() {},
      async deleteSecret() { deleted = true; },
    },
    commandHandler: {
      async apply(command) {
        if (command.kind === "conversation.page.request") applied += 1;
        return {
          result: { kind: "command.result", eventId: `${command.commandId}-result`, commandId: command.commandId, status: "applied" },
          snapshots: [],
        };
      },
      watchRun() { return () => undefined; },
      async snapshotsForRun() { return []; },
      async connectionSnapshot() { return []; },
    },
    onVaultChanged(cursor) { notifiedVaultCursor = cursor; },
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
  notifyVault?.({
    accountId: activation.account.accountId,
    sourceDeviceId: mobile.deviceId,
    cursor: 12,
  });
  await waitFor(() => notifiedVaultCursor === 12);

  const command = {
    protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
    type: "message.submit",
    clientMessageId: "mobile-message-1",
    content: {
      type: "command",
      command: { kind: "conversation.page.request", commandId: "mobile-command-1", conversationId: "conversation-1" },
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

test("desktop sends run deltas live-only without retaining them in the reliable outbox", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-remote-live-delta-"));
  const relayDatabase = new SqliteRuntimeDatabase(path.join(root, "relay.sqlite"));
  const desktopDatabase = new SqliteRuntimeDatabase(path.join(root, "desktop.sqlite"));
  const relayStore = createRemoteRelayStore({ database: relayDatabase, codeFactory: () => "246810", allowOpenSignup: true });
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
  let emitRun: ((events: readonly RemoteEvent[]) => void) | undefined;
  const feature = createRemoteCollaborationFeature({
    store,
    credentials: {
      async readSecret() { return activation.accessToken; },
      async writeSecret() {},
      async deleteSecret() {},
    },
    commandHandler: {
      async apply(command) {
        return {
          result: { kind: "command.result", eventId: `${command.commandId}-result`, commandId: command.commandId, status: "applied" },
          snapshots: [],
        };
      },
      watchRun(_runId, listener) {
        emitRun = listener;
        return () => undefined;
      },
      async snapshotsForRun() { return []; },
      async connectionSnapshot() { return []; },
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
  await feature.commands.publishRun("run-1");

  const delivery = waitForFrame(mobileSocket, (frame) => frame.type === "message.deliver"
    && frame.message.content.type === "event"
    && frame.message.content.event.kind === "run.delta");
  emitRun?.([{
    kind: "run.delta",
    eventId: "delta-event-1",
    runId: "run-1",
    activitySequence: 1,
    delta: "batched answer",
  }]);

  const frame = await delivery;
  assert.equal(frame.type === "message.deliver" && frame.message.clientMessageId, "delta-event-1");
  assert.deepEqual(store.pendingOutbox(), []);
  if (frame.type === "message.deliver") {
    mobileSocket.send(JSON.stringify({
      protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
      type: "message.received",
      messageId: frame.message.messageId,
    }));
  }
});

test("desktop applies mobile commands in websocket receive order", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-remote-command-order-"));
  const relayDatabase = new SqliteRuntimeDatabase(path.join(root, "relay.sqlite"));
  const desktopDatabase = new SqliteRuntimeDatabase(path.join(root, "desktop.sqlite"));
  const relayStore = createRemoteRelayStore({ database: relayDatabase, codeFactory: () => "864209", allowOpenSignup: true });
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

  const applied: string[] = [];
  let releaseFirst: (() => void) | undefined;
  let markFirstEntered: (() => void) | undefined;
  let markSecondEntered: (() => void) | undefined;
  const firstEntered = new Promise<void>((resolve) => { markFirstEntered = resolve; });
  const secondEntered = new Promise<void>((resolve) => { markSecondEntered = resolve; });
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const feature = createRemoteCollaborationFeature({
    store,
    credentials: {
      async readSecret() { return activation.accessToken; },
      async writeSecret() {},
      async deleteSecret() {},
    },
    commandHandler: {
      async apply(command) {
        applied.push(command.commandId);
        if (command.commandId === "ordered-command-1") {
          markFirstEntered?.();
          await firstGate;
        } else if (command.commandId === "ordered-command-2") {
          markSecondEntered?.();
        }
        return {
          result: { kind: "command.result", eventId: `${command.commandId}-result`, commandId: command.commandId, status: "applied" },
          snapshots: [],
        };
      },
      watchRun() { return () => undefined; },
      async snapshotsForRun() { return []; },
      async connectionSnapshot() { return []; },
    },
  });
  t.after(async () => {
    releaseFirst?.();
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

  const commandFrame = (ordinal: number) => JSON.stringify({
    protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
    type: "message.submit",
    clientMessageId: `ordered-message-${ordinal}`,
    content: {
      type: "command",
      command: {
        kind: "conversation.page.request",
        commandId: `ordered-command-${ordinal}`,
        conversationId: `conversation-${ordinal}`,
      },
    },
  });
  mobileSocket.send(commandFrame(1));
  mobileSocket.send(commandFrame(2));

  await firstEntered;
  const secondStartedEarly = await Promise.race([
    secondEntered.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
  ]);
  assert.equal(secondStartedEarly, false);
  assert.deepEqual(applied, ["ordered-command-1"]);

  releaseFirst?.();
  await secondEntered;
  assert.deepEqual(applied, ["ordered-command-1", "ordered-command-2"]);
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
