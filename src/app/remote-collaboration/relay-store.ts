import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";

import type { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import {
  parseRemoteSyncSnapshot,
  type RemoteDeviceRole,
  type RemoteSyncSnapshot,
} from "./protocol.js";

export const DEFAULT_RELAY_ACCOUNT_QUOTA_BYTES = 150 * 1_024 * 1_024;
export const DEFAULT_RELAY_DOCUMENT_QUOTA_BYTES = 20 * 1_024 * 1_024;

const RELAY_MIGRATIONS = [{
  version: 1,
  sql: `
    CREATE TABLE remote_pairings (
      pairing_id TEXT PRIMARY KEY,
      pairing_code TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      completed_at TEXT
    ) STRICT;

    CREATE TABLE remote_devices (
      device_id TEXT PRIMARY KEY,
      pairing_id TEXT NOT NULL REFERENCES remote_pairings(pairing_id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('desktop', 'mobile')),
      name TEXT NOT NULL,
      claim_hash TEXT NOT NULL UNIQUE,
      confirmed_at TEXT,
      token_hash TEXT UNIQUE,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(pairing_id, role)
    ) STRICT;

    CREATE TABLE remote_invitations (
      code_hash TEXT PRIMARY KEY,
      claimed_pairing_id TEXT REFERENCES remote_pairings(pairing_id),
      claimed_at TEXT
    ) STRICT;

    CREATE TABLE remote_sync_documents (
      pairing_id TEXT NOT NULL REFERENCES remote_pairings(pairing_id) ON DELETE CASCADE,
      document_kind TEXT NOT NULL CHECK(document_kind IN (
        'space.snapshot', 'notebook.snapshot', 'asset.snapshot', 'managed_folder.snapshot'
      )),
      version INTEGER NOT NULL,
      content_json TEXT NOT NULL,
      content_bytes INTEGER NOT NULL,
      updated_by_device_id TEXT NOT NULL REFERENCES remote_devices(device_id),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(pairing_id, document_kind)
    ) STRICT;
  `,
}, {
  version: 2,
  sql: `
    DROP TABLE IF EXISTS remote_messages;

    CREATE TABLE IF NOT EXISTS remote_sync_documents (
      pairing_id TEXT NOT NULL REFERENCES remote_pairings(pairing_id) ON DELETE CASCADE,
      document_kind TEXT NOT NULL CHECK(document_kind IN (
        'space.snapshot', 'notebook.snapshot', 'asset.snapshot', 'managed_folder.snapshot'
      )),
      version INTEGER NOT NULL,
      content_json TEXT NOT NULL,
      content_bytes INTEGER NOT NULL,
      updated_by_device_id TEXT NOT NULL REFERENCES remote_devices(device_id),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(pairing_id, document_kind)
    ) STRICT;
  `,
}, {
  version: 3,
  sql: `
    CREATE TABLE IF NOT EXISTS remote_invitations (
      code_hash TEXT PRIMARY KEY,
      claimed_pairing_id TEXT REFERENCES remote_pairings(pairing_id),
      claimed_at TEXT
    ) STRICT;
  `,
}] as const;

export type RelayPairingClaim = {
  readonly pairingId: string;
  readonly pairingCode: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly role: RemoteDeviceRole;
  readonly claimSecret: string;
  readonly expiresAt: string;
};

export type RelayPairingStatus = {
  readonly pairingId: string;
  readonly pairingCode: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly role: RemoteDeviceRole;
  readonly peer?: { readonly deviceId: string; readonly deviceName: string; readonly role: RemoteDeviceRole };
  readonly status: "waiting_for_peer" | "waiting_for_confirmation" | "paired" | "expired";
  readonly localConfirmed: boolean;
  readonly peerConfirmed: boolean;
  readonly expiresAt: string;
};

export type RelayAuthenticatedDevice = {
  readonly pairingId: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly role: RemoteDeviceRole;
  readonly peerDeviceId: string;
  readonly peerDeviceName: string;
  readonly peerRole: RemoteDeviceRole;
};

export type RelaySyncDocument = {
  readonly kind: RemoteSyncSnapshot["kind"];
  readonly version: number;
  readonly bytes: number;
  readonly updatedAt: string;
  readonly snapshot: RemoteSyncSnapshot;
};

export class RemoteRelayError extends Error {
  readonly name = "RemoteRelayError";

  constructor(
    readonly code:
      | "pairing_not_found"
      | "pairing_expired"
      | "pairing_already_joined"
      | "pairing_code_mismatch"
      | "pairing_not_confirmed"
      | "invalid_claim"
      | "invalid_device_token"
      | "device_revoked"
      | "peer_unavailable"
      | "invitation_required"
      | "invitation_invalid_or_claimed"
      | "sync_write_forbidden"
      | "sync_document_too_large"
      | "sync_account_quota_exceeded",
    message: string,
  ) {
    super(message);
  }
}

export type CreateRemoteRelayStoreInput = {
  readonly database: SqliteRuntimeDatabase;
  readonly now?: () => Date;
  readonly idFactory?: () => string;
  readonly secretFactory?: () => string;
  readonly codeFactory?: () => string;
  readonly pairingTtlMs?: number;
  readonly accountQuotaBytes?: number;
  readonly documentQuotaBytes?: number;
  readonly invitationCodes?: readonly string[];
  readonly allowOpenSignup?: boolean;
};

export type RemoteRelayStore = ReturnType<typeof createRemoteRelayStore>;

export function createRemoteRelayStore(input: CreateRemoteRelayStoreInput) {
  const now = input.now ?? (() => new Date());
  const idFactory = input.idFactory ?? randomUUID;
  const secretFactory = input.secretFactory ?? (() => randomBytes(32).toString("base64url"));
  const codeFactory = input.codeFactory ?? (() => randomInt(0, 1_000_000).toString().padStart(6, "0"));
  const pairingTtlMs = input.pairingTtlMs ?? 10 * 60 * 1_000;
  const accountQuotaBytes = positiveQuota(input.accountQuotaBytes ?? DEFAULT_RELAY_ACCOUNT_QUOTA_BYTES, "account");
  const documentQuotaBytes = positiveQuota(input.documentQuotaBytes ?? DEFAULT_RELAY_DOCUMENT_QUOTA_BYTES, "document");
  const allowOpenSignup = input.allowOpenSignup ?? false;
  const db = input.database;
  db.migrate("remote-relay", RELAY_MIGRATIONS);
  seedInvitations(db, input.invitationCodes ?? []);

  function createPairing(deviceName: string, invitationCode?: string): RelayPairingClaim {
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + pairingTtlMs);
    const pairingId = idFactory();
    const deviceId = idFactory();
    const claimSecret = secretFactory();
    const pairingCode = unusedPairingCode(codeFactory, db);
    const invitationHash = allowOpenSignup ? undefined : invitationCodeHash(invitationCode);
    db.transaction(() => {
      db.connection.prepare(`
        INSERT INTO remote_pairings(pairing_id, pairing_code, created_at, expires_at)
        VALUES (?, ?, ?, ?)
      `).run(pairingId, pairingCode, createdAt.toISOString(), expiresAt.toISOString());
      if (invitationHash !== undefined) {
        const claimed = db.connection.prepare(`
          UPDATE remote_invitations
          SET claimed_pairing_id = ?, claimed_at = ?
          WHERE code_hash = ? AND claimed_pairing_id IS NULL
        `).run(pairingId, createdAt.toISOString(), invitationHash);
        if (claimed.changes !== 1) {
          throw new RemoteRelayError("invitation_invalid_or_claimed", "The invitation code is invalid or has already been used");
        }
      }
      insertDevice(db, {
        deviceId,
        pairingId,
        role: "desktop",
        name: normalizedDeviceName(deviceName),
        claimHash: hashSecret(claimSecret),
        createdAt: createdAt.toISOString(),
      });
    });
    return {
      pairingId,
      pairingCode,
      deviceId,
      deviceName: normalizedDeviceName(deviceName),
      role: "desktop",
      claimSecret,
      expiresAt: expiresAt.toISOString(),
    };
  }

  function joinPairing(pairingCode: string, deviceName: string): RelayPairingClaim {
    const at = now();
    const pairing = pairingByCode(db, pairingCode);
    requireActivePairing(pairing, at);
    const existing = deviceByRole(db, pairing.pairingId, "mobile");
    if (existing !== undefined) {
      throw new RemoteRelayError("pairing_already_joined", "This pairing code already has a mobile device");
    }
    const deviceId = idFactory();
    const claimSecret = secretFactory();
    insertDevice(db, {
      deviceId,
      pairingId: pairing.pairingId,
      role: "mobile",
      name: normalizedDeviceName(deviceName),
      claimHash: hashSecret(claimSecret),
      createdAt: at.toISOString(),
    });
    return {
      pairingId: pairing.pairingId,
      pairingCode: pairing.pairingCode,
      deviceId,
      deviceName: normalizedDeviceName(deviceName),
      role: "mobile",
      claimSecret,
      expiresAt: pairing.expiresAt,
    };
  }

  function pairingStatus(pairingId: string, claimSecret: string): RelayPairingStatus {
    const pairing = pairingById(db, pairingId);
    const local = claimDevice(db, pairingId, claimSecret);
    const peer = peerDevice(db, pairingId, local.deviceId, true);
    const expired = now().getTime() >= Date.parse(pairing.expiresAt);
    const status = expired && pairing.completedAt === null
      ? "expired" as const
      : peer === undefined
        ? "waiting_for_peer" as const
        : pairing.completedAt === null
          ? "waiting_for_confirmation" as const
          : "paired" as const;
    return {
      pairingId,
      pairingCode: pairing.pairingCode,
      deviceId: local.deviceId,
      deviceName: local.name,
      role: local.role,
      ...(peer === undefined ? {} : {
        peer: { deviceId: peer.deviceId, deviceName: peer.name, role: peer.role },
      }),
      status,
      localConfirmed: local.confirmedAt !== null,
      peerConfirmed: peer?.confirmedAt !== null && peer?.confirmedAt !== undefined,
      expiresAt: pairing.expiresAt,
    };
  }

  function confirmPairing(pairingId: string, claimSecret: string, pairingCode: string): RelayPairingStatus {
    const pairing = pairingById(db, pairingId);
    requireActivePairing(pairing, now(), true);
    if (pairing.pairingCode !== pairingCode) {
      throw new RemoteRelayError("pairing_code_mismatch", "The confirmed pairing code does not match");
    }
    const local = claimDevice(db, pairingId, claimSecret);
    const confirmedAt = now().toISOString();
    db.transaction(() => {
      db.connection.prepare(`
        UPDATE remote_devices SET confirmed_at = COALESCE(confirmed_at, ?)
        WHERE device_id = ? AND revoked_at IS NULL
      `).run(confirmedAt, local.deviceId);
      const devices = devicesForPairing(db, pairingId, true);
      if (devices.length === 2 && devices.every((device) => device.confirmedAt !== null)) {
        db.connection.prepare(`
          UPDATE remote_pairings SET completed_at = COALESCE(completed_at, ?) WHERE pairing_id = ?
        `).run(confirmedAt, pairingId);
      }
    });
    return pairingStatus(pairingId, claimSecret);
  }

  function issueDeviceToken(pairingId: string, claimSecret: string): {
    readonly deviceId: string;
    readonly accessToken: string;
  } {
    const pairing = pairingById(db, pairingId);
    requireActivePairing(pairing, now(), true);
    if (pairing.completedAt === null) {
      throw new RemoteRelayError("pairing_not_confirmed", "Both devices must confirm before a token is issued");
    }
    const device = claimDevice(db, pairingId, claimSecret);
    if (device.confirmedAt === null) {
      throw new RemoteRelayError("pairing_not_confirmed", "This device has not confirmed the pairing");
    }
    const token = secretFactory();
    db.connection.prepare("UPDATE remote_devices SET token_hash = ? WHERE device_id = ?")
      .run(hashSecret(token), device.deviceId);
    return { deviceId: device.deviceId, accessToken: token };
  }

  function authenticate(accessToken: string): RelayAuthenticatedDevice {
    const row = db.connection.prepare(`
      SELECT d.device_id AS deviceId, d.pairing_id AS pairingId, d.name, d.role,
             d.revoked_at AS revokedAt,
             p.completed_at AS completedAt
      FROM remote_devices d
      JOIN remote_pairings p ON p.pairing_id = d.pairing_id
      WHERE d.token_hash = ?
    `).get(hashSecret(accessToken)) as DeviceAuthRow | undefined;
    if (row === undefined) throw new RemoteRelayError("invalid_device_token", "The device token is invalid");
    if (row.revokedAt !== null) throw new RemoteRelayError("device_revoked", "The device has been revoked");
    if (row.completedAt === null) throw new RemoteRelayError("pairing_not_confirmed", "The pairing is not complete");
    const peer = peerDevice(db, row.pairingId, row.deviceId, false);
    if (peer === undefined) throw new RemoteRelayError("peer_unavailable", "The paired device is unavailable or revoked");
    return {
      pairingId: row.pairingId,
      deviceId: row.deviceId,
      deviceName: row.name,
      role: row.role,
      peerDeviceId: peer.deviceId,
      peerDeviceName: peer.name,
      peerRole: peer.role,
    };
  }

  function listDevices(accessToken: string) {
    const auth = authenticate(accessToken);
    return devicesForPairing(db, auth.pairingId, true).map((device) => ({
      deviceId: device.deviceId,
      deviceName: device.name,
      role: device.role,
      confirmedAt: device.confirmedAt ?? undefined,
      revokedAt: device.revokedAt ?? undefined,
      current: device.deviceId === auth.deviceId,
    }));
  }

  function revokeDevice(accessToken: string, targetDeviceId: string): void {
    const caller = revocationCaller(accessToken);
    const target = devicesForPairing(db, caller.pairingId, true).find((device) => device.deviceId === targetDeviceId);
    if (target === undefined) throw new RemoteRelayError("peer_unavailable", "The target device does not belong to this pairing");
    db.connection.prepare(`
      UPDATE remote_devices SET revoked_at = COALESCE(revoked_at, ?), token_hash = NULL WHERE device_id = ?
    `).run(now().toISOString(), targetDeviceId);
  }

  function revocationCaller(accessToken: string): { readonly pairingId: string } {
    const row = db.connection.prepare(`
      SELECT d.pairing_id AS pairingId,
             d.revoked_at AS revokedAt, p.completed_at AS completedAt
      FROM remote_devices d
      JOIN remote_pairings p ON p.pairing_id = d.pairing_id
      WHERE d.token_hash = ?
    `).get(hashSecret(accessToken)) as RevocationCallerRow | undefined;
    if (row === undefined) throw new RemoteRelayError("invalid_device_token", "The device token is invalid");
    if (row.revokedAt !== null) throw new RemoteRelayError("device_revoked", "The device has been revoked");
    if (row.completedAt === null) throw new RemoteRelayError("pairing_not_confirmed", "The pairing is not complete");
    return { pairingId: row.pairingId };
  }

  function saveSyncSnapshot(sender: RelayAuthenticatedDevice, rawSnapshot: unknown): RelaySyncDocument {
    if (sender.role !== "desktop") {
      throw new RemoteRelayError("sync_write_forbidden", "Only the paired desktop can publish synchronized snapshots");
    }
    const snapshot = parseRemoteSyncSnapshot(rawSnapshot);
    const contentJson = JSON.stringify(snapshot);
    const contentBytes = Buffer.byteLength(contentJson, "utf8");
    if (contentBytes > documentQuotaBytes) {
      throw new RemoteRelayError("sync_document_too_large", "The synchronized document exceeds the configured document quota");
    }
    const updatedAt = now().toISOString();
    return db.transaction(() => {
      const current = db.connection.prepare(`
        SELECT document_kind AS kind, version, content_json AS contentJson,
               content_bytes AS bytes, updated_at AS updatedAt
        FROM remote_sync_documents WHERE pairing_id = ? AND document_kind = ?
      `).get(sender.pairingId, snapshot.kind) as SyncDocumentRow | undefined;
      if (current?.contentJson === contentJson) return syncDocumentFromRow(current);
      const usage = db.connection.prepare(`
        SELECT COALESCE(SUM(content_bytes), 0) AS bytes
        FROM remote_sync_documents WHERE pairing_id = ? AND document_kind <> ?
      `).get(sender.pairingId, snapshot.kind) as { bytes: number };
      if (Number(usage.bytes) + contentBytes > accountQuotaBytes) {
        throw new RemoteRelayError("sync_account_quota_exceeded", "The account synchronized-data quota would be exceeded");
      }
      db.connection.prepare(`
        INSERT INTO remote_sync_documents(
          pairing_id, document_kind, version, content_json, content_bytes,
          updated_by_device_id, updated_at
        ) VALUES (?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(pairing_id, document_kind) DO UPDATE SET
          version = remote_sync_documents.version + 1,
          content_json = excluded.content_json,
          content_bytes = excluded.content_bytes,
          updated_by_device_id = excluded.updated_by_device_id,
          updated_at = excluded.updated_at
      `).run(sender.pairingId, snapshot.kind, contentJson, contentBytes, sender.deviceId, updatedAt);
      return requireSyncDocument(db, sender.pairingId, snapshot.kind);
    });
  }

  function listSyncSnapshots(accessToken: string): {
    readonly documents: readonly RelaySyncDocument[];
    readonly usageBytes: number;
    readonly accountQuotaBytes: number;
    readonly documentQuotaBytes: number;
  } {
    const auth = authenticate(accessToken);
    const rows = db.connection.prepare(`
      SELECT document_kind AS kind, version, content_json AS contentJson,
             content_bytes AS bytes, updated_at AS updatedAt
      FROM remote_sync_documents WHERE pairing_id = ? ORDER BY document_kind
    `).all(auth.pairingId) as unknown as readonly SyncDocumentRow[];
    const documents = rows.map(syncDocumentFromRow);
    return {
      documents,
      usageBytes: documents.reduce((total, document) => total + document.bytes, 0),
      accountQuotaBytes,
      documentQuotaBytes,
    };
  }

  return {
    createPairing,
    joinPairing,
    pairingStatus,
    confirmPairing,
    issueDeviceToken,
    authenticate,
    listDevices,
    revokeDevice,
    saveSyncSnapshot,
    listSyncSnapshots,
  };
}

type PairingRow = {
  readonly pairingId: string;
  readonly pairingCode: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly completedAt: string | null;
};

type DeviceRow = {
  readonly deviceId: string;
  readonly pairingId: string;
  readonly role: RemoteDeviceRole;
  readonly name: string;
  readonly confirmedAt: string | null;
  readonly revokedAt: string | null;
};

type DeviceAuthRow = DeviceRow & { readonly completedAt: string | null };

type RevocationCallerRow = {
  readonly pairingId: string;
  readonly revokedAt: string | null;
  readonly completedAt: string | null;
};

type SyncDocumentRow = {
  readonly kind: RemoteSyncSnapshot["kind"];
  readonly version: number;
  readonly contentJson: string;
  readonly bytes: number;
  readonly updatedAt: string;
};

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function normalizedDeviceName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 160) throw new Error("Device names must contain 1 to 160 characters");
  return name;
}

function positiveQuota(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Relay ${label} quota must be a positive safe integer`);
  return value;
}

function seedInvitations(database: SqliteRuntimeDatabase, invitationCodes: readonly string[]): void {
  if (invitationCodes.length > 10_000) throw new Error("Relay invitation configuration is too large");
  const insert = database.connection.prepare(`
    INSERT OR IGNORE INTO remote_invitations(code_hash) VALUES (?)
  `);
  database.transaction(() => {
    for (const code of invitationCodes) insert.run(hashSecret(normalizedInvitationCode(code)));
  });
}

function invitationCodeHash(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new RemoteRelayError("invitation_required", "An invitation code is required to create an account");
  }
  return hashSecret(normalizedInvitationCode(value));
}

function normalizedInvitationCode(value: string): string {
  const code = value.trim();
  if (code.length < 8 || code.length > 128) {
    throw new RemoteRelayError("invitation_invalid_or_claimed", "The invitation code is invalid or has already been used");
  }
  return code;
}

function unusedPairingCode(factory: () => string, database: SqliteRuntimeDatabase): string {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const code = factory();
    if (!/^\d{6}$/u.test(code)) throw new Error("Pairing codes must contain exactly six digits");
    const existing = database.connection.prepare("SELECT 1 FROM remote_pairings WHERE pairing_code = ?").get(code);
    if (existing === undefined) return code;
  }
  throw new Error("Could not allocate a unique pairing code");
}

function insertDevice(database: SqliteRuntimeDatabase, input: {
  readonly deviceId: string;
  readonly pairingId: string;
  readonly role: RemoteDeviceRole;
  readonly name: string;
  readonly claimHash: string;
  readonly createdAt: string;
}): void {
  database.connection.prepare(`
    INSERT INTO remote_devices(device_id, pairing_id, role, name, claim_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(input.deviceId, input.pairingId, input.role, input.name, input.claimHash, input.createdAt);
}

function pairingById(database: SqliteRuntimeDatabase, pairingId: string): PairingRow {
  const row = database.connection.prepare(`
    SELECT pairing_id AS pairingId, pairing_code AS pairingCode, created_at AS createdAt,
           expires_at AS expiresAt, completed_at AS completedAt
    FROM remote_pairings WHERE pairing_id = ?
  `).get(pairingId) as PairingRow | undefined;
  if (row === undefined) throw new RemoteRelayError("pairing_not_found", "The pairing was not found");
  return row;
}

function pairingByCode(database: SqliteRuntimeDatabase, pairingCode: string): PairingRow {
  const row = database.connection.prepare(`
    SELECT pairing_id AS pairingId, pairing_code AS pairingCode, created_at AS createdAt,
           expires_at AS expiresAt, completed_at AS completedAt
    FROM remote_pairings WHERE pairing_code = ?
  `).get(pairingCode) as PairingRow | undefined;
  if (row === undefined) throw new RemoteRelayError("pairing_not_found", "The pairing code was not found");
  return row;
}

function requireActivePairing(pairing: PairingRow, at: Date, allowCompleted = false): void {
  if (at.getTime() >= Date.parse(pairing.expiresAt)) {
    throw new RemoteRelayError("pairing_expired", "The pairing code has expired");
  }
  if (!allowCompleted && pairing.completedAt !== null) {
    throw new RemoteRelayError("pairing_already_joined", "The pairing is already complete");
  }
}

function deviceByRole(
  database: SqliteRuntimeDatabase,
  pairingId: string,
  role: RemoteDeviceRole,
): DeviceRow | undefined {
  return database.connection.prepare(`
    SELECT device_id AS deviceId, pairing_id AS pairingId, role, name,
           confirmed_at AS confirmedAt, revoked_at AS revokedAt
    FROM remote_devices WHERE pairing_id = ? AND role = ?
  `).get(pairingId, role) as DeviceRow | undefined;
}

function devicesForPairing(
  database: SqliteRuntimeDatabase,
  pairingId: string,
  includeRevoked: boolean,
): readonly DeviceRow[] {
  return database.connection.prepare(`
    SELECT device_id AS deviceId, pairing_id AS pairingId, role, name,
           confirmed_at AS confirmedAt, revoked_at AS revokedAt
    FROM remote_devices
    WHERE pairing_id = ? ${includeRevoked ? "" : "AND revoked_at IS NULL"}
    ORDER BY created_at
  `).all(pairingId) as unknown as readonly DeviceRow[];
}

function claimDevice(database: SqliteRuntimeDatabase, pairingId: string, claimSecret: string): DeviceRow {
  const row = database.connection.prepare(`
    SELECT device_id AS deviceId, pairing_id AS pairingId, role, name,
           confirmed_at AS confirmedAt, revoked_at AS revokedAt
    FROM remote_devices WHERE pairing_id = ? AND claim_hash = ?
  `).get(pairingId, hashSecret(claimSecret)) as DeviceRow | undefined;
  if (row === undefined) throw new RemoteRelayError("invalid_claim", "The pairing claim is invalid");
  if (row.revokedAt !== null) throw new RemoteRelayError("device_revoked", "The device has been revoked");
  return row;
}

function peerDevice(
  database: SqliteRuntimeDatabase,
  pairingId: string,
  localDeviceId: string,
  includeRevoked: boolean,
): DeviceRow | undefined {
  return devicesForPairing(database, pairingId, includeRevoked)
    .find((device) => device.deviceId !== localDeviceId && (includeRevoked || device.revokedAt === null));
}

function requireSyncDocument(
  database: SqliteRuntimeDatabase,
  pairingId: string,
  kind: RemoteSyncSnapshot["kind"],
): RelaySyncDocument {
  const row = database.connection.prepare(`
    SELECT document_kind AS kind, version, content_json AS contentJson,
           content_bytes AS bytes, updated_at AS updatedAt
    FROM remote_sync_documents WHERE pairing_id = ? AND document_kind = ?
  `).get(pairingId, kind) as SyncDocumentRow | undefined;
  if (row === undefined) throw new Error(`Synchronized document ${kind} was not found after write`);
  return syncDocumentFromRow(row);
}

function syncDocumentFromRow(row: SyncDocumentRow): RelaySyncDocument {
  return {
    kind: row.kind,
    version: Number(row.version),
    bytes: Number(row.bytes),
    updatedAt: row.updatedAt,
    snapshot: parseRemoteSyncSnapshot(JSON.parse(row.contentJson) as unknown),
  };
}
