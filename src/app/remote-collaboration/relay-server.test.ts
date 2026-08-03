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
      command: { kind: "conversation.submit", commandId: "mobile-command-1", message: "continue from phone" },
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
    content: { type: "command", command: { kind: "sync.snapshot.request", commandId: "offline-command" } },
  }));
  const rejectedFrame = await rejected;
  assert.equal(rejectedFrame.type === "message.rejected" && rejectedFrame.code, "peer_offline");
});

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

type DeviceCredential = { readonly accessToken: string };
type Pairing = { readonly pairingId: string; readonly pairingCode: string };
type MobileClaim = { readonly accessToken: string };
