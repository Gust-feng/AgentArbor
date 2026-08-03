import { describe, expect, test } from "vitest";

import { applyRemoteEvent, RemoteMobileClient, type MobileRemoteState } from "./remote-client";
import type { MobileRemoteStorage } from "./storage";

describe("mobile remote projection", () => {
  test("replaces snapshots by stable identity and resolves pending command results", () => {
    const initial = state({ pendingCommandIds: ["command-1"] });
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
    expect(completed.commandResults[0]?.status).toBe("applied");
  });

  test("keeps CAS conflicts visible to the user", () => {
    const result = applyRemoteEvent(state({ pendingCommandIds: ["note-command"] }), {
      kind: "command.result",
      eventId: "result-conflict",
      commandId: "note-command",
      status: "conflict",
      error: { code: "note_version_conflict", message: "The notebook changed on desktop" },
    });
    expect(result.pendingCommandIds).toEqual([]);
    expect(result.commandResults[0]?.error?.code).toBe("note_version_conflict");
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

  test("merges paged assets and resets stale assets when a new snapshot starts", () => {
    const first = applyRemoteEvent(state(), assetPage("snapshot-1", 0, 2, "asset-1"));
    const second = applyRemoteEvent(first, assetPage("snapshot-1", 1, 2, "asset-2"));
    const reset = applyRemoteEvent(second, assetPage("snapshot-2", 0, 1, "asset-2"));

    expect(second.assets.map((asset) => asset.assetId).sort()).toEqual(["asset-1", "asset-2"]);
    expect(reset.assets.map((asset) => asset.assetId)).toEqual(["asset-2"]);
  });

  test("merges managed files from consecutive pages of the same folder", () => {
    const first = applyRemoteEvent(state(), managedFolderPage("folder-snapshot", 0, 2, "a.md"));
    const second = applyRemoteEvent(first, managedFolderPage("folder-snapshot", 1, 2, "b.md"));

    expect(second.managedFolders).toHaveLength(1);
    expect(second.managedFolders[0]?.files.map((file) => file.relativePath).sort()).toEqual(["a.md", "b.md"]);
  });

  test("keeps an offline command in the mobile outbox", async () => {
    let stored: unknown;
    const storage = {
      async putOutbox(entry: unknown) { stored = entry; },
    } as unknown as MobileRemoteStorage;
    const client = new RemoteMobileClient(storage);

    const commandId = await client.sendCommand({ kind: "conversation.submit", message: "queued locally" });

    expect(stored).toMatchObject({
      clientMessageId: commandId,
      content: { type: "command", command: { commandId, message: "queued locally" } },
    });
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
});

function state(overrides: Partial<MobileRemoteState> = {}): MobileRemoteState {
  return {
    connection: "connected",
    peerOnline: true,
    conversations: [],
    conversationPages: {},
    runs: [],
    spaces: [],
    notebooks: [],
    assets: [],
    managedFolders: [],
    pendingCommandIds: [],
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

function assetPage(snapshotId: string, pageIndex: number, pageCount: number, assetId: string) {
  return {
    kind: "asset.snapshot" as const,
    eventId: `${snapshotId}-${pageIndex}`,
    snapshotId,
    pageIndex,
    pageCount,
    assets: [{
      assetId,
      title: assetId,
      kind: "markdown" as const,
      text: assetId,
      language: "md",
      fingerprint: `sha256:${"a".repeat(64)}`,
    }],
  };
}

function managedFolderPage(snapshotId: string, pageIndex: number, pageCount: number, relativePath: string) {
  return {
    kind: "managed_folder.snapshot" as const,
    eventId: `${snapshotId}-${pageIndex}`,
    snapshotId,
    pageIndex,
    pageCount,
    folders: [{
      referenceId: "folder-1",
      spaceId: "space-1",
      title: "Folder",
      files: [{ relativePath, text: relativePath, fingerprint: `sha256:${"b".repeat(64)}` }],
    }],
  };
}
