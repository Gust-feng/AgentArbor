import type React from "react";
import { afterEach, expect, test, vi } from "vitest";
import { createInitialAppState, type AppState } from "./app-state";
import { loadConversationSession } from "./app-conversation-session";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("resolves conversation opening before historical transcript backfill completes", async () => {
  let resolveHistorical!: (response: Response) => void;
  let historicalRequested = false;
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const path = String(input);
    if (path === "/api/conversations/conversation-target") {
      return Promise.resolve(new Response(JSON.stringify({
        conversation: {
          conversationId: "conversation-target",
          title: "目标会话",
          latestRunId: "run-latest",
          turns: [
            { turnId: "turn-old", role: "assistant", content: "旧回答", status: "completed", runId: "run-old" },
            { turnId: "turn-latest", role: "assistant", content: "新回答", status: "completed", runId: "run-latest" },
          ],
        },
      }), { status: 200 }));
    }
    if (path === "/api/basic-agent/runs/run-old/view") {
      historicalRequested = true;
      return new Promise<Response>((resolve) => { resolveHistorical = resolve; });
    }
    throw new Error(`Unexpected request: ${path}`);
  }));

  let app: AppState = createInitialAppState();
  const setApp: React.Dispatch<React.SetStateAction<AppState>> = (next) => {
    app = typeof next === "function" ? next(app) : next;
  };
  const conversationLoadAbortRef = { current: undefined as AbortController | undefined };
  const open = loadConversationSession({
    app,
    setApp,
    setLegacyConversationScreen: vi.fn(),
    setGoal: vi.fn(),
    setAttachments: vi.fn(),
    mountedRef: { current: true },
    pollTimer: { current: undefined },
    streamRef: { current: undefined },
    fallbackPollRef: { current: undefined },
    activeRunIdRef: { current: undefined },
    viewEpochRef: { current: 0 },
    conversationLoadAbortRef,
    refreshConversations: vi.fn(async () => undefined),
    startLiveUpdates: vi.fn(),
  }, "conversation-target");

  await vi.waitFor(() => expect(app.conversation?.conversationId).toBe("conversation-target"));
  expect(historicalRequested).toBe(true);
  await expect(open).resolves.toBe(true);

  resolveHistorical!(new Response(JSON.stringify({ view: undefined }), { status: 200 }));
});
