import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";

import type { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";

const HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]{2,31}$/u;

// This is a development-only clean break from the first pairing-as-account model.
// No user content is migrated because the official relay is intentionally stateless for content.
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
      document_kind TEXT NOT NULL,
      version INTEGER NOT NULL,
      content_json TEXT NOT NULL,
      content_bytes INTEGER NOT NULL,
      updated_by_device_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(pairing_id, document_kind)
    ) STRICT;
  `,
}, {
  version: 2,
  sql: `DROP TABLE IF EXISTS remote_messages;`,
}, {
  version: 3,
  sql: `CREATE TABLE IF NOT EXISTS remote_invitations (code_hash TEXT PRIMARY KEY, claimed_pairing_id TEXT, claimed_at TEXT) STRICT;`,
}, {
  version: 4,
  sql: `
    DROP TABLE IF EXISTS remote_sync_documents;
    DROP TABLE IF EXISTS remote_devices;
    DROP TABLE IF EXISTS remote_invitations;
    DROP TABLE IF EXISTS remote_pairings;

    CREATE TABLE remote_accounts (
      account_id TEXT PRIMARY KEY,
      handle TEXT NOT NULL COLLATE NOCASE UNIQUE,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE remote_invitations (
      code_hash TEXT PRIMARY KEY,
      claimed_account_id TEXT REFERENCES remote_accounts(account_id),
      claimed_at TEXT
    ) STRICT;

    CREATE TABLE remote_devices (
      device_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES remote_accounts(account_id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('desktop', 'mobile')),
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      approved_at TEXT,
      revoked_at TEXT,
      last_seen_at TEXT,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX remote_active_device_role
      ON remote_devices(account_id, role) WHERE revoked_at IS NULL AND approved_at IS NOT NULL;

    CREATE TABLE remote_pairing_sessions (
      pairing_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES remote_accounts(account_id) ON DELETE CASCADE,
      initiator_device_id TEXT NOT NULL REFERENCES remote_devices(device_id) ON DELETE CASCADE,
      mobile_device_id TEXT REFERENCES remote_devices(device_id) ON DELETE SET NULL,
      pairing_code TEXT NOT NULL UNIQUE,
      claim_hash TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      approved_at TEXT,
      rejected_at TEXT,
      completed_at TEXT
    ) STRICT;
  `,
}] as const;

export type RelayAccountProfile = {
  readonly accountId: string;
  readonly handle: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type RelayDeviceRole = "desktop" | "mobile";

export type RelayDeviceCredential = {
  readonly account: RelayAccountProfile;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly role: RelayDeviceRole;
  readonly accessToken: string;
};

export type RelayPairingSessionClaim = {
  readonly pairingId: string;
  readonly pairingCode: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly role: "mobile";
  readonly claimSecret: string;
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly account: RelayAccountProfile;
};

export type RelayPairingSessionStatus = {
  readonly pairingId: string;
  readonly pairingCode: string;
  readonly status: "waiting_for_mobile" | "waiting_for_approval" | "paired" | "expired" | "rejected";
  readonly expiresAt: string;
  readonly mobile?: { readonly deviceId: string; readonly deviceName: string };
  readonly desktop: { readonly deviceId: string; readonly deviceName: string };
  readonly account: RelayAccountProfile;
};

export type RelayAuthenticatedDevice = {
  readonly account: RelayAccountProfile;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly role: RelayDeviceRole;
  readonly peerDeviceId?: string;
  readonly peerDeviceName?: string;
};

export class RemoteRelayError extends Error {
  readonly name = "RemoteRelayError";

  constructor(
    readonly code:
      | "account_not_found"
      | "account_handle_taken"
      | "account_handle_invalid"
      | "activation_required"
      | "invitation_required"
      | "invitation_invalid_or_claimed"
      | "pairing_not_found"
      | "pairing_expired"
      | "pairing_code_mismatch"
      | "pairing_already_joined"
      | "pairing_not_approved"
      | "pairing_rejected"
      | "invalid_claim"
      | "invalid_device_token"
      | "device_limit_reached"
      | "device_revoked"
      | "peer_unavailable",
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
  const allowOpenSignup = input.allowOpenSignup ?? false;
  const db = input.database;
  db.migrate("remote-relay", RELAY_MIGRATIONS);
  seedInvitations(db, input.invitationCodes ?? []);

  function activateAccount(deviceName: string, invitationCode?: string): RelayDeviceCredential {
    const at = now().toISOString();
    const normalizedDeviceName = normalizeDeviceName(deviceName);
    const invitationHash = invitationCodeHash(invitationCode);
    if (!allowOpenSignup && invitationHash === undefined) {
      throw new RemoteRelayError("invitation_required", "An invitation code is required to create an account");
    }
    const accountId = idFactory();
    const deviceId = idFactory();
    const accountHandle = defaultHandle(accountId);
    const displayName = normalizedDeviceName;
    const accessToken = secretFactory();
    db.transaction(() => {
      db.connection.prepare(`
        INSERT INTO remote_accounts(account_id, handle, display_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(accountId, accountHandle, displayName, at, at);
      if (invitationHash !== undefined) {
        const claimed = db.connection.prepare(`
          UPDATE remote_invitations SET claimed_account_id = ?, claimed_at = ?
          WHERE code_hash = ? AND claimed_account_id IS NULL
        `).run(accountId, at, invitationHash);
        if (claimed.changes !== 1) {
          throw new RemoteRelayError("invitation_invalid_or_claimed", "The invitation code is invalid or has already been used");
        }
      }
      db.connection.prepare(`
        INSERT INTO remote_devices(device_id, account_id, role, name, token_hash, approved_at, created_at)
        VALUES (?, ?, 'desktop', ?, ?, ?, ?)
      `).run(deviceId, accountId, normalizedDeviceName, hashSecret(accessToken), at, at);
    });
    return {
      account: accountFromId(db, accountId),
      deviceId,
      deviceName: normalizedDeviceName,
      role: "desktop",
      accessToken,
    };
  }

  function authenticate(accessToken: string): RelayAuthenticatedDevice {
    const row = db.connection.prepare(`
      SELECT d.device_id AS deviceId, d.account_id AS accountId, d.role, d.name AS deviceName,
             d.approved_at AS approvedAt, d.revoked_at AS revokedAt,
             a.handle, a.display_name AS displayName, a.created_at AS accountCreatedAt, a.updated_at AS accountUpdatedAt
      FROM remote_devices d JOIN remote_accounts a ON a.account_id = d.account_id
      WHERE d.token_hash = ?
    `).get(hashSecret(accessToken)) as AuthRow | undefined;
    if (row === undefined) throw new RemoteRelayError("invalid_device_token", "The device token is invalid");
    if (row.revokedAt !== null) throw new RemoteRelayError("device_revoked", "The device has been revoked");
    if (row.approvedAt === null) throw new RemoteRelayError("pairing_not_approved", "The device pairing has not been approved");
    const at = now().toISOString();
    db.connection.prepare("UPDATE remote_devices SET last_seen_at = ? WHERE device_id = ?").run(at, row.deviceId);
    const peer = activePeer(db, row.accountId, row.deviceId);
    return {
      account: accountFromAuthRow(row),
      deviceId: row.deviceId,
      deviceName: row.deviceName,
      role: row.role,
      ...(peer === undefined ? {} : { peerDeviceId: peer.deviceId, peerDeviceName: peer.deviceName }),
    };
  }

  function updateAccountHandle(accessToken: string, handle: string): RelayAccountProfile {
    const auth = authenticate(accessToken);
    const normalized = normalizeHandle(handle);
    const at = now().toISOString();
    try {
      db.connection.prepare("UPDATE remote_accounts SET handle = ?, updated_at = ? WHERE account_id = ?")
        .run(normalized, at, auth.account.accountId);
    } catch (error) {
      if (isUniqueViolation(error)) throw new RemoteRelayError("account_handle_taken", "This account handle is already in use");
      throw error;
    }
    return accountFromId(db, auth.account.accountId);
  }

  function createPairingSession(accessToken: string): {
    readonly pairingId: string;
    readonly pairingCode: string;
    readonly expiresAt: string;
  } {
    const auth = authenticate(accessToken);
    if (auth.role !== "desktop") throw new RemoteRelayError("activation_required", "Only the desktop device can add a phone");
    if (activePeer(db, auth.account.accountId, auth.deviceId) !== undefined) {
      throw new RemoteRelayError("device_limit_reached", "This account already has an active phone");
    }
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + pairingTtlMs);
    const pairingId = idFactory();
    const pairingCode = unusedPairingCode(codeFactory, db);
    db.connection.prepare(`
      UPDATE remote_pairing_sessions SET rejected_at = ?
      WHERE account_id = ? AND approved_at IS NULL AND rejected_at IS NULL
    `).run(createdAt.toISOString(), auth.account.accountId);
    db.connection.prepare(`
      INSERT INTO remote_pairing_sessions(pairing_id, account_id, initiator_device_id, pairing_code, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(pairingId, auth.account.accountId, auth.deviceId, pairingCode, createdAt.toISOString(), expiresAt.toISOString());
    return { pairingId, pairingCode, expiresAt: expiresAt.toISOString() };
  }

  function joinPairing(pairingCode: string, deviceName: string): RelayPairingSessionClaim {
    const at = now();
    const session = activePairingByCode(db, pairingCode);
    requirePairingActive(session, at);
    if (session.mobileDeviceId !== null) throw new RemoteRelayError("pairing_already_joined", "This pairing code already has a phone");
    if (activePeer(db, session.accountId, session.initiatorDeviceId) !== undefined) {
      throw new RemoteRelayError("device_limit_reached", "This account already has an active phone");
    }
    const normalizedDeviceName = normalizeDeviceName(deviceName);
    const deviceId = idFactory();
    const claimSecret = secretFactory();
    const accessToken = secretFactory();
    db.transaction(() => {
      db.connection.prepare(`
        INSERT INTO remote_devices(device_id, account_id, role, name, token_hash, created_at)
        VALUES (?, ?, 'mobile', ?, ?, ?)
      `).run(deviceId, session.accountId, normalizedDeviceName, hashSecret(accessToken), at.toISOString());
      db.connection.prepare(`
        UPDATE remote_pairing_sessions SET mobile_device_id = ?, claim_hash = ? WHERE pairing_id = ?
      `).run(deviceId, hashSecret(claimSecret), session.pairingId);
    });
    return {
      pairingId: session.pairingId,
      pairingCode: session.pairingCode,
      deviceId,
      deviceName: normalizedDeviceName,
      role: "mobile",
      claimSecret,
      accessToken,
      expiresAt: session.expiresAt,
      account: accountFromId(db, session.accountId),
    };
  }

  function pairingStatusForDesktop(accessToken: string, pairingId: string): RelayPairingSessionStatus {
    const auth = authenticate(accessToken);
    const session = pairingById(db, pairingId);
    if (session.accountId !== auth.account.accountId || session.initiatorDeviceId !== auth.deviceId) {
      throw new RemoteRelayError("pairing_not_found", "The pairing session was not found");
    }
    return pairingStatusFromRow(db, session, now());
  }

  function pairingStatusForMobile(pairingId: string, claimSecret: string): RelayPairingSessionStatus {
    const session = pairingById(db, pairingId);
    if (session.claimHash === null || session.claimHash !== hashSecret(claimSecret)) {
      throw new RemoteRelayError("invalid_claim", "The pairing claim is invalid");
    }
    return pairingStatusFromRow(db, session, now());
  }

  function approvePairing(accessToken: string, pairingId: string, pairingCode: string): RelayPairingSessionStatus {
    const auth = authenticate(accessToken);
    if (auth.role !== "desktop") throw new RemoteRelayError("activation_required", "Only the desktop can approve a phone");
    const session = pairingById(db, pairingId);
    requirePairingActive(session, now());
    if (session.accountId !== auth.account.accountId || session.initiatorDeviceId !== auth.deviceId) {
      throw new RemoteRelayError("pairing_not_found", "The pairing session was not found");
    }
    if (session.pairingCode !== pairingCode) throw new RemoteRelayError("pairing_code_mismatch", "The pairing code does not match");
    if (session.mobileDeviceId === null) throw new RemoteRelayError("pairing_not_approved", "A phone has not joined this pairing yet");
    const at = now().toISOString();
    db.transaction(() => {
      db.connection.prepare("UPDATE remote_devices SET approved_at = ? WHERE device_id = ? AND revoked_at IS NULL")
        .run(at, session.mobileDeviceId);
      db.connection.prepare("UPDATE remote_pairing_sessions SET approved_at = ?, completed_at = ? WHERE pairing_id = ?")
        .run(at, at, pairingId);
    });
    return pairingStatusFromRow(db, pairingById(db, pairingId), now());
  }

  function listDevices(accessToken: string) {
    const auth = authenticate(accessToken);
    return (db.connection.prepare(`
      SELECT device_id AS deviceId, name AS deviceName, role, approved_at AS approvedAt,
             revoked_at AS revokedAt, last_seen_at AS lastSeenAt
      FROM remote_devices WHERE account_id = ? ORDER BY created_at
    `).all(auth.account.accountId) as unknown as readonly DeviceListRow[]).map((device) => ({
      ...device,
      current: device.deviceId === auth.deviceId,
      ...(device.approvedAt === null ? {} : { approvedAt: device.approvedAt }),
      ...(device.revokedAt === null ? {} : { revokedAt: device.revokedAt }),
      ...(device.lastSeenAt === null ? {} : { lastSeenAt: device.lastSeenAt }),
    }));
  }

  function revokeDevice(accessToken: string, targetDeviceId: string): void {
    const auth = authenticate(accessToken);
    const target = db.connection.prepare("SELECT account_id AS accountId FROM remote_devices WHERE device_id = ?")
      .get(targetDeviceId) as { accountId: string } | undefined;
    if (target?.accountId !== auth.account.accountId) throw new RemoteRelayError("peer_unavailable", "The target device is not in this account");
    db.connection.prepare("UPDATE remote_devices SET revoked_at = COALESCE(revoked_at, ?), token_hash = ? WHERE device_id = ?")
      .run(now().toISOString(), hashSecret(`revoked:${idFactory()}`), targetDeviceId);
    db.connection.prepare("UPDATE remote_pairing_sessions SET rejected_at = COALESCE(rejected_at, ?) WHERE mobile_device_id = ? AND completed_at IS NULL")
      .run(now().toISOString(), targetDeviceId);
  }

  return {
    activateAccount,
    authenticate,
    updateAccountHandle,
    createPairingSession,
    joinPairing,
    pairingStatusForDesktop,
    pairingStatusForMobile,
    approvePairing,
    listDevices,
    revokeDevice,
  };
}

type PairingRow = {
  readonly pairingId: string;
  readonly accountId: string;
  readonly initiatorDeviceId: string;
  readonly mobileDeviceId: string | null;
  readonly pairingCode: string;
  readonly claimHash: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly approvedAt: string | null;
  readonly rejectedAt: string | null;
  readonly completedAt: string | null;
};

type AuthRow = {
  readonly deviceId: string;
  readonly accountId: string;
  readonly role: RelayDeviceRole;
  readonly deviceName: string;
  readonly approvedAt: string | null;
  readonly revokedAt: string | null;
  readonly handle: string;
  readonly displayName: string;
  readonly accountCreatedAt: string;
  readonly accountUpdatedAt: string;
};

type DeviceListRow = {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly role: RelayDeviceRole;
  readonly approvedAt: string | null;
  readonly revokedAt: string | null;
  readonly lastSeenAt: string | null;
};

function accountFromId(database: SqliteRuntimeDatabase, accountId: string): RelayAccountProfile {
  const row = database.connection.prepare(`
    SELECT account_id AS accountId, handle, display_name AS displayName, created_at AS createdAt, updated_at AS updatedAt
    FROM remote_accounts WHERE account_id = ?
  `).get(accountId) as RelayAccountProfile | undefined;
  if (row === undefined) throw new RemoteRelayError("account_not_found", "The account was not found");
  return row;
}

function accountFromAuthRow(row: AuthRow): RelayAccountProfile {
  return {
    accountId: row.accountId,
    handle: row.handle,
    displayName: row.displayName,
    createdAt: row.accountCreatedAt,
    updatedAt: row.accountUpdatedAt,
  };
}

function activePeer(database: SqliteRuntimeDatabase, accountId: string, deviceId: string): { readonly deviceId: string; readonly deviceName: string } | undefined {
  return database.connection.prepare(`
    SELECT device_id AS deviceId, name AS deviceName FROM remote_devices
    WHERE account_id = ? AND device_id <> ? AND revoked_at IS NULL AND approved_at IS NOT NULL
    ORDER BY created_at LIMIT 1
  `).get(accountId, deviceId) as { readonly deviceId: string; readonly deviceName: string } | undefined;
}

function pairingById(database: SqliteRuntimeDatabase, pairingId: string): PairingRow {
  const row = database.connection.prepare(`
    SELECT pairing_id AS pairingId, account_id AS accountId, initiator_device_id AS initiatorDeviceId,
           mobile_device_id AS mobileDeviceId, pairing_code AS pairingCode, claim_hash AS claimHash,
           created_at AS createdAt, expires_at AS expiresAt, approved_at AS approvedAt,
           rejected_at AS rejectedAt, completed_at AS completedAt
    FROM remote_pairing_sessions WHERE pairing_id = ?
  `).get(pairingId) as PairingRow | undefined;
  if (row === undefined) throw new RemoteRelayError("pairing_not_found", "The pairing session was not found");
  return row;
}

function activePairingByCode(database: SqliteRuntimeDatabase, pairingCode: string): PairingRow {
  const row = database.connection.prepare(`
    SELECT pairing_id AS pairingId, account_id AS accountId, initiator_device_id AS initiatorDeviceId,
           mobile_device_id AS mobileDeviceId, pairing_code AS pairingCode, claim_hash AS claimHash,
           created_at AS createdAt, expires_at AS expiresAt, approved_at AS approvedAt,
           rejected_at AS rejectedAt, completed_at AS completedAt
    FROM remote_pairing_sessions WHERE pairing_code = ?
  `).get(pairingCode) as PairingRow | undefined;
  if (row === undefined) throw new RemoteRelayError("pairing_not_found", "The pairing session was not found");
  return row;
}

function pairingStatusFromRow(database: SqliteRuntimeDatabase, row: PairingRow, at: Date): RelayPairingSessionStatus {
  const expired = at.getTime() >= Date.parse(row.expiresAt);
  const status = row.rejectedAt !== null ? "rejected" as const
    : expired && row.completedAt === null ? "expired" as const
      : row.completedAt !== null ? "paired" as const
        : row.mobileDeviceId !== null ? "waiting_for_approval" as const
          : "waiting_for_mobile" as const;
  const mobile = row.mobileDeviceId === null ? undefined : database.connection.prepare(
    "SELECT device_id AS deviceId, name AS deviceName FROM remote_devices WHERE device_id = ?",
  ).get(row.mobileDeviceId) as { readonly deviceId: string; readonly deviceName: string } | undefined;
  const desktop = database.connection.prepare(
    "SELECT device_id AS deviceId, name AS deviceName FROM remote_devices WHERE device_id = ?",
  ).get(row.initiatorDeviceId) as { readonly deviceId: string; readonly deviceName: string } | undefined;
  if (desktop === undefined) throw new RemoteRelayError("pairing_not_found", "The pairing desktop is unavailable");
  return {
    pairingId: row.pairingId,
    pairingCode: row.pairingCode,
    status,
    expiresAt: row.expiresAt,
    ...(mobile === undefined ? {} : { mobile }),
    desktop,
    account: accountFromId(database, row.accountId),
  };
}

function requirePairingActive(row: PairingRow, at: Date): void {
  if (row.rejectedAt !== null) throw new RemoteRelayError("pairing_rejected", "The pairing session was rejected");
  if (row.completedAt !== null) throw new RemoteRelayError("pairing_already_joined", "The pairing session is already complete");
  if (at.getTime() >= Date.parse(row.expiresAt)) throw new RemoteRelayError("pairing_expired", "The pairing session has expired");
}

function seedInvitations(database: SqliteRuntimeDatabase, codes: readonly string[]): void {
  const statement = database.connection.prepare("INSERT OR IGNORE INTO remote_invitations(code_hash) VALUES (?)");
  for (const code of codes) {
    const normalized = code.trim();
    if (normalized.length > 0) statement.run(hashSecret(normalized));
  }
}

function invitationCodeHash(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : hashSecret(normalized);
}

function normalizeDeviceName(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 160) throw new Error("Device names must contain 1 to 160 characters");
  return normalized;
}

function normalizeHandle(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!HANDLE_PATTERN.test(normalized)) throw new RemoteRelayError("account_handle_invalid", "Account handles must be 3-32 lowercase letters, numbers, _ or -");
  return normalized;
}

function defaultHandle(accountId: string): string {
  return `user-${accountId.replace(/[^a-z0-9]/giu, "").slice(0, 12).toLowerCase()}`;
}

function unusedPairingCode(factory: () => string, database: SqliteRuntimeDatabase): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const code = factory();
    if (/^\d{6}$/u.test(code) && database.connection.prepare("SELECT 1 FROM remote_pairing_sessions WHERE pairing_code = ?").get(code) === undefined) return code;
  }
  throw new Error("Could not allocate a unique pairing code");
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /unique constraint failed/iu.test(error.message);
}
