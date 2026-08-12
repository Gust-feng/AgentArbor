import { describe, expect, test } from "vitest";

import type { ContentVaultMutation, ContentVaultResource } from "../../content-vault/contracts";
import { canonicalContentVaultJson } from "../../content-vault/contracts";
import { createManagedFileResourceId, RemoteMobileClient } from "./remote-client";
import type {
  MobileBinding,
  MobilePairingClaim,
  MobilePendingConversation,
  MobileRemoteStorage,
  MobileVaultConflict,
  MobileVaultOutboxEntry,
} from "./storage";

describe("mobile Content Vault synchronization", () => {
  test("uses the same managed file identity as the desktop contributor", async () => {
    await expect(createManagedFileResourceId({
      managedRootId: "root-one",
      relativePath: "drafts/plan.md",
    })).resolves.toBe("managed-file-42bac7985adbd7830cb28314e3bd627c2e9b438a6c6f06105861bc4aca965552");
  });

  test("canonicalizes and hashes an offline upsert before putting it in the durable outbox", async () => {
    const storage = new MemoryStorage();
    const client = new RemoteMobileClient(storage, globalThis.fetch, undefined, credentials());
    const payload = { language: "md", text: "Hello", kind: "markdown", title: "Note" };

    const mutationId = await client.submitVaultMutation({
      kind: "workbench_asset",
      resourceId: "asset-1",
      operation: "upsert",
      baseRevision: 0,
      payloadSchemaVersion: 1,
      payload,
    });

    expect(storage.vaultOutbox).toHaveLength(1);
    expect(storage.vaultOutbox[0]?.mutation).toMatchObject({ mutationId, payload });
    const expectedDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalContentVaultJson(payload)));
    const expectedHash = `sha256:${[...new Uint8Array(expectedDigest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    expect(storage.vaultOutbox[0]?.mutation.operation === "upsert" && storage.vaultOutbox[0].mutation.contentHash)
      .toBe(expectedHash);
  });

  test("applies each change page and its cursor through one storage operation", async () => {
    const storage = new MemoryStorage({ binding: binding(), cursor: 1, resources: [resource("seed", 1)] });
    const requestedAfter: number[] = [];
    const fetch = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const after = Number(url.searchParams.get("after"));
      requestedAfter.push(after);
      return jsonResponse(after === 1
        ? { changes: [{ cursor: 2, resource: resource("first", 1) }], nextCursor: 2, hasMore: true }
        : { changes: [{ cursor: 3, resource: resource("second", 1) }], nextCursor: 3, hasMore: false });
    };
    const client = new RemoteMobileClient(storage, fetch, undefined, credentials("token-1"));

    await client.synchronizeVault();

    expect(requestedAfter).toEqual([1, 2]);
    expect(storage.appliedCursors).toEqual([2, 3]);
    expect(storage.cursor).toBe(3);
    expect(client.snapshot().vaultResources.map((item) => item.resourceId).sort()).toEqual(["first", "second", "seed"]);
  });

  test("uses a stable composite cursor to finish a multi-page initial snapshot", async () => {
    const storage = new MemoryStorage({ binding: binding() });
    const requestedQueries: string[] = [];
    const fetch = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requestedQueries.push(url.search);
      return url.searchParams.has("afterResourceId")
        ? jsonResponse({ resources: [resource("second", 1)], changeCursor: 7 })
        : jsonResponse({
            resources: [resource("first", 1)],
            changeCursor: 7,
            nextCursor: { changeCursor: 7, afterKind: "workbench_asset", afterResourceId: "first" },
          });
    };
    const client = new RemoteMobileClient(storage, fetch, undefined, credentials("token-1"));

    await client.synchronizeVault();

    expect(requestedQueries).toEqual([
      "?limit=100",
      "?limit=100&at=7&afterKind=workbench_asset&afterResourceId=first",
    ]);
    expect(storage.cursor).toBe(7);
    expect(client.snapshot().vaultResources.map((item) => item.resourceId).sort()).toEqual(["first", "second"]);
  });

  test("does not advance the initial cursor when the snapshot continuation is invalid", async () => {
    const storage = new MemoryStorage({ binding: binding() });
    const fetch = async () => jsonResponse({
      resources: [resource("first", 1)],
      changeCursor: 7,
      nextCursor: { changeCursor: 8, afterKind: "workbench_asset", afterResourceId: "first" },
    });
    const client = new RemoteMobileClient(storage, fetch, undefined, credentials("token-1"));

    await expect(client.synchronizeVault()).rejects.toThrow("continuation is invalid");

    expect(storage.cursor).toBe(0);
  });

  test("moves a CAS conflict out of the retry outbox into durable conflict state", async () => {
    const current = resource("asset-1", 2);
    const mutation: ContentVaultMutation = {
      protocolVersion: "content-vault/v1",
      mutationId: "mutation-1",
      kind: "workbench_asset",
      resourceId: "asset-1",
      operation: "delete",
      baseRevision: 1,
    };
    const storage = new MemoryStorage({
      binding: binding(),
      cursor: 1,
      resources: [current],
      outbox: [{ mutationId: mutation.mutationId, mutation, createdAt: "2026-08-04T00:00:00.000Z" }],
    });
    const fetch = async (input: RequestInfo | URL) => String(input).endsWith("/mutations")
      ? jsonResponse({ results: [{ status: "conflict", mutationId: "mutation-1", reason: "revision_mismatch", current }] })
      : jsonResponse({ changes: [], nextCursor: 1, hasMore: false });
    const client = new RemoteMobileClient(storage, fetch, undefined, credentials("token-1"));

    await client.synchronizeVault();

    expect(storage.vaultOutbox).toEqual([]);
    expect(storage.vaultConflicts).toMatchObject([{ mutationId: "mutation-1", reason: "revision_mismatch" }]);
    expect(client.snapshot().vaultConflicts).toHaveLength(1);
  });

  test("reports a connected CAS conflict to the editor instead of claiming the save succeeded", async () => {
    const current = resource("asset-1", 2);
    const storage = new MemoryStorage({ binding: binding(), cursor: 1, resources: [current] });
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith("/mutations")) return jsonResponse({ changes: [], nextCursor: 1, hasMore: false });
      const batch = JSON.parse(String(init?.body)) as { mutations: readonly { mutationId: string }[] };
      return jsonResponse({ results: [{ status: "conflict", mutationId: batch.mutations[0]?.mutationId, reason: "revision_mismatch", current }] });
    };
    const client = new RemoteMobileClient(storage, fetch, undefined, credentials("token-1"));

    await expect(client.submitVaultMutation({
      kind: "workbench_asset",
      resourceId: "asset-1",
      operation: "upsert",
      baseRevision: 1,
      payloadSchemaVersion: 1,
      payload: current.payload!,
    })).rejects.toThrow("请先处理同步冲突");

    expect(client.snapshot().vaultConflicts).toHaveLength(1);
    expect(storage.vaultOutbox).toHaveLength(0);
  });

  test("rejects a resource whose payload integrity does not match the server metadata", async () => {
    const storage = new MemoryStorage({ binding: binding(), cursor: 1, resources: [resource("seed", 1)] });
    const fetch = async () => jsonResponse({
      changes: [{ cursor: 2, resource: { ...resource("seed", 2), contentHash: `sha256:${"0".repeat(64)}` } }],
      nextCursor: 2,
      hasMore: false,
    });
    const client = new RemoteMobileClient(storage, fetch, undefined, credentials("token-1"));

    await expect(client.synchronizeVault()).rejects.toThrow("摘要不一致");
    expect(storage.cursor).toBe(1);
    expect(storage.resources.get("workbench_asset:seed")?.revision).toBe(1);
  });

test("pulls Vault changes immediately after a cursor-only WebSocket notification", async () => {
    const storage = new MemoryStorage({ binding: binding(), cursor: 1, resources: [resource("seed", 1)] });
    let changeRequests = 0;
    const fetch = async () => {
      changeRequests += 1;
      return changeRequests === 1
        ? jsonResponse({ changes: [], nextCursor: 1, hasMore: false })
        : jsonResponse({ changes: [{ cursor: 2, resource: resource("notified", 1) }], nextCursor: 2, hasMore: false });
    };
    let socket: FakeWebSocket | undefined;
    const client = new RemoteMobileClient(storage, fetch, () => {
      socket = new FakeWebSocket();
      queueMicrotask(() => socket?.open());
      return socket as unknown as WebSocket;
    }, credentials("token-1"));

    await client.connect();
    await waitFor(() => changeRequests === 1);
    socket?.deliver({
      protocolVersion: "remote-collaboration/v1",
      type: "vault.changed",
      cursor: 2,
    });
    await waitFor(() => storage.cursor === 2);

    expect(changeRequests).toBe(2);
    expect(client.snapshot().vaultResources.some((item) => item.resourceId === "notified")).toBe(true);
    client.release();
  });
});

class FakeWebSocket {
  readyState: number = WebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.onopen?.();
  }

  send(value: string): void {
    const frame = JSON.parse(value) as { readonly type?: string };
    if (frame.type !== "client.hello") return;
    queueMicrotask(() => this.deliver({
      protocolVersion: "remote-collaboration/v1",
      type: "server.ready",
      deviceId: "mobile-1",
      peerDeviceId: "desktop-1",
      peerDeviceName: "Desktop",
      peerOnline: true,
    }));
  }

  deliver(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.();
  }
}

class MemoryStorage implements MobileRemoteStorage {
  pairing?: MobilePairingClaim;
  binding?: MobileBinding;
  cursor: number;
  readonly resources = new Map<string, ContentVaultResource>();
  vaultOutbox: MobileVaultOutboxEntry[];
  vaultConflicts: MobileVaultConflict[] = [];
  readonly appliedCursors: number[] = [];

  constructor(input: {
    readonly binding?: MobileBinding;
    readonly cursor?: number;
    readonly resources?: readonly ContentVaultResource[];
    readonly outbox?: readonly MobileVaultOutboxEntry[];
  } = {}) {
    this.binding = input.binding;
    this.cursor = input.cursor ?? 0;
    this.vaultOutbox = [...(input.outbox ?? [])];
    for (const resource of input.resources ?? []) this.resources.set(resourceKey(resource), resource);
  }

  async getPairing() { return this.pairing; }
  async savePairing(pairing: MobilePairingClaim) { this.pairing = pairing; }
  async clearPairing() { this.pairing = undefined; }
  async getBinding() { return this.binding; }
  async saveBinding(binding: MobileBinding) { this.binding = binding; }
  async clearBinding() { this.binding = undefined; }
  async clearDeviceData() {}
  async putOutbox() {}
  async listOutbox() { return []; }
  async removeOutbox() {}
  async putPendingConversation(_entry: MobilePendingConversation) {}
  async listPendingConversations() { return []; }
  async removePendingConversation(_commandId: string) {}
  async hasReceived() { return false; }
  async markReceived() {}
  async saveEvent() {}
  async listEvents() { return []; }
  async putVaultResource(resource: ContentVaultResource) { this.resources.set(resourceKey(resource), resource); }
  async listVaultResources() { return [...this.resources.values()]; }
  async applyVaultChanges(resources: readonly ContentVaultResource[], cursor: number) {
    for (const resource of resources) this.resources.set(resourceKey(resource), resource);
    this.cursor = cursor;
    this.appliedCursors.push(cursor);
  }
  async getVaultCursor() { return this.cursor; }
  async saveVaultCursor(cursor: number) { this.cursor = cursor; }
  async putVaultOutbox(entry: MobileVaultOutboxEntry) {
    this.vaultOutbox = [entry, ...this.vaultOutbox.filter((item) => item.mutationId !== entry.mutationId)];
  }
  async listVaultOutbox() { return this.vaultOutbox; }
  async removeVaultOutbox(mutationId: string) {
    this.vaultOutbox = this.vaultOutbox.filter((item) => item.mutationId !== mutationId);
  }
  async putVaultConflict(conflict: MobileVaultConflict) {
    this.vaultConflicts = [conflict, ...this.vaultConflicts.filter((item) => item.mutationId !== conflict.mutationId)];
  }
  async listVaultConflicts() { return this.vaultConflicts; }
  async removeVaultConflict(mutationId: string) {
    this.vaultConflicts = this.vaultConflicts.filter((item) => item.mutationId !== mutationId);
  }
}

function binding(): MobileBinding {
  return {
    relayUrl: "https://relay.example.test",
    accountId: "account-1",
    accountHandle: "account-one",
    displayName: "Account One",
    deviceId: "mobile-1",
    peerDeviceId: "desktop-1",
    peerDeviceName: "Desktop",
  };
}

function credentials(token?: string) {
  return {
    async readDeviceToken() { return token; },
    async writeDeviceToken() {},
    async deleteDeviceToken() {},
  };
}

function resource(resourceId: string, revision: number): ContentVaultResource {
  const payload = { title: resourceId, kind: "markdown" as const, text: resourceId, language: "md" };
  return {
    kind: "workbench_asset",
    resourceId,
    revision,
    deleted: false,
    payloadSchemaVersion: 1,
    payload,
    contentHash: ({
      seed: "sha256:813fd624bb6efcce96c7792a3c3827042f4de0a5470665514f435f87073295fd",
      first: "sha256:f2755091b338523b92e2e1698b860a393510904e5b062b96d67ea5e1983c99fd",
      second: "sha256:314ab3faf6b11da2d1c747a7221c9315a0ae9cee912d23ec1efeac41ffb4a98e",
      notified: "sha256:092013f8f1efcfb4e6547c2d7a651970e5e9a72d0fa82c03c895e1d9fc479e2d",
      "asset-1": "sha256:3bb69f9fe5a78fc8d9bd12d92366a28fdc3c5a9f4b71b58d42a1c239b3ccc325",
    } as Record<string, string>)[resourceId] ?? `sha256:${"0".repeat(64)}`,
    contentBytes: new TextEncoder().encode(canonicalContentVaultJson(payload)).byteLength,
    updatedAt: "2026-08-04T00:00:00.000Z",
    updatedByDeviceId: "desktop-1",
  };
}

function resourceKey(resource: ContentVaultResource): string {
  return `${resource.kind}:${resource.resourceId}`;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify({ ok: true, protocolVersion: "content-vault/v1", ...body as object }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for mobile synchronization");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
