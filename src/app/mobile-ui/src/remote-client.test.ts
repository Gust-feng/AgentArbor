import { describe, expect, test } from "vitest";

import { applyRemoteEvent, RemoteMobileClient, type MobileRemoteState } from "./remote-client";
import type { MobileRemoteStorage } from "./storage";

describe("mobile remote projection", () => {
  test("replaces snapshots by stable identity and resolves pending command results", () => {
    const initial = state({ pendingCommandIds: ["command-1"] });
    const first = applyRemoteEvent(initial, {
      kind: "conversation.snapshot",
      eventId: "event-1",
      conversationId: "conversation-1",
      title: "First title",
      updatedAt: "2026-08-03T00:00:00.000Z",
      turns: [],
    });
    const replaced = applyRemoteEvent(first, {
      kind: "conversation.snapshot",
      eventId: "event-2",
      conversationId: "conversation-1",
      title: "Updated title",
      updatedAt: "2026-08-03T00:00:01.000Z",
      turns: [],
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
      deviceId: "mobile-1",
      accessToken: "token-1",
      peerDeviceId: "desktop-1",
      peerDeviceName: "Desktop",
    };
    let request: { url: string; authorization?: string } | undefined;
    let clearedDeviceData = false;
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
    const client = new RemoteMobileClient(storage, fetch);

    await client.forgetDevice();

    expect(request).toEqual({ url: "http://relay.local/v1/devices/mobile-1/revoke", authorization: "Bearer token-1" });
    expect(clearedDeviceData).toBe(true);
  });
});

function state(overrides: Partial<MobileRemoteState> = {}): MobileRemoteState {
  return {
    connection: "connected",
    peerOnline: true,
    conversations: [],
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
