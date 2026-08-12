import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WebSocket } from "ws";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import { REMOTE_COLLABORATION_PROTOCOL_VERSION, remoteServerFrameSchema, type RemoteServerFrame } from "./protocol.js";
import { startRemoteRelayServer } from "./relay-server.js";
import { createRemoteRelayStore } from "./relay-store.js";

test("relay exposes API-only account pairing and forwards content without persistence", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-relay-http-"));
  const database = new SqliteRuntimeDatabase(path.join(root, "relay.sqlite"));
  const relay = await startRemoteRelayServer({
    store: createRemoteRelayStore({ database, codeFactory: () => "246810", allowOpenSignup: true }),
    port: 0,
  });
  t.after(async () => {
    await relay.close();
    database.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  assert.equal((await fetch(relay.url)).status, 404);
  assert.equal((await fetch(`${relay.url}/health`)).status, 404);
  assert.equal((await fetch(`${relay.url}/v1/health`)).status, 200);

  const activation = (await post(relay.url, "/v1/accounts/activate", { deviceName: "Desktop" })).credential as DeviceCredential;
  const pairing = (await post(relay.url, "/v1/pairings", {}, activation.accessToken)).pairing as Pairing;
  const mobile = (await post(relay.url, "/v1/pairings/join", { pairingCode: pairing.pairingCode, deviceName: "Phone" })).pairing as MobileClaim;
  await post(relay.url, `/v1/pairings/${pairing.pairingId}/approve`, { pairingCode: pairing.pairingCode }, activation.accessToken);

  const desktopSocket = await connect(relay.websocketUrl, activation.accessToken);
  const mobileSocket = await connect(relay.websocketUrl, mobile.accessToken);
  t.after(() => {
    desktopSocket.close();
    mobileSocket.close();
  });

  const accepted = waitForFrame(mobileSocket, (frame) => frame.type === "message.accepted");
  const delivered = waitForFrame(desktopSocket, (frame) => frame.type === "message.deliver");
  const received = waitForFrame(mobileSocket, (frame) => frame.type === "message.received");
  mobileSocket.send(JSON.stringify({
    protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
    type: "message.submit",
    clientMessageId: "mobile-message-1",
    content: {
      type: "command",
      command: { kind: "conversation.submit", commandId: "mobile-command-1", conversationId: "conversation-1", message: "continue from phone" },
    },
  }));
  assert.equal((await accepted).type, "message.accepted");
  const deliveredFrame = await delivered;
  assert.equal(deliveredFrame.type, "message.deliver");
  if (deliveredFrame.type === "message.deliver") {
    desktopSocket.send(JSON.stringify({
      protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
      type: "message.received",
      messageId: deliveredFrame.message.messageId,
    }));
  }
  assert.equal((await received).type, "message.received");

  const renamed = await patch(relay.url, "/v1/account/handle", { handle: "gust-feng" }, activation.accessToken);
  assert.equal((renamed.account as { handle: string }).handle, "gust-feng");
  assert.equal((await fetch(`${relay.url}/v1/sync/snapshots`, { headers: { authorization: `Bearer ${activation.accessToken}` } })).status, 404);
  assert.equal((await fetch(`${relay.url}/v1/sync/snapshots/space.snapshot`, {
    method: "PUT",
    headers: { authorization: `Bearer ${activation.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ kind: "space.snapshot", content: "must not persist" }),
  })).status, 404);

  desktopSocket.close();
  await waitForClose(desktopSocket);
  const rejected = waitForFrame(mobileSocket, (frame) => frame.type === "message.rejected");
  mobileSocket.send(JSON.stringify({
    protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
    type: "message.submit",
    clientMessageId: "offline-message",
    content: {
      type: "command",
      command: {
        kind: "conversation.page.request",
        commandId: "offline-command",
        conversationId: "conversation-1",
      },
    },
  }));
  const rejectedFrame = await rejected;
  assert.equal(rejectedFrame.type === "message.rejected" && rejectedFrame.code, "peer_offline");
});

test("relay forwards Vault cursor invalidations only to another online device in the account", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-relay-vault-notify-"));
  const database = new SqliteRuntimeDatabase(path.join(root, "relay.sqlite"));
  let notifyVault: ((event: { accountId: string; sourceDeviceId: string; cursor: number }) => void) | undefined;
  const relay = await startRemoteRelayServer({
    store: createRemoteRelayStore({ database, codeFactory: () => "246810", allowOpenSignup: true }),
    contentVault: {
      async handle() { return false; },
      subscribe(listener) { notifyVault = listener; return () => { notifyVault = undefined; }; },
    },
    port: 0,
  });
  t.after(async () => {
    await relay.close();
    database.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  const activation = (await post(relay.url, "/v1/accounts/activate", { deviceName: "Desktop" })).credential as DeviceCredential;
  const pairing = (await post(relay.url, "/v1/pairings", {}, activation.accessToken)).pairing as Pairing;
  const mobile = (await post(relay.url, "/v1/pairings/join", { pairingCode: pairing.pairingCode, deviceName: "Phone" })).pairing as MobileClaim;
  await post(relay.url, `/v1/pairings/${pairing.pairingId}/approve`, { pairingCode: pairing.pairingCode }, activation.accessToken);
  const desktopSocket = await connect(relay.websocketUrl, activation.accessToken);
  const mobileSocket = await connect(relay.websocketUrl, mobile.accessToken);
  t.after(() => { desktopSocket.close(); mobileSocket.close(); });

  const changed = waitForFrame(mobileSocket, (frame) => frame.type === "vault.changed");
  notifyVault?.({
    accountId: activation.account.accountId,
    sourceDeviceId: activation.deviceId,
    cursor: 42,
  });

  assert.deepEqual(await changed, {
    protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
    type: "vault.changed",
    cursor: 42,
  });
});

test("relay disconnects a peer that exceeds its unacknowledged delivery capacity", async (t) => {
  const fixture = await createConnectedRelay(t, {
    maxPendingDeliveriesPerTarget: 1,
    deliveryTtlMs: 60_000,
  });
  const firstDelivery = waitForFrame(fixture.mobileSocket, (frame) => frame.type === "message.deliver");
  fixture.desktopSocket.send(JSON.stringify(commandFrame("desktop-message-1", "desktop-command-1")));
  await firstDelivery;

  const rejected = waitForFrame(fixture.desktopSocket, (frame) => frame.type === "message.rejected");
  const closed = waitForClose(fixture.mobileSocket);
  fixture.desktopSocket.send(JSON.stringify(commandFrame("desktop-message-2", "desktop-command-2")));

  const rejectedFrame = await rejected;
  assert.equal(rejectedFrame.type === "message.rejected" && rejectedFrame.code, "peer_backpressure");
  await closed;
});

test("relay expires unacknowledged deliveries and preserves the sender outbox contract", async (t) => {
  const fixture = await createConnectedRelay(t, {
    deliveryTtlMs: 25,
    deliverySweepIntervalMs: 5,
  });
  const delivery = waitForFrame(fixture.mobileSocket, (frame) => frame.type === "message.deliver");
  const peerOffline = waitForFrame(fixture.desktopSocket, (frame) => frame.type === "peer.presence" && !frame.online);
  fixture.desktopSocket.send(JSON.stringify(commandFrame("desktop-timeout", "desktop-timeout-command")));
  await delivery;

  assert.equal((await peerOffline).type, "peer.presence");
  await waitForClose(fixture.mobileSocket);
});

async function createConnectedRelay(
  t: test.TestContext,
  options: Pick<Parameters<typeof startRemoteRelayServer>[0], "maxPendingDeliveriesPerTarget" | "deliveryTtlMs" | "deliverySweepIntervalMs">,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-relay-bounds-"));
  const database = new SqliteRuntimeDatabase(path.join(root, "relay.sqlite"));
  const relay = await startRemoteRelayServer({
    store: createRemoteRelayStore({ database, codeFactory: () => "246810", allowOpenSignup: true }),
    ...options,
    port: 0,
  });
  const activation = (await post(relay.url, "/v1/accounts/activate", { deviceName: "Desktop" })).credential as DeviceCredential;
  const pairing = (await post(relay.url, "/v1/pairings", {}, activation.accessToken)).pairing as Pairing;
  const mobile = (await post(relay.url, "/v1/pairings/join", { pairingCode: pairing.pairingCode, deviceName: "Phone" })).pairing as MobileClaim;
  await post(relay.url, `/v1/pairings/${pairing.pairingId}/approve`, { pairingCode: pairing.pairingCode }, activation.accessToken);
  const desktopSocket = await connect(relay.websocketUrl, activation.accessToken);
  const mobileSocket = await connect(relay.websocketUrl, mobile.accessToken);
  t.after(async () => {
    desktopSocket.close();
    mobileSocket.close();
    await relay.close();
    database.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });
  return { desktopSocket, mobileSocket };
}

function commandFrame(clientMessageId: string, commandId: string) {
  return {
    protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
    type: "message.submit",
    clientMessageId,
    content: {
      type: "command",
      command: { kind: "conversation.page.request", commandId, conversationId: "conversation-1" },
    },
  } as const;
}

async function post(baseUrl: string, pathname: string, body: unknown, token?: string): Promise<Record<string, unknown>> {
  return request(baseUrl, pathname, "POST", body, token);
}

async function patch(baseUrl: string, pathname: string, body: unknown, token: string): Promise<Record<string, unknown>> {
  return request(baseUrl, pathname, "PATCH", body, token);
}

async function request(baseUrl: string, pathname: string, method: string, body: unknown, token?: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });
  const result = await response.json() as Record<string, unknown>;
  assert.equal(response.ok, true, JSON.stringify(result));
  return result;
}

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

function waitForFrame(socket: WebSocket, predicate: (frame: RemoteServerFrame) => boolean): Promise<RemoteServerFrame> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for relay frame"));
    }, 5_000);
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

function waitForClose(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => socket.once("close", () => resolve()));
}

type DeviceCredential = {
  readonly accessToken: string;
  readonly deviceId: string;
  readonly account: { readonly accountId: string };
};
type Pairing = { readonly pairingId: string; readonly pairingCode: string };
type MobileClaim = { readonly accessToken: string };
