import {
  remoteEventSchema,
  type RemoteEvent,
  type RemoteMessageContent,
} from "../../remote-collaboration/protocol";
import type {
  ContentVaultMutation,
  ContentVaultMutationResult,
  ContentVaultResource,
} from "../../content-vault/contracts";

const DATABASE_NAME = "agentarbor-remote-v1";
const DATABASE_VERSION = 9;

export type MobilePairingClaim = {
  readonly relayUrl: string;
  readonly pairingId: string;
  readonly pairingCode: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly claimSecret: string;
  readonly expiresAt: string;
  readonly account: {
    readonly accountId: string;
    readonly handle: string;
    readonly displayName: string;
  };
};

export type MobileBinding = {
  readonly relayUrl: string;
  readonly accountId: string;
  readonly accountHandle: string;
  readonly displayName: string;
  readonly deviceId: string;
  readonly peerDeviceId: string;
  readonly peerDeviceName: string;
};

export type MobileOutboxEntry = {
  readonly clientMessageId: string;
  readonly content: RemoteMessageContent;
  readonly createdAt: string;
};

export type MobilePendingConversation = {
  readonly commandId: string;
  readonly spaceId: string;
  readonly message: string;
  readonly createdAt: string;
  readonly modelSelectionId?: string;
};

export type MobileVaultOutboxEntry = {
  readonly mutationId: string;
  readonly mutation: ContentVaultMutation;
  readonly createdAt: string;
};

export type MobileVaultConflict = {
  readonly mutationId: string;
  readonly mutation: ContentVaultMutation;
  readonly reason: Extract<ContentVaultMutationResult, { readonly status: "conflict" }>["reason"];
  readonly current?: ContentVaultResource;
  readonly detectedAt: string;
};

export interface MobileRemoteStorage {
  getPairing(): Promise<MobilePairingClaim | undefined>;
  savePairing(pairing: MobilePairingClaim): Promise<void>;
  clearPairing(): Promise<void>;
  getBinding(): Promise<MobileBinding | undefined>;
  saveBinding(binding: MobileBinding): Promise<void>;
  clearBinding(): Promise<void>;
  clearDeviceData(): Promise<void>;
  putOutbox(entry: MobileOutboxEntry): Promise<void>;
  listOutbox(): Promise<readonly MobileOutboxEntry[]>;
  removeOutbox(clientMessageId: string): Promise<void>;
  putPendingConversation(entry: MobilePendingConversation): Promise<void>;
  listPendingConversations(): Promise<readonly MobilePendingConversation[]>;
  removePendingConversation(commandId: string): Promise<void>;
  hasReceived(clientMessageId: string): Promise<boolean>;
  markReceived(clientMessageId: string, receivedAt: string): Promise<void>;
  saveEvent(event: RemoteEvent): Promise<void>;
  listEvents(): Promise<readonly RemoteEvent[]>;
  putVaultResource(resource: ContentVaultResource): Promise<void>;
  listVaultResources(): Promise<readonly ContentVaultResource[]>;
  applyVaultChanges(resources: readonly ContentVaultResource[], cursor: number): Promise<void>;
  getVaultCursor(): Promise<number>;
  saveVaultCursor(cursor: number): Promise<void>;
  putVaultOutbox(entry: MobileVaultOutboxEntry): Promise<void>;
  listVaultOutbox(): Promise<readonly MobileVaultOutboxEntry[]>;
  removeVaultOutbox(mutationId: string): Promise<void>;
  putVaultConflict(conflict: MobileVaultConflict): Promise<void>;
  listVaultConflicts(): Promise<readonly MobileVaultConflict[]>;
  removeVaultConflict(mutationId: string): Promise<void>;
}

export function createIndexedDbMobileRemoteStorage(): MobileRemoteStorage {
  const database = openDatabase();
  return {
    async getPairing() { return getKey<MobilePairingClaim>(await database, "pairing"); },
    async savePairing(pairing) { await putKey(await database, "pairing", pairing); },
    async clearPairing() { await deleteKey(await database, "pairing"); },
    async getBinding() { return getKey<MobileBinding>(await database, "binding"); },
    async saveBinding(binding) { await putKey(await database, "binding", binding); },
    async clearBinding() { await deleteKey(await database, "binding"); },
    async clearDeviceData() {
      const resolved = await database;
      await clearStores(resolved, ["kv", "outbox", "events", "receipts", "pending-conversations", "vault-resources", "vault-outbox", "vault-conflicts"]);
    },
    async putOutbox(entry) { await put(await database, "outbox", entry); },
    async listOutbox() {
      return orderMobileOutbox(await getAll<MobileOutboxEntry>(await database, "outbox"));
    },
    async removeOutbox(clientMessageId) { await remove(await database, "outbox", clientMessageId); },
    async putPendingConversation(entry) { await put(await database, "pending-conversations", entry); },
    async listPendingConversations() {
      return orderMobilePendingConversations(await getAll<MobilePendingConversation>(await database, "pending-conversations"));
    },
    async removePendingConversation(commandId) { await remove(await database, "pending-conversations", commandId); },
    async hasReceived(clientMessageId) {
      return (await getKey<string>(await database, `received:${clientMessageId}`, "receipts")) !== undefined;
    },
    async markReceived(clientMessageId, receivedAt) {
      await putKey(await database, `received:${clientMessageId}`, receivedAt, "receipts");
    },
    async saveEvent(event) { await put(await database, "events", { ...event, cacheKey: eventCacheKey(event) }); },
    async listEvents() {
      return parseCachedRemoteEvents(await getAll<unknown>(await database, "events"));
    },
    async putVaultResource(resource) {
      await put(await database, "vault-resources", { ...resource, vaultKey: vaultResourceKey(resource) });
    },
    async listVaultResources() {
      return (await getAll<ContentVaultResource & { vaultKey: string }>(await database, "vault-resources"))
        .map(({ vaultKey: _vaultKey, ...resource }) => resource);
    },
    async applyVaultChanges(resources, cursor) {
      await applyVaultChanges(await database, resources, cursor);
    },
    async getVaultCursor() { return (await getKey<number>(await database, "vault:cursor")) ?? 0; },
    async saveVaultCursor(cursor) { await putKey(await database, "vault:cursor", cursor); },
    async putVaultOutbox(entry) { await put(await database, "vault-outbox", entry); },
    async listVaultOutbox() {
      return orderMobileVaultOutbox(await getAll<MobileVaultOutboxEntry>(await database, "vault-outbox"));
    },
    async removeVaultOutbox(mutationId) { await remove(await database, "vault-outbox", mutationId); },
    async putVaultConflict(conflict) { await put(await database, "vault-conflicts", conflict); },
    async listVaultConflicts() { return getAll<MobileVaultConflict>(await database, "vault-conflicts"); },
    async removeVaultConflict(mutationId) { await remove(await database, "vault-conflicts", mutationId); },
  };
}

export function orderMobileOutbox(entries: readonly MobileOutboxEntry[]): readonly MobileOutboxEntry[] {
  return [...entries].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
    || left.clientMessageId.localeCompare(right.clientMessageId));
}

export function orderMobilePendingConversations(entries: readonly MobilePendingConversation[]): readonly MobilePendingConversation[] {
  return [...entries].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
    || left.commandId.localeCompare(right.commandId));
}

export function orderMobileVaultOutbox(entries: readonly MobileVaultOutboxEntry[]): readonly MobileVaultOutboxEntry[] {
  return [...entries].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
    || left.mutationId.localeCompare(right.mutationId));
}

export function parseCachedRemoteEvents(entries: readonly unknown[]): readonly RemoteEvent[] {
  return entries.flatMap((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return [];
    const { cacheKey: _cacheKey, ...candidate } = entry as Readonly<Record<string, unknown>>;
    const parsed = remoteEventSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      if (!database.objectStoreNames.contains("kv")) database.createObjectStore("kv");
      if (!database.objectStoreNames.contains("outbox")) database.createObjectStore("outbox", { keyPath: "clientMessageId" });
      if (!database.objectStoreNames.contains("events")) database.createObjectStore("events", { keyPath: "cacheKey" });
      if (!database.objectStoreNames.contains("receipts")) database.createObjectStore("receipts");
      if (!database.objectStoreNames.contains("pending-conversations")) database.createObjectStore("pending-conversations", { keyPath: "commandId" });
      if (!database.objectStoreNames.contains("vault-resources")) database.createObjectStore("vault-resources", { keyPath: "vaultKey" });
      if (!database.objectStoreNames.contains("vault-outbox")) database.createObjectStore("vault-outbox", { keyPath: "mutationId" });
      if (!database.objectStoreNames.contains("vault-conflicts")) database.createObjectStore("vault-conflicts", { keyPath: "mutationId" });
      for (const store of mobileMigrationStoresToClear(event.oldVersion)) {
        request.transaction?.objectStore(store).clear();
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function mobileMigrationStoresToClear(oldVersion: number): readonly ("events" | "outbox")[] {
  // V6 replaced content snapshot messages with Vault; V7 completed the migration
  // by also removing legacy envelopes. V8 added owner-scoped pending projections.
  // V9 rewrites conversation pages as one merged projection per Conversation, so
  // old page keys must not be replayed beside the new stable cache key.
  if (oldVersion > 0 && oldVersion < 7) return ["events", "outbox"];
  if (oldVersion > 0 && oldVersion < 9) return ["events"];
  return [];
}

function vaultResourceKey(resource: ContentVaultResource): string {
  return `${resource.kind}:${resource.resourceId}`;
}

function eventCacheKey(event: RemoteEvent): string {
  switch (event.kind) {
    case "conversation.index": return "conversation-index";
    case "conversation.page": return `conversation-page:${event.conversationId}:materialized`;
    case "run.snapshot": return `run:${event.runId}`;
    case "run.delta": return `run-delta:${event.eventId}`;
    case "command.result": return `command:${event.commandId}`;
  }
}

function getKey<T>(database: IDBDatabase, key: string, store = "kv"): Promise<T | undefined> {
  return requestResult<T | undefined>(database.transaction(store, "readonly").objectStore(store).get(key));
}

async function putKey(database: IDBDatabase, key: string, value: unknown, store = "kv"): Promise<void> {
  await requestResult(database.transaction(store, "readwrite").objectStore(store).put(value, key));
}

async function deleteKey(database: IDBDatabase, key: string): Promise<void> {
  await requestResult(database.transaction("kv", "readwrite").objectStore("kv").delete(key));
}

async function put(database: IDBDatabase, store: string, value: unknown): Promise<void> {
  await requestResult(database.transaction(store, "readwrite").objectStore(store).put(value));
}

function getAll<T>(database: IDBDatabase, store: string): Promise<readonly T[]> {
  return requestResult<T[]>(database.transaction(store, "readonly").objectStore(store).getAll());
}

async function remove(database: IDBDatabase, store: string, key: string): Promise<void> {
  await requestResult(database.transaction(store, "readwrite").objectStore(store).delete(key));
}

function requestResult<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function clearStores(database: IDBDatabase, stores: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([...stores], "readwrite");
    for (const store of stores) transaction.objectStore(store).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function applyVaultChanges(
  database: IDBDatabase,
  resources: readonly ContentVaultResource[],
  cursor: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["vault-resources", "kv"], "readwrite");
    const resourceStore = transaction.objectStore("vault-resources");
    for (const resource of resources) {
      resourceStore.put({ ...resource, vaultKey: vaultResourceKey(resource) });
    }
    transaction.objectStore("kv").put(cursor, "vault:cursor");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
