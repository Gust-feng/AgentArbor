import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import { createRemoteRelayStore, RemoteRelayError } from "./relay-store.js";

test("relay pairing requires both confirmations and supports revocation", async (t) => {
  const fixture = await relayFixture(t);
  const desktop = fixture.store.createPairing("Desktop");
  const mobile = fixture.store.joinPairing(desktop.pairingCode, "Phone");

  const oneSided = fixture.store.confirmPairing(desktop.pairingId, desktop.claimSecret, desktop.pairingCode);
  assert.equal(oneSided.status, "waiting_for_confirmation");
  assert.throws(
    () => fixture.store.issueDeviceToken(desktop.pairingId, desktop.claimSecret),
    (error: unknown) => error instanceof RemoteRelayError && error.code === "pairing_not_confirmed",
  );

  const completed = fixture.store.confirmPairing(mobile.pairingId, mobile.claimSecret, mobile.pairingCode);
  assert.equal(completed.status, "paired");
  const desktopToken = fixture.store.issueDeviceToken(desktop.pairingId, desktop.claimSecret).accessToken;
  const mobileToken = fixture.store.issueDeviceToken(mobile.pairingId, mobile.claimSecret).accessToken;
  assert.equal(fixture.store.authenticate(desktopToken).peerDeviceId, mobile.deviceId);

  fixture.store.revokeDevice(desktopToken, mobile.deviceId);
  assert.throws(
    () => fixture.store.authenticate(mobileToken),
    (error: unknown) => error instanceof RemoteRelayError && error.code === "invalid_device_token",
  );
  assert.throws(
    () => fixture.store.authenticate(desktopToken),
    (error: unknown) => error instanceof RemoteRelayError && error.code === "peer_unavailable",
  );
  fixture.store.revokeDevice(desktopToken, desktop.deviceId);
  assert.throws(
    () => fixture.store.authenticate(desktopToken),
    (error: unknown) => error instanceof RemoteRelayError && error.code === "invalid_device_token",
  );
});

test("relay persists ordered messages, acknowledgements and idempotent submissions", async (t) => {
  const fixture = await pairedFixture(t);
  const desktopAuth = fixture.store.authenticate(fixture.desktopToken);
  const first = fixture.store.enqueueMessage(desktopAuth, "client-message-1", command("command-1", "hello"));
  const duplicate = fixture.store.enqueueMessage(desktopAuth, "client-message-1", command("command-1", "hello"));
  const second = fixture.store.enqueueMessage(desktopAuth, "client-message-2", command("command-2", "again"));
  assert.equal(first.messageId, duplicate.messageId);
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.deepEqual(fixture.store.pendingMessages(fixture.mobile.deviceId, 0).map((message) => message.sequence), [1, 2]);

  assert.equal(fixture.store.acknowledge(fixture.mobile.deviceId, 1), 1);
  assert.deepEqual(fixture.store.pendingMessages(fixture.mobile.deviceId, 0).map((message) => message.sequence), [2]);
  assert.throws(
    () => fixture.store.enqueueMessage(desktopAuth, "client-message-1", command("command-other", "different")),
    (error: unknown) => error instanceof RemoteRelayError && error.code === "message_id_conflict",
  );
});

test("relay survives restart with pairing and message cursors", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-relay-restart-"));
  const filePath = path.join(root, "relay.sqlite");
  let database = new SqliteRuntimeDatabase(filePath);
  t.after(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });
  let store = createRemoteRelayStore({ database, codeFactory: () => "654321" });
  const desktop = store.createPairing("Desktop");
  const mobile = store.joinPairing(desktop.pairingCode, "Phone");
  store.confirmPairing(desktop.pairingId, desktop.claimSecret, desktop.pairingCode);
  store.confirmPairing(mobile.pairingId, mobile.claimSecret, mobile.pairingCode);
  const desktopToken = store.issueDeviceToken(desktop.pairingId, desktop.claimSecret).accessToken;
  const mobileToken = store.issueDeviceToken(mobile.pairingId, mobile.claimSecret).accessToken;
  store.enqueueMessage(store.authenticate(desktopToken), "message-before-restart", command("command-restart", "persist"));
  database.close();

  database = new SqliteRuntimeDatabase(filePath);
  store = createRemoteRelayStore({ database });
  assert.equal(store.authenticate(mobileToken).lastAckSequence, 0);
  assert.equal(store.pendingMessages(mobile.deviceId, 0).length, 1);
  store.acknowledge(mobile.deviceId, 1);
  assert.equal(store.authenticate(mobileToken).lastAckSequence, 1);
});

async function relayFixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-relay-"));
  const database = new SqliteRuntimeDatabase(path.join(root, "relay.sqlite"));
  t.after(() => {
    database.close();
    return rm(root, { recursive: true, force: true });
  });
  return { store: createRemoteRelayStore({ database, codeFactory: () => "123456" }) };
}

async function pairedFixture(t: test.TestContext) {
  const fixture = await relayFixture(t);
  const desktop = fixture.store.createPairing("Desktop");
  const mobile = fixture.store.joinPairing(desktop.pairingCode, "Phone");
  fixture.store.confirmPairing(desktop.pairingId, desktop.claimSecret, desktop.pairingCode);
  fixture.store.confirmPairing(mobile.pairingId, mobile.claimSecret, mobile.pairingCode);
  return {
    ...fixture,
    desktop,
    mobile,
    desktopToken: fixture.store.issueDeviceToken(desktop.pairingId, desktop.claimSecret).accessToken,
    mobileToken: fixture.store.issueDeviceToken(mobile.pairingId, mobile.claimSecret).accessToken,
  };
}

function command(commandId: string, message: string) {
  return { type: "command" as const, command: { kind: "conversation.submit" as const, commandId, message } };
}
