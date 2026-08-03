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
});

test("relay consumes each configured invitation exactly once", async (t) => {
  const fixture = await relayFixture(t, {
    allowOpenSignup: false,
    invitationCodes: ["invite-example-0001"],
    codeFactory: sequentialCodeFactory(),
  });
  assert.throws(
    () => fixture.store.createPairing("Desktop"),
    (error: unknown) => error instanceof RemoteRelayError && error.code === "invitation_required",
  );
  assert.throws(
    () => fixture.store.createPairing("Desktop", "invite-example-wrong"),
    (error: unknown) => error instanceof RemoteRelayError && error.code === "invitation_invalid_or_claimed",
  );
  assert.equal(fixture.store.createPairing("Desktop", "invite-example-0001").role, "desktop");
  assert.throws(
    () => fixture.store.createPairing("Another desktop", "invite-example-0001"),
    (error: unknown) => error instanceof RemoteRelayError && error.code === "invitation_invalid_or_claimed",
  );
});

test("relay persists only whitelisted synchronized snapshots", async (t) => {
  const fixture = await pairedFixture(t);
  const desktopAuth = fixture.store.authenticate(fixture.desktopToken);
  const first = fixture.store.saveSyncSnapshot(desktopAuth, spaceSnapshot("Space one"));
  const second = fixture.store.saveSyncSnapshot(desktopAuth, spaceSnapshot("Space renamed"));
  const sync = fixture.store.listSyncSnapshots(fixture.mobileToken);

  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.equal(sync.documents.length, 1);
  assert.equal(sync.documents[0]?.snapshot.kind, "space.snapshot");
  assert.equal(sync.usageBytes, sync.documents[0]?.bytes);
  assert.throws(
    () => fixture.store.saveSyncSnapshot(fixture.store.authenticate(fixture.mobileToken), spaceSnapshot("Mobile")),
    (error: unknown) => error instanceof RemoteRelayError && error.code === "sync_write_forbidden",
  );

  const tables = fixture.database.connection.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
  `).all().map((row) => String((row as { name: string }).name));
  assert.equal(tables.includes("remote_messages"), false);
});

test("relay enforces document and account quotas without replacing the previous snapshot", async (t) => {
  const fixture = await relayFixture(t, { accountQuotaBytes: 900, documentQuotaBytes: 850 });
  const paired = pair(fixture.store);
  const desktopAuth = fixture.store.authenticate(paired.desktopToken);
  fixture.store.saveSyncSnapshot(desktopAuth, spaceSnapshot("small"));
  assert.throws(
    () => fixture.store.saveSyncSnapshot(desktopAuth, {
      kind: "notebook.snapshot",
      eventId: "notes-large",
      notebooks: [{
        notebookId: "global",
        label: "Global",
        scope: "global",
        content: "x".repeat(550),
        version: `sha256:${"a".repeat(64)}`,
      }],
    }),
    (error: unknown) => error instanceof RemoteRelayError && error.code === "sync_account_quota_exceeded",
  );
  assert.throws(
    () => fixture.store.saveSyncSnapshot(desktopAuth, {
      kind: "notebook.snapshot",
      eventId: "notes-too-large",
      notebooks: [{
        notebookId: "global",
        label: "Global",
        scope: "global",
        content: "x".repeat(800),
        version: `sha256:${"b".repeat(64)}`,
      }],
    }),
    (error: unknown) => error instanceof RemoteRelayError && error.code === "sync_document_too_large",
  );
  assert.equal(fixture.store.listSyncSnapshots(paired.mobileToken).documents.length, 1);
});

test("relay survives restart with pairing and synchronized snapshots but no message bodies", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-relay-restart-"));
  const filePath = path.join(root, "relay.sqlite");
  let database = new SqliteRuntimeDatabase(filePath);
  t.after(async () => {
    database.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });
  let store = createRemoteRelayStore({ database, codeFactory: () => "654321", allowOpenSignup: true });
  const paired = pair(store);
  store.saveSyncSnapshot(store.authenticate(paired.desktopToken), spaceSnapshot("Persisted"));
  database.close();

  database = new SqliteRuntimeDatabase(filePath);
  store = createRemoteRelayStore({ database });
  assert.equal(store.listSyncSnapshots(paired.mobileToken).documents.length, 1);
  const messageTable = database.connection.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'remote_messages'
  `).get();
  assert.equal(messageTable, undefined);
});

async function relayFixture(
  t: test.TestContext,
  options: {
    readonly accountQuotaBytes?: number;
    readonly documentQuotaBytes?: number;
    readonly invitationCodes?: readonly string[];
    readonly allowOpenSignup?: boolean;
    readonly codeFactory?: () => string;
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-relay-"));
  const database = new SqliteRuntimeDatabase(path.join(root, "relay.sqlite"));
  t.after(() => {
    database.close();
    return rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });
  return {
    database,
    store: createRemoteRelayStore({ database, codeFactory: () => "123456", allowOpenSignup: true, ...options }),
  };
}

function sequentialCodeFactory(): () => string {
  let value = 100_000;
  return () => String(value++);
}

async function pairedFixture(t: test.TestContext) {
  const fixture = await relayFixture(t);
  return { ...fixture, ...pair(fixture.store) };
}

function pair(store: ReturnType<typeof createRemoteRelayStore>) {
  const desktop = store.createPairing("Desktop");
  const mobile = store.joinPairing(desktop.pairingCode, "Phone");
  store.confirmPairing(desktop.pairingId, desktop.claimSecret, desktop.pairingCode);
  store.confirmPairing(mobile.pairingId, mobile.claimSecret, mobile.pairingCode);
  return {
    desktop,
    mobile,
    desktopToken: store.issueDeviceToken(desktop.pairingId, desktop.claimSecret).accessToken,
    mobileToken: store.issueDeviceToken(mobile.pairingId, mobile.claimSecret).accessToken,
  };
}

function spaceSnapshot(title: string) {
  return {
    kind: "space.snapshot" as const,
    eventId: `space-${title}`,
    spaces: [{
      id: "space-1",
      title,
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
      references: [],
    }],
  };
}
