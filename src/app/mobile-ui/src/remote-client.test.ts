import { describe, expect, test } from "vitest";

import { applyRemoteEvent, materializeCachedEvent, RemoteMobileClient, type MobileRemoteState } from "./remote-client";
import type { MobileOutboxEntry, MobilePendingConversation, MobileRemoteStorage, MobileVaultOutboxEntry } from "./storage";

describe("mobile remote projection", () => {
  test("replaces snapshots by stable identity and resolves pending command results", () => {
    const initial = state({
      pendingCommandIds: ["command-1"],
      pendingConversations: [{ commandId: "command-1", spaceId: "space-1", message: "等待发送", createdAt: "2026-08-03T00:00:00.000Z" }],
    });
    const first = applyRemoteEvent(initial, {
      kind: "conversation.index",
      eventId: "event-1",
      conversations: [{ conversationId: "conversation-1", title: "First title", updatedAt: "2026-08-03T00:00:00.000Z", status: "idle" }],
    });
    const replaced = applyRemoteEvent(first, {
      kind: "conversation.index",
      eventId: "event-2",
      conversations: [{ conversationId: "conversation-1", title: "Updated title", updatedAt: "2026-08-03T00:00:01.000Z", status: "completed" }],
    });
    const completed = applyRemoteEvent(replaced, {
      kind: "command.result",
      eventId: "result-1",
      commandId: "command-1",
      status: "applied",
    });

    expect(replaced.conversations).toHaveLength(1);
    expect(replaced.conversations[0]?.title).toBe("Updated title");
    expect(completed.pendingCommandIds).toEqual([]);
    expect(completed.pendingConversations).toEqual([]);
    expect(completed.commandResults[0]?.status).toBe("applied");
  });

  test("keeps remote command conflicts visible to the user", () => {
    const result = applyRemoteEvent(state({ pendingCommandIds: ["page-command"] }), {
      kind: "command.result",
      eventId: "result-conflict",
      commandId: "page-command",
      status: "conflict",
      error: { code: "conversation_cursor_conflict", message: "The conversation page changed on desktop" },
    });
    expect(result.pendingCommandIds).toEqual([]);
    expect(result.commandResults[0]?.error?.code).toBe("conversation_cursor_conflict");
  });

  test("merges older conversation pages ahead of the cached latest page", () => {
    const latest = applyRemoteEvent(state(), {
      kind: "conversation.page",
      eventId: "latest",
      conversationId: "conversation-1",
      turns: [turn("turn-2"), turn("turn-3")],
      hasMore: true,
      nextBeforeTurnId: "turn-2",
    });
    const merged = applyRemoteEvent(latest, {
      kind: "conversation.page",
      eventId: "older",
      conversationId: "conversation-1",
      beforeTurnId: "turn-2",
      turns: [turn("turn-1")],
      hasMore: false,
    });
    expect(merged.conversationPages["conversation-1"]?.turns.map((item) => item.turnId)).toEqual(["turn-1", "turn-2", "turn-3"]);
  });

  test("materializes one merged conversation page for durable replay", () => {
    const latest = applyRemoteEvent(state(), {
      kind: "conversation.page",
      eventId: "latest",
      conversationId: "conversation-1",
      turns: [turn("turn-2"), turn("turn-3")],
      hasMore: true,
      nextBeforeTurnId: "turn-2",
    });
    const merged = applyRemoteEvent(latest, {
      kind: "conversation.page",
      eventId: "older",
      conversationId: "conversation-1",
      beforeTurnId: "turn-2",
      turns: [turn("turn-1")],
      hasMore: false,
    });

    expect(materializeCachedEvent(merged, {
      kind: "conversation.page",
      eventId: "older",
      conversationId: "conversation-1",
      beforeTurnId: "turn-2",
      turns: [turn("turn-1")],
      hasMore: false,
    })).toEqual(merged.conversationPages["conversation-1"]);
  });

  test("applies live assistant deltas to the current run without inventing a terminal state", () => {
    const initial = state({
      runs: [{
        kind: "run.snapshot",
        eventId: "run-event",
        runId: "run-1",
        conversationId: "conversation-1",
        status: "running",
        visibleAssistantText: "Hello",
        pendingConfirmations: [],
        updatedAt: "2026-08-03T00:00:00.000Z",
      }],
    });
    const next = applyRemoteEvent(initial, {
      kind: "run.delta",
      eventId: "delta-1",
      runId: "run-1",
      activitySequence: 2,
      delta: " world",
    });
    expect(next.runs[0]?.visibleAssistantText).toBe("Hello world");
    expect(next.runs[0]?.status).toBe("running");
  });

  test("ignores a late live delta after a terminal run snapshot", () => {
    const initial = state({
      runs: [{
        kind: "run.snapshot",
        eventId: "run-completed",
        runId: "run-1",
        conversationId: "conversation-1",
        status: "completed",
        visibleAssistantText: "Complete answer",
        pendingConfirmations: [],
        updatedAt: "2026-08-03T00:00:01.000Z",
      }],
    });
    const next = applyRemoteEvent(initial, {
      kind: "run.delta",
      eventId: "late-delta",
      runId: "run-1",
      activitySequence: 99,
      delta: " duplicate tail",
    });

    expect(next).toBe(initial);
    expect(next.runs[0]?.visibleAssistantText).toBe("Complete answer");
  });

  test("ignores duplicate and late live deltas by activity sequence", () => {
    const initial = state({
      runs: [{
        kind: "run.snapshot",
        eventId: "run-event",
        runId: "run-1",
        conversationId: "conversation-1",
        status: "running",
        visibleAssistantText: "Hello",
        pendingConfirmations: [],
        updatedAt: "2026-08-03T00:00:00.000Z",
      }],
    });
    const withSecond = applyRemoteEvent(initial, {
      kind: "run.delta",
      eventId: "delta-2",
      runId: "run-1",
      activitySequence: 2,
      delta: " world",
    });
    const duplicate = applyRemoteEvent(withSecond, {
      kind: "run.delta",
      eventId: "delta-2-replayed",
      runId: "run-1",
      activitySequence: 2,
      delta: " world",
    });
    const late = applyRemoteEvent(duplicate, {
      kind: "run.delta",
      eventId: "delta-1-late",
      runId: "run-1",
      activitySequence: 1,
      delta: " earlier",
    });

    expect(late.runs[0]?.visibleAssistantText).toBe("Hello world");
    expect(late.runActivitySequences?.["run-1"]).toBe(2);
  });

  test("keeps an offline command in the mobile outbox", async () => {
    let stored: unknown;
    const storage = {
      async putOutbox(entry: unknown) { stored = entry; },
    } as unknown as MobileRemoteStorage;
    const client = new RemoteMobileClient(storage);

    const commandId = await client.sendCommand({ kind: "conversation.submit", conversationId: "conversation-1", message: "queued locally" });

    expect(stored).toMatchObject({
      clientMessageId: commandId,
      content: { type: "command", command: { commandId, conversationId: "conversation-1", message: "queued locally" } },
    });
  });

  test("projects a new conversation into its Space while the command is pending", async () => {
    let pending: unknown;
    const storage = {
      async putOutbox() {},
      async putPendingConversation(entry: unknown) { pending = entry; },
    } as unknown as MobileRemoteStorage;
    const client = new RemoteMobileClient(storage);

    const commandId = await client.sendCommand({ kind: "conversation.submit", message: "整理这周的工作", spaceId: "space-1" });

    expect(pending).toMatchObject({ commandId, spaceId: "space-1", message: "整理这周的工作" });
    expect(client.snapshot().pendingConversations).toMatchObject([{ commandId, spaceId: "space-1" }]);
  });

  test("restores owner-scoped pending conversations after a client restart", async () => {
    const stored = [{ commandId: "command-restored", spaceId: "space-2", message: "继续整理", createdAt: "2026-08-03T00:00:00.000Z" }];
    const storage = {
      async getPairing() { return undefined; },
      async getBinding() { return undefined; },
      async listEvents() { return []; },
      async listOutbox() { return []; },
      async listPendingConversations() { return stored; },
      async listVaultResources() { return []; },
      async getVaultCursor() { return 0; },
      async listVaultConflicts() { return []; },
      async removePendingConversation() {},
    } as unknown as MobileRemoteStorage;
    const client = new RemoteMobileClient(storage, globalThis.fetch, undefined, {
      async readDeviceToken() { return undefined; },
      async writeDeviceToken() {},
      async deleteDeviceToken() {},
    });

    await client.start();

    expect(client.snapshot().pendingConversations).toEqual(stored);
  });

  test("restores durable pending Vault mutations after a client restart", async () => {
    const stored: readonly MobileVaultOutboxEntry[] = [{
      mutationId: "pending-note-mutation",
      mutation: {
        protocolVersion: "content-vault/v1",
        mutationId: "pending-note-mutation",
        kind: "personal_note",
        resourceId: "note-pending",
        baseRevision: 0,
        operation: "upsert",
        payloadSchemaVersion: 1,
        payload: {
          spaceId: "space-2",
          title: "重启后仍在",
          bodyMarkdown: "离线草稿",
          materialRefs: [],
          createdAt: 1,
          updatedAt: 1,
          sourceRevision: 1,
        },
        contentHash: `sha256:${"a".repeat(64)}`,
      },
      createdAt: "2026-08-03T00:00:00.000Z",
    }];
    const storage = {
      async getPairing() { return undefined; },
      async getBinding() { return undefined; },
      async listEvents() { return []; },
      async listOutbox() { return []; },
      async listPendingConversations() { return []; },
      async listVaultResources() { return []; },
      async listVaultOutbox() { return stored; },
      async getVaultCursor() { return 0; },
      async listVaultConflicts() { return []; },
    } as unknown as MobileRemoteStorage;
    const client = new RemoteMobileClient(storage, globalThis.fetch, undefined, {
      async readDeviceToken() { return undefined; },
      async writeDeviceToken() {},
      async deleteDeviceToken() {},
    });

    await client.start();

    expect(client.snapshot().vaultOutbox).toEqual(stored);
  });

  test("removes only legacy unowned new conversations during restart recovery", async () => {
    const removedOutbox: string[] = [];
    const removedPending: string[] = [];
    const outbox = [{
      clientMessageId: "legacy-unowned",
      content: { type: "command", command: { kind: "conversation.submit", commandId: "legacy-unowned", message: "旧版无主消息" } },
      createdAt: "2026-08-03T00:00:00.000Z",
    }, {
      clientMessageId: "owned-new",
      content: { type: "command", command: { kind: "conversation.submit", commandId: "owned-new", spaceId: "space-1", message: "归属空间的新对话" } },
      createdAt: "2026-08-03T00:00:01.000Z",
    }, {
      clientMessageId: "continued",
      content: { type: "command", command: { kind: "conversation.submit", commandId: "continued", conversationId: "conversation-1", message: "继续已有对话" } },
      createdAt: "2026-08-03T00:00:02.000Z",
    }] as unknown as readonly MobileOutboxEntry[];
    const pendingConversations = [{
      commandId: "legacy-pending",
      message: "旧版待发送投影",
      createdAt: "2026-08-03T00:00:00.000Z",
    }] as unknown as readonly MobilePendingConversation[];
    const storage = {
      async getPairing() { return undefined; },
      async getBinding() { return undefined; },
      async listEvents() { return []; },
      async listOutbox() { return outbox; },
      async listPendingConversations() { return pendingConversations; },
      async listVaultResources() { return []; },
      async getVaultCursor() { return 0; },
      async listVaultConflicts() { return []; },
      async removeOutbox(clientMessageId: string) { removedOutbox.push(clientMessageId); },
      async removePendingConversation(commandId: string) { removedPending.push(commandId); },
    } as unknown as MobileRemoteStorage;
    const client = new RemoteMobileClient(storage, globalThis.fetch, undefined, {
      async readDeviceToken() { return undefined; },
      async writeDeviceToken() {},
      async deleteDeviceToken() {},
    });

    await client.start();

    expect(removedOutbox).toEqual(["legacy-unowned"]);
    expect(removedPending).toEqual(["legacy-pending"]);
    expect(client.snapshot().pendingCommandIds).toEqual(["owned-new", "continued"]);
    expect(client.snapshot().pendingConversations).toMatchObject([{ commandId: "owned-new", spaceId: "space-1" }]);
  });

  test("revokes the mobile device before clearing its local binding", async () => {
    const binding = {
      relayUrl: "http://relay.local",
      accountId: "account-1",
      accountHandle: "user-example",
      displayName: "Desktop",
      deviceId: "mobile-1",
      peerDeviceId: "desktop-1",
      peerDeviceName: "Desktop",
    };
    let request: { url: string; authorization?: string } | undefined;
    let clearedDeviceData = false;
    let deletedCredential = false;
    const storage = {
      async getBinding() { return binding; },
      async clearDeviceData() { clearedDeviceData = true; },
    } as unknown as MobileRemoteStorage;
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers;
      const authorization = headers instanceof Headers
        ? headers.get("authorization") ?? undefined
        : headers !== undefined && !Array.isArray(headers) && typeof headers === "object" && "authorization" in headers
          ? String(headers.authorization)
          : undefined;
      request = { url: String(input), authorization };
      return { ok: true, async json() { return { ok: true }; } } as Response;
    };
    const client = new RemoteMobileClient(storage, fetch, (url) => new WebSocket(url), {
      async readDeviceToken() { return "token-1"; },
      async writeDeviceToken() {},
      async deleteDeviceToken() { deletedCredential = true; },
    });

    await client.forgetDevice();

    expect(request).toEqual({ url: "http://relay.local/v1/devices/mobile-1/revoke", authorization: "Bearer token-1" });
    expect(clearedDeviceData).toBe(true);
    expect(deletedCredential).toBe(true);
  });

  test("reuses one in-flight relay connection attempt", async () => {
    const sockets: ControlledWebSocket[] = [];
    const client = new RemoteMobileClient(connectionStorage(), vaultFetch, () => {
      const socket = new ControlledWebSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    }, tokenCredentials());

    const first = client.connect();
    const second = client.connect();
    await waitFor(() => sockets.length === 1);
    expect(second).toBe(first);

    sockets[0]?.open();
    sockets[0]?.deliverReady();
    await Promise.all([first, second]);

    expect(client.snapshot().connection).toBe("connected");
    client.release();
  });

  test("ignores a stale socket close and error after a new lifecycle reconnects", async () => {
    const sockets: ControlledWebSocket[] = [];
    const client = new RemoteMobileClient(connectionStorage(), vaultFetch, () => {
      const socket = new ControlledWebSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    }, tokenCredentials());

    const firstConnection = client.connect();
    await waitFor(() => sockets.length === 1);
    sockets[0]?.open();
    sockets[0]?.deliverReady();
    await firstConnection;

    client.release();
    const restarted = client.start();
    await waitFor(() => sockets.length === 2);
    sockets[1]?.open();
    sockets[1]?.deliverReady();
    await restarted;

    sockets[0]?.emitError();
    sockets[0]?.emitClose();

    expect(client.snapshot().connection).toBe("connected");
    expect(client.snapshot().peerOnline).toBe(true);
    client.release();
  });

  test("does not let a released start hydrate state or create a relay socket", async () => {
    const binding = deferred<ReturnType<typeof bindingForConnection>>();
    let socketCreations = 0;
    const storage = {
      ...connectionStorage(),
      async getBinding() { return binding.promise; },
    } as unknown as MobileRemoteStorage;
    const client = new RemoteMobileClient(storage, vaultFetch, () => {
      socketCreations += 1;
      return new ControlledWebSocket() as unknown as WebSocket;
    }, tokenCredentials());

    const starting = client.start();
    client.release();
    binding.resolve(bindingForConnection());
    await starting;

    expect(socketCreations).toBe(0);
    expect(client.snapshot().connection).toBe("loading");
  });
});

function state(overrides: Partial<MobileRemoteState> = {}): MobileRemoteState {
  return {
    connection: "connected",
    peerOnline: true,
    conversations: [],
    conversationPages: {},
    runs: [],
    vaultResources: [],
    vaultCursor: 0,
    vaultConflicts: [],
    pendingCommandIds: [],
    pendingConversations: [],
    commandResults: [],
    ...overrides,
  };
}

function turn(turnId: string) {
  return {
    turnId,
    runId: `run-${turnId}`,
    role: "assistant" as const,
    content: turnId,
    status: "completed" as const,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  };
}

class ControlledWebSocket {
  readyState: number = WebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.onopen?.();
  }

  send(_value: string): void {}

  close(): void {
    this.readyState = WebSocket.CLOSED;
  }

  deliverReady(): void {
    this.onmessage?.({ data: JSON.stringify({
      protocolVersion: "remote-collaboration/v1",
      type: "server.ready",
      deviceId: "mobile-1",
      peerDeviceId: "desktop-1",
      peerDeviceName: "Desktop",
      peerOnline: true,
    }) });
  }

  emitError(): void {
    this.onerror?.();
  }

  emitClose(): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.();
  }
}

function connectionStorage(): MobileRemoteStorage {
  const binding = bindingForConnection();
  return {
    async getPairing() { return undefined; },
    async savePairing() {},
    async clearPairing() {},
    async getBinding() { return binding; },
    async saveBinding() {},
    async clearBinding() {},
    async clearDeviceData() {},
    async putOutbox() {},
    async listOutbox() { return []; },
    async removeOutbox() {},
    async putPendingConversation() {},
    async listPendingConversations() { return []; },
    async removePendingConversation() {},
    async hasReceived() { return false; },
    async markReceived() {},
    async saveEvent() {},
    async listEvents() { return []; },
    async putVaultResource() {},
    async listVaultResources() { return []; },
    async applyVaultChanges() {},
    async getVaultCursor() { return 0; },
    async saveVaultCursor() {},
    async putVaultOutbox() {},
    async listVaultOutbox() { return []; },
    async removeVaultOutbox() {},
    async putVaultConflict() {},
    async listVaultConflicts() { return []; },
    async removeVaultConflict() {},
  };
}

function bindingForConnection() {
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

const vaultFetch: typeof globalThis.fetch = async () => new Response(JSON.stringify({
  ok: true,
  protocolVersion: "content-vault/v1",
  resources: [],
  changeCursor: 0,
}), { status: 200, headers: { "content-type": "application/json" } });

function tokenCredentials() {
  return {
    async readDeviceToken() { return "t".repeat(32); },
    async writeDeviceToken() {},
    async deleteDeviceToken() {},
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for the mobile relay test");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
