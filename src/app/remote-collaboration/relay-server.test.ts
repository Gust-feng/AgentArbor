import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { WebSocket } from "ws";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import { REMOTE_COLLABORATION_PROTOCOL_VERSION, remoteServerFrameSchema, type RemoteServerFrame } from "./protocol.js";
import { startRemoteRelayServer } from "./relay-server.js";
import { createRemoteRelayStore } from "./relay-store.js";

test("Relay HTTP pairing and WebSocket delivery form one local end-to-end transport", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-relay-server-"));
  const database = new SqliteRuntimeDatabase(path.join(root, "relay.sqlite"));
  const relay = await startRemoteRelayServer({
    store: createRemoteRelayStore({ database, codeFactory: () => "246810" }),
    port: 0,
  });
  t.after(async () => {
    await relay.close();
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  const desktop = await post(relay.url, "/v1/pairings", { deviceName: "Desktop" });
  const desktopPairing = desktop.pairing as PairingClaim;
  const mobile = await post(relay.url, "/v1/pairings/join", { pairingCode: desktopPairing.pairingCode, deviceName: "Phone" });
  const mobilePairing = mobile.pairing as PairingClaim;
  await post(relay.url, `/v1/pairings/${desktopPairing.pairingId}/confirm`, {
    claimSecret: desktopPairing.claimSecret,
    pairingCode: desktopPairing.pairingCode,
  });
  await post(relay.url, `/v1/pairings/${mobilePairing.pairingId}/confirm`, {
    claimSecret: mobilePairing.claimSecret,
    pairingCode: mobilePairing.pairingCode,
  });
  const desktopToken = (await post(relay.url, `/v1/pairings/${desktopPairing.pairingId}/token`, {
    claimSecret: desktopPairing.claimSecret,
  })).device as DeviceToken;
  const mobileToken = (await post(relay.url, `/v1/pairings/${mobilePairing.pairingId}/token`, {
    claimSecret: mobilePairing.claimSecret,
  })).device as DeviceToken;

  const desktopSocket = await connect(relay.websocketUrl, desktopToken.accessToken);
  const mobileSocket = await connect(relay.websocketUrl, mobileToken.accessToken);
  const accepted = waitForFrame(mobileSocket, (frame) => frame.type === "message.accepted");
  const delivered = waitForFrame(desktopSocket, (frame) => frame.type === "message.deliver");
  mobileSocket.send(JSON.stringify({
    protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
    type: "message.submit",
    clientMessageId: "mobile-message-1",
    content: {
      type: "command",
      command: { kind: "conversation.submit", commandId: "mobile-command-1", message: "continue from phone" },
    },
  }));
  const acceptedFrame = await accepted;
  const deliveredFrame = await delivered;
  assert.equal(acceptedFrame.type, "message.accepted");
  assert.equal(deliveredFrame.type, "message.deliver");
  if (deliveredFrame.type === "message.deliver") {
    assert.equal(deliveredFrame.message.sequence, 1);
    assert.equal(deliveredFrame.message.content.type, "command");
  }
  desktopSocket.close();
  mobileSocket.close();
});

async function post(baseUrl: string, pathname: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await response.json() as Record<string, unknown>;
  assert.equal(response.ok, true, JSON.stringify(value));
  return value;
}

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
  assert.equal((await ready).type, "server.ready");
  return socket;
}

function waitForFrame(
  socket: WebSocket,
  predicate: (frame: RemoteServerFrame) => boolean,
): Promise<RemoteServerFrame> {
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

type PairingClaim = {
  readonly pairingId: string;
  readonly pairingCode: string;
  readonly claimSecret: string;
};

type DeviceToken = { readonly accessToken: string };
