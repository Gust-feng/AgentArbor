import type { RemoteEvent, RemoteMessageContent } from "../../remote-collaboration/protocol";

const DATABASE_NAME = "agentarbor-remote-v1";
const DATABASE_VERSION = 1;

export type MobilePairingClaim = {
  readonly relayUrl: string;
  readonly pairingId: string;
  readonly pairingCode: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly claimSecret: string;
  readonly expiresAt: string;
};

export type MobileBinding = {
  readonly relayUrl: string;
  readonly deviceId: string;
  readonly accessToken: string;
  readonly peerDeviceId: string;
  readonly peerDeviceName: string;
  readonly cursor: number;
};

export type MobileOutboxEntry = {
  readonly clientMessageId: string;
  readonly content: RemoteMessageContent;
  readonly createdAt: string;
};

export interface MobileRemoteStorage {
  getPairing(): Promise<MobilePairingClaim | undefined>;
  savePairing(pairing: MobilePairingClaim): Promise<void>;
  clearPairing(): Promise<void>;
  getBinding(): Promise<MobileBinding | undefined>;
  saveBinding(binding: MobileBinding): Promise<void>;
  clearBinding(): Promise<void>;
  putOutbox(entry: MobileOutboxEntry): Promise<void>;
  listOutbox(): Promise<readonly MobileOutboxEntry[]>;
  removeOutbox(clientMessageId: string): Promise<void>;
  saveEvent(event: RemoteEvent): Promise<void>;
  listEvents(): Promise<readonly RemoteEvent[]>;
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
    async putOutbox(entry) { await put(await database, "outbox", entry); },
    async listOutbox() { return getAll<MobileOutboxEntry>(await database, "outbox"); },
    async removeOutbox(clientMessageId) { await remove(await database, "outbox", clientMessageId); },
    async saveEvent(event) { await put(await database, "events", { ...event, cacheKey: eventCacheKey(event) }); },
    async listEvents() {
      return (await getAll<RemoteEvent & { cacheKey: string }>(await database, "events"))
        .map(({ cacheKey: _cacheKey, ...event }) => event as RemoteEvent);
    },
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("kv")) database.createObjectStore("kv");
      if (!database.objectStoreNames.contains("outbox")) database.createObjectStore("outbox", { keyPath: "clientMessageId" });
      if (!database.objectStoreNames.contains("events")) database.createObjectStore("events", { keyPath: "cacheKey" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function eventCacheKey(event: RemoteEvent): string {
  switch (event.kind) {
    case "conversation.snapshot": return `conversation:${event.conversationId}`;
    case "run.snapshot": return `run:${event.runId}`;
    case "space.snapshot": return "spaces";
    case "notebook.snapshot": return "notebooks";
    case "asset.snapshot": return "assets";
    case "managed_folder.snapshot": return "managed-folders";
    case "command.result": return `command:${event.commandId}`;
  }
}

function getKey<T>(database: IDBDatabase, key: string): Promise<T | undefined> {
  return requestResult<T | undefined>(database.transaction("kv", "readonly").objectStore("kv").get(key));
}

async function putKey(database: IDBDatabase, key: string, value: unknown): Promise<void> {
  await requestResult(database.transaction("kv", "readwrite").objectStore("kv").put(value, key));
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
