import type { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import { parseRemoteMessageContent, type RemoteMessageContent } from "./protocol.js";

const MIGRATIONS = [{
  version: 1,
  sql: `
    CREATE TABLE remote_desktop_pairing (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      relay_url TEXT NOT NULL,
      pairing_id TEXT NOT NULL,
      pairing_code TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      claim_secret TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE remote_desktop_binding (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      relay_url TEXT NOT NULL,
      device_id TEXT NOT NULL,
      peer_device_id TEXT,
      peer_device_name TEXT,
      last_inbox_sequence INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE remote_desktop_inbox (
      message_id TEXT PRIMARY KEY,
      command_id TEXT NOT NULL UNIQUE,
      sequence INTEGER NOT NULL UNIQUE,
      state TEXT NOT NULL CHECK(state IN ('applying', 'applied')),
      result_json TEXT,
      received_at TEXT NOT NULL,
      applied_at TEXT
    ) STRICT;

    CREATE TABLE remote_desktop_outbox (
      client_message_id TEXT PRIMARY KEY,
      content_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      accepted_at TEXT
    ) STRICT;

  `,
}, {
  version: 2,
  sql: `
    CREATE TABLE remote_shared_conversations (
      conversation_id TEXT PRIMARY KEY,
      shared_at TEXT NOT NULL
    ) STRICT;
  `,
}, {
  version: 3,
  sql: `
    DROP TABLE remote_desktop_inbox;

    CREATE TABLE remote_desktop_inbox (
      message_id TEXT PRIMARY KEY,
      command_id TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL CHECK(state IN ('applying', 'applied')),
      result_json TEXT,
      received_at TEXT NOT NULL,
      applied_at TEXT
    ) STRICT;
  `,
}, {
  version: 4,
  sql: `
    DROP TABLE remote_desktop_pairing;
    DROP TABLE remote_desktop_binding;
    DROP TABLE remote_shared_conversations;

    CREATE TABLE remote_desktop_pairing (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      relay_url TEXT NOT NULL,
      pairing_id TEXT NOT NULL,
      pairing_code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE remote_desktop_binding (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      relay_url TEXT NOT NULL,
      account_id TEXT NOT NULL,
      account_handle TEXT NOT NULL,
      display_name TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      peer_device_id TEXT,
      peer_device_name TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;
  `,
}, {
  version: 5,
  sql: `DROP TABLE IF EXISTS remote_notebook_map;`,
}, {
  version: 6,
  // The V1 snapshot envelope is no longer a valid wire message. Keep the
  // account/device binding, but never replay an obsolete side effect.
  sql: `DELETE FROM remote_desktop_outbox;`,
}] as const;

export type RemoteDesktopPairing = {
  readonly relayUrl: string;
  readonly pairingId: string;
  readonly pairingCode: string;
  readonly expiresAt: string;
  readonly updatedAt: string;
};

export type RemoteDesktopBinding = {
  readonly relayUrl: string;
  readonly accountId: string;
  readonly accountHandle: string;
  readonly displayName: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly peerDeviceId?: string;
  readonly peerDeviceName?: string;
  readonly updatedAt: string;
};

export type RemoteDesktopInboxEntry = {
  readonly messageId: string;
  readonly commandId: string;
  readonly state: "applying" | "applied";
  readonly result?: unknown;
  readonly receivedAt: string;
  readonly appliedAt?: string;
};

export function createRemoteDesktopStore(database: SqliteRuntimeDatabase) {
  database.migrate("remote-collaboration", MIGRATIONS);

  return {
    savePairing(pairing: RemoteDesktopPairing): void {
      database.connection.prepare(`
        INSERT INTO remote_desktop_pairing(
          singleton, relay_url, pairing_id, pairing_code, expires_at, updated_at
        ) VALUES (1, ?, ?, ?, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET
          relay_url = excluded.relay_url,
          pairing_id = excluded.pairing_id,
          pairing_code = excluded.pairing_code,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `).run(
        pairing.relayUrl,
        pairing.pairingId,
        pairing.pairingCode,
        pairing.expiresAt,
        pairing.updatedAt,
      );
    },
    getPairing(): RemoteDesktopPairing | undefined {
      const row = database.connection.prepare(`
        SELECT relay_url AS relayUrl, pairing_id AS pairingId, pairing_code AS pairingCode,
               expires_at AS expiresAt, updated_at AS updatedAt
        FROM remote_desktop_pairing WHERE singleton = 1
      `).get() as RemoteDesktopPairing | undefined;
      return row;
    },
    clearPairing(): void {
      database.connection.prepare("DELETE FROM remote_desktop_pairing WHERE singleton = 1").run();
    },
    saveBinding(binding: RemoteDesktopBinding): void {
      database.connection.prepare(`
        INSERT INTO remote_desktop_binding(
          singleton, relay_url, account_id, account_handle, display_name,
          device_id, device_name, peer_device_id, peer_device_name, updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET
          relay_url = excluded.relay_url,
          account_id = excluded.account_id,
          account_handle = excluded.account_handle,
          display_name = excluded.display_name,
          device_id = excluded.device_id,
          device_name = excluded.device_name,
          peer_device_id = excluded.peer_device_id,
          peer_device_name = excluded.peer_device_name,
          updated_at = excluded.updated_at
      `).run(
        binding.relayUrl,
        binding.accountId,
        binding.accountHandle,
        binding.displayName,
        binding.deviceId,
        binding.deviceName,
        binding.peerDeviceId ?? null,
        binding.peerDeviceName ?? null,
        binding.updatedAt,
      );
    },
    getBinding(): RemoteDesktopBinding | undefined {
      const row = database.connection.prepare(`
        SELECT relay_url AS relayUrl, account_id AS accountId, account_handle AS accountHandle,
               display_name AS displayName, device_id AS deviceId, device_name AS deviceName,
               peer_device_id AS peerDeviceId, peer_device_name AS peerDeviceName, updated_at AS updatedAt
        FROM remote_desktop_binding WHERE singleton = 1
      `).get() as {
        relayUrl: string;
        accountId: string;
        accountHandle: string;
        displayName: string;
        deviceId: string;
        deviceName: string;
        peerDeviceId: string | null;
        peerDeviceName: string | null;
        updatedAt: string;
      } | undefined;
      return row === undefined ? undefined : {
        relayUrl: row.relayUrl,
        accountId: row.accountId,
        accountHandle: row.accountHandle,
        displayName: row.displayName,
        deviceId: row.deviceId,
        deviceName: row.deviceName,
        ...(row.peerDeviceId === null ? {} : { peerDeviceId: row.peerDeviceId }),
        ...(row.peerDeviceName === null ? {} : { peerDeviceName: row.peerDeviceName }),
        updatedAt: row.updatedAt,
      };
    },
    clearBinding(): void {
      database.transaction(() => {
        database.connection.prepare("DELETE FROM remote_desktop_binding WHERE singleton = 1").run();
        database.connection.prepare("DELETE FROM remote_desktop_pairing WHERE singleton = 1").run();
        database.connection.prepare("DELETE FROM remote_desktop_inbox").run();
        database.connection.prepare("DELETE FROM remote_desktop_outbox").run();
      });
    },
    beginInbox(input: { messageId: string; commandId: string; receivedAt: string }): RemoteDesktopInboxEntry {
      database.connection.prepare(`
        INSERT OR IGNORE INTO remote_desktop_inbox(
          message_id, command_id, state, received_at
        ) VALUES (?, ?, 'applying', ?)
      `).run(input.messageId, input.commandId, input.receivedAt);
      return requireInbox(database, input.messageId, input.commandId);
    },
    completeInbox(messageId: string, result: unknown, appliedAt: string): RemoteDesktopInboxEntry {
      return database.transaction(() => {
        database.connection.prepare(`
          UPDATE remote_desktop_inbox
          SET state = 'applied', result_json = ?, applied_at = ?
          WHERE message_id = ?
        `).run(JSON.stringify(result), appliedAt, messageId);
        const entry = requireInbox(database, messageId);
        return entry;
      });
    },
    getInbox(messageId: string): RemoteDesktopInboxEntry | undefined {
      return inboxRow(database, messageId);
    },
    enqueueOutbox(clientMessageId: string, content: RemoteMessageContent, createdAt: string): void {
      const contentJson = JSON.stringify(parseRemoteMessageContent(content));
      const existing = database.connection.prepare(`
        SELECT content_json AS contentJson FROM remote_desktop_outbox WHERE client_message_id = ?
      `).get(clientMessageId) as { contentJson: string } | undefined;
      if (existing !== undefined && existing.contentJson !== contentJson) {
        throw new Error(`Remote outbox id ${clientMessageId} was already used with different content`);
      }
      database.connection.prepare(`
        INSERT OR IGNORE INTO remote_desktop_outbox(client_message_id, content_json, created_at)
        VALUES (?, ?, ?)
      `).run(clientMessageId, contentJson, createdAt);
    },
    pendingOutbox(limit = 256): readonly { clientMessageId: string; content: RemoteMessageContent }[] {
      const rows = database.connection.prepare(`
        SELECT client_message_id AS clientMessageId, content_json AS contentJson
        FROM remote_desktop_outbox WHERE accepted_at IS NULL
        ORDER BY created_at ASC LIMIT ?
      `).all(Math.max(1, Math.min(256, Math.floor(limit)))) as unknown as readonly {
        clientMessageId: string;
        contentJson: string;
      }[];
      return rows.map((row) => ({
        clientMessageId: row.clientMessageId,
        content: parseRemoteMessageContent(JSON.parse(row.contentJson) as unknown),
      }));
    },
    acceptOutbox(clientMessageId: string, _acceptedAt: string): void {
      database.connection.prepare(`
        DELETE FROM remote_desktop_outbox WHERE client_message_id = ?
      `).run(clientMessageId);
    },
  };
}

export type RemoteDesktopStore = ReturnType<typeof createRemoteDesktopStore>;

function requireInbox(database: SqliteRuntimeDatabase, messageId: string, commandId?: string): RemoteDesktopInboxEntry {
  const entry = inboxRow(database, messageId) ?? (commandId === undefined ? undefined : inboxRowByCommand(database, commandId));
  if (entry === undefined) throw new Error(`Remote inbox ${messageId} was not found`);
  return entry;
}

function inboxRow(database: SqliteRuntimeDatabase, messageId: string): RemoteDesktopInboxEntry | undefined {
  const row = database.connection.prepare(`
    SELECT message_id AS messageId, command_id AS commandId, state,
           result_json AS resultJson, received_at AS receivedAt, applied_at AS appliedAt
    FROM remote_desktop_inbox WHERE message_id = ?
  `).get(messageId) as {
    messageId: string;
    commandId: string;
    state: "applying" | "applied";
    resultJson: string | null;
    receivedAt: string;
    appliedAt: string | null;
  } | undefined;
  return row === undefined ? undefined : {
    messageId: row.messageId,
    commandId: row.commandId,
    state: row.state,
    ...(row.resultJson === null ? {} : { result: JSON.parse(row.resultJson) as unknown }),
    receivedAt: row.receivedAt,
    ...(row.appliedAt === null ? {} : { appliedAt: row.appliedAt }),
  };
}

function inboxRowByCommand(database: SqliteRuntimeDatabase, commandId: string): RemoteDesktopInboxEntry | undefined {
  const row = database.connection.prepare(`
    SELECT message_id AS messageId, command_id AS commandId, state,
           result_json AS resultJson, received_at AS receivedAt, applied_at AS appliedAt
    FROM remote_desktop_inbox WHERE command_id = ?
  `).get(commandId) as {
    messageId: string;
    commandId: string;
    state: "applying" | "applied";
    resultJson: string | null;
    receivedAt: string;
    appliedAt: string | null;
  } | undefined;
  return row === undefined ? undefined : {
    messageId: row.messageId,
    commandId: row.commandId,
    state: row.state,
    ...(row.resultJson === null ? {} : { result: JSON.parse(row.resultJson) as unknown }),
    receivedAt: row.receivedAt,
    ...(row.appliedAt === null ? {} : { appliedAt: row.appliedAt }),
  };
}
