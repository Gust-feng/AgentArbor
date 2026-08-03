import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";

import type { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import {
  REMOTE_COLLABORATION_PROTOCOL_VERSION,
  parseRemoteMessageContent,
  type RemoteDeviceRole,
  type RemoteMessageContent,
  type RemoteRelayMessage,
} from "./protocol.js";

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
      last_ack_sequence INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(pairing_id, role)
    ) STRICT;

    CREATE TABLE remote_messages (
      message_id TEXT PRIMARY KEY,
      client_message_id TEXT NOT NULL,
      pairing_id TEXT NOT NULL REFERENCES remote_pairings(pairing_id) ON DELETE CASCADE,
      sender_device_id TEXT NOT NULL REFERENCES remote_devices(device_id),
      target_device_id TEXT NOT NULL REFERENCES remote_devices(device_id),
      sequence INTEGER NOT NULL,
      content_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      acked_at TEXT,
      UNIQUE(sender_device_id, client_message_id),
      UNIQUE(target_device_id, sequence)
    ) STRICT;

    CREATE INDEX remote_messages_pending_idx
      ON remote_messages(target_device_id, sequence) WHERE acked_at IS NULL;
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
  readonly lastAckSequence: number;
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
      | "message_id_conflict"
      | "invalid_ack_cursor",
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
};

export type RemoteRelayStore = ReturnType<typeof createRemoteRelayStore>;

export function createRemoteRelayStore(input: CreateRemoteRelayStoreInput) {
  const now = input.now ?? (() => new Date());
  const idFactory = input.idFactory ?? randomUUID;
  const secretFactory = input.secretFactory ?? (() => randomBytes(32).toString("base64url"));
  const codeFactory = input.codeFactory ?? (() => randomInt(0, 1_000_000).toString().padStart(6, "0"));
  const pairingTtlMs = input.pairingTtlMs ?? 10 * 60 * 1_000;
  const db = input.database;
  db.migrate("remote-relay", RELAY_MIGRATIONS);

  function createPairing(deviceName: string): RelayPairingClaim {
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + pairingTtlMs);
    const pairingId = idFactory();
    const deviceId = idFactory();
    const claimSecret = secretFactory();
    const pairingCode = unusedPairingCode(codeFactory, db);
    db.transaction(() => {
      db.connection.prepare(`
        INSERT INTO remote_pairings(pairing_id, pairing_code, created_at, expires_at)
        VALUES (?, ?, ?, ?)
      `).run(pairingId, pairingCode, createdAt.toISOString(), expiresAt.toISOString());
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
             d.revoked_at AS revokedAt, d.last_ack_sequence AS lastAckSequence,
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
      lastAckSequence: Number(row.lastAckSequence),
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

  function enqueueMessage(
    sender: RelayAuthenticatedDevice,
    clientMessageId: string,
    rawContent: unknown,
  ): RemoteRelayMessage {
    const content = parseRemoteMessageContent(rawContent);
    const contentJson = JSON.stringify(content);
    const existing = messageByClientId(db, sender.deviceId, clientMessageId);
    if (existing !== undefined) {
      if (existing.contentJson !== contentJson) {
        throw new RemoteRelayError("message_id_conflict", "The client message id was already used with different content");
      }
      return relayMessageFromRow(existing);
    }
    const createdAt = now().toISOString();
    const messageId = idFactory();
    return db.transaction(() => {
      const peer = peerDevice(db, sender.pairingId, sender.deviceId, false);
      if (peer === undefined || peer.deviceId !== sender.peerDeviceId) {
        throw new RemoteRelayError("peer_unavailable", "The paired device is unavailable or revoked");
      }
      const sequenceRow = db.connection.prepare(`
        SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM remote_messages WHERE target_device_id = ?
      `).get(peer.deviceId) as { sequence: number };
      const sequence = Number(sequenceRow.sequence);
      db.connection.prepare(`
        INSERT INTO remote_messages(
          message_id, client_message_id, pairing_id, sender_device_id,
          target_device_id, sequence, content_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(messageId, clientMessageId, sender.pairingId, sender.deviceId, peer.deviceId, sequence, contentJson, createdAt);
      return {
        protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
        messageId,
        clientMessageId,
        sequence,
        sourceDeviceId: sender.deviceId,
        targetDeviceId: peer.deviceId,
        createdAt,
        content,
      };
    });
  }

  function pendingMessages(deviceId: string, afterSequence: number, limit = 256): readonly RemoteRelayMessage[] {
    const boundedLimit = Math.max(1, Math.min(256, Math.floor(limit)));
    const rows = db.connection.prepare(`
      SELECT message_id AS messageId, client_message_id AS clientMessageId,
             sender_device_id AS sourceDeviceId, target_device_id AS targetDeviceId,
             sequence, content_json AS contentJson, created_at AS createdAt
      FROM remote_messages
      WHERE target_device_id = ? AND sequence > ? AND acked_at IS NULL
      ORDER BY sequence ASC LIMIT ?
    `).all(deviceId, afterSequence, boundedLimit) as unknown as readonly MessageRow[];
    return rows.map(relayMessageFromRow);
  }

  function acknowledge(deviceId: string, sequence: number): number {
    const cursor = Math.max(0, Math.floor(sequence));
    const maxRow = db.connection.prepare(`
      SELECT COALESCE(MAX(sequence), 0) AS maxSequence FROM remote_messages WHERE target_device_id = ?
    `).get(deviceId) as { maxSequence: number };
    if (cursor > Number(maxRow.maxSequence)) {
      throw new RemoteRelayError("invalid_ack_cursor", "The acknowledgement cursor is ahead of the relay sequence");
    }
    return db.transaction(() => {
      db.connection.prepare(`
        UPDATE remote_devices
        SET last_ack_sequence = MAX(last_ack_sequence, ?)
        WHERE device_id = ? AND revoked_at IS NULL
      `).run(cursor, deviceId);
      db.connection.prepare(`
        UPDATE remote_messages SET acked_at = COALESCE(acked_at, ?)
        WHERE target_device_id = ? AND sequence <= ?
      `).run(now().toISOString(), deviceId, cursor);
      const row = db.connection.prepare(`
        SELECT last_ack_sequence AS lastAckSequence FROM remote_devices WHERE device_id = ?
      `).get(deviceId) as { lastAckSequence: number };
      return Number(row.lastAckSequence);
    });
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
    enqueueMessage,
    pendingMessages,
    acknowledge,
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
  readonly lastAckSequence: number;
};

type DeviceAuthRow = DeviceRow & { readonly completedAt: string | null };

type RevocationCallerRow = {
  readonly pairingId: string;
  readonly revokedAt: string | null;
  readonly completedAt: string | null;
};

type MessageRow = {
  readonly messageId: string;
  readonly clientMessageId: string;
  readonly sourceDeviceId: string;
  readonly targetDeviceId: string;
  readonly sequence: number;
  readonly contentJson: string;
  readonly createdAt: string;
};

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function normalizedDeviceName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 160) throw new Error("Device names must contain 1 to 160 characters");
  return name;
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
           confirmed_at AS confirmedAt, revoked_at AS revokedAt,
           last_ack_sequence AS lastAckSequence
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
           confirmed_at AS confirmedAt, revoked_at AS revokedAt,
           last_ack_sequence AS lastAckSequence
    FROM remote_devices
    WHERE pairing_id = ? ${includeRevoked ? "" : "AND revoked_at IS NULL"}
    ORDER BY created_at
  `).all(pairingId) as unknown as readonly DeviceRow[];
}

function claimDevice(database: SqliteRuntimeDatabase, pairingId: string, claimSecret: string): DeviceRow {
  const row = database.connection.prepare(`
    SELECT device_id AS deviceId, pairing_id AS pairingId, role, name,
           confirmed_at AS confirmedAt, revoked_at AS revokedAt,
           last_ack_sequence AS lastAckSequence
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

function messageByClientId(
  database: SqliteRuntimeDatabase,
  senderDeviceId: string,
  clientMessageId: string,
): (MessageRow & { readonly contentJson: string }) | undefined {
  return database.connection.prepare(`
    SELECT message_id AS messageId, client_message_id AS clientMessageId,
           sender_device_id AS sourceDeviceId, target_device_id AS targetDeviceId,
           sequence, content_json AS contentJson, created_at AS createdAt
    FROM remote_messages WHERE sender_device_id = ? AND client_message_id = ?
  `).get(senderDeviceId, clientMessageId) as MessageRow | undefined;
}

function relayMessageFromRow(row: MessageRow): RemoteRelayMessage {
  return {
    protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
    messageId: row.messageId,
    clientMessageId: row.clientMessageId,
    sequence: Number(row.sequence),
    sourceDeviceId: row.sourceDeviceId,
    targetDeviceId: row.targetDeviceId,
    createdAt: row.createdAt,
    content: parseRemoteMessageContent(JSON.parse(row.contentJson) as unknown),
  };
}
