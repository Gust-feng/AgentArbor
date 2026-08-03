import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import { createRemoteRelayStore, RemoteRelayError } from "./relay-store.js";

test("an invitation activates one account and the unique handle can be renamed", async (t) => {
  const fixture = await relayFixture(t, { invitationCodes: ["invite-example-0001", "invite-example-0002"] });
  assert.throws(
    () => fixture.store.activateAccount("Desktop"),
    (error: unknown) => error instanceof RemoteRelayError && error.code === "invitation_required",
  );

  const first = fixture.store.activateAccount("Desktop", "invite-example-0001");
  assert.equal(first.role, "desktop");
  assert.match(first.account.handle, /^user-/u);
  assert.equal(fixture.store.authenticate(first.accessToken).account.accountId, first.account.accountId);
  assert.throws(
    () => fixture.store.activateAccount("Other desktop", "invite-example-0001"),
    (error: unknown) => error instanceof RemoteRelayError && error.code === "invitation_invalid_or_claimed",
  );

  const renamed = fixture.store.updateAccountHandle(first.accessToken, "gust-feng");
  assert.equal(renamed.handle, "gust-feng");
  const second = fixture.store.activateAccount("Second desktop", "invite-example-0002");
  assert.throws(
    () => fixture.store.updateAccountHandle(second.accessToken, "GUST-FENG"),
    (error: unknown) => error instanceof RemoteRelayError && error.code === "account_handle_taken",
  );
});

test("a phone token stays unusable until the desktop approves the pairing code", async (t) => {
  const fixture = await relayFixture(t);
  const desktop = fixture.store.activateAccount("Desktop");
  const pairing = fixture.store.createPairingSession(desktop.accessToken);
  const mobile = fixture.store.joinPairing(pairing.pairingCode, "Phone");

  assert.equal(fixture.store.pairingStatusForDesktop(desktop.accessToken, pairing.pairingId).status, "waiting_for_approval");
  assert.throws(
    () => fixture.store.authenticate(mobile.accessToken),
    (error: unknown) => error instanceof RemoteRelayError && error.code === "pairing_not_approved",
  );
  assert.throws(
    () => fixture.store.approvePairing(desktop.accessToken, pairing.pairingId, "000000"),
    (error: unknown) => error instanceof RemoteRelayError && error.code === "pairing_code_mismatch",
  );

  const approved = fixture.store.approvePairing(desktop.accessToken, pairing.pairingId, pairing.pairingCode);
  assert.equal(approved.status, "paired");
  assert.equal(fixture.store.authenticate(mobile.accessToken).peerDeviceId, desktop.deviceId);
  assert.equal(fixture.store.authenticate(desktop.accessToken).peerDeviceId, mobile.deviceId);
  assert.throws(
    () => fixture.store.createPairingSession(desktop.accessToken),
    (error: unknown) => error instanceof RemoteRelayError && error.code === "device_limit_reached",
  );

  fixture.store.revokeDevice(desktop.accessToken, mobile.deviceId);
  assert.throws(
    () => fixture.store.authenticate(mobile.accessToken),
    (error: unknown) => error instanceof RemoteRelayError && error.code === "invalid_device_token",
  );
  assert.equal(fixture.store.authenticate(desktop.accessToken).peerDeviceId, undefined);
});

test("relay restart preserves only account and device control facts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-relay-restart-"));
  const filePath = path.join(root, "relay.sqlite");
  let database = new SqliteRuntimeDatabase(filePath);
  t.after(async () => {
    database.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });
  let store = createRemoteRelayStore({ database, allowOpenSignup: true, codeFactory: () => "654321" });
  const desktop = store.activateAccount("Desktop");
  const pairing = store.createPairingSession(desktop.accessToken);
  const mobile = store.joinPairing(pairing.pairingCode, "Phone");
  store.approvePairing(desktop.accessToken, pairing.pairingId, pairing.pairingCode);

  database.close();
  database = new SqliteRuntimeDatabase(filePath);
  store = createRemoteRelayStore({ database });
  assert.equal(store.authenticate(desktop.accessToken).peerDeviceId, mobile.deviceId);

  const tables = database.connection.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'remote_%' ORDER BY name
  `).all().map((row) => String((row as { name: string }).name));
  assert.deepEqual(tables, [
    "remote_accounts",
    "remote_devices",
    "remote_invitations",
    "remote_pairing_sessions",
  ]);
  for (const forbidden of ["message", "conversation", "command", "sync", "snapshot", "content"]) {
    assert.equal(tables.some((table) => table.includes(forbidden)), false);
  }
});

async function relayFixture(
  t: test.TestContext,
  options: { readonly invitationCodes?: readonly string[] } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-relay-store-"));
  const database = new SqliteRuntimeDatabase(path.join(root, "relay.sqlite"));
  t.after(async () => {
    database.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });
  return {
    database,
    store: createRemoteRelayStore({
      database,
      codeFactory: () => "123456",
      allowOpenSignup: options.invitationCodes === undefined,
      ...options,
    }),
  };
}
