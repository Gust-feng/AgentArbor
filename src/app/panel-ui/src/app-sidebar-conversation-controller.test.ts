import { afterEach, expect, test, vi } from "vitest";
import type React from "react";
import type { Conversation, ConversationSummary } from "./contracts/conversation";
import { createAppSidebarConversationController, type AppSidebarConversationControllerOptions } from "./app-sidebar-conversation-controller";
import { createInitialAppState, type AppState } from "./app-state";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("refreshes the owning Space after pinning a Space-owned conversation", async () => {
  const refreshSpaceConversations = vi.fn().mockResolvedValue(undefined);
  const { controller } = createFixture({
    conversations: [spaceConversationSummary("conversation-1")],
    options: { refreshSpaceConversations },
  });
  stubConversationPinResponse("conversation-1", true);

  await controller.toggleConversationPinned("conversation-1", true);

  expect(refreshSpaceConversations).toHaveBeenCalledTimes(1);
  expect(refreshSpaceConversations).toHaveBeenCalledWith("space-1");
});

test("does not refresh any Space for a workspace-owned conversation", async () => {
  const refreshSpaceConversations = vi.fn().mockResolvedValue(undefined);
  const { controller } = createFixture({
    conversations: [{ conversationId: "conversation-1", title: "工作区会话", owner: { kind: "workspace", id: "workspace-1" } }],
    options: { refreshSpaceConversations },
  });
  stubConversationPinResponse("conversation-1", true);

  await controller.toggleConversationPinned("conversation-1", true);

  expect(refreshSpaceConversations).not.toHaveBeenCalled();
});

test("does not refresh any Space for a legacy conversation without an owner", async () => {
  const refreshSpaceConversations = vi.fn().mockResolvedValue(undefined);
  const { controller } = createFixture({
    conversations: [{ conversationId: "conversation-legacy", title: "旧对话" }],
    options: { refreshSpaceConversations },
  });
  stubConversationPinResponse("conversation-legacy", true);

  await controller.toggleConversationPinned("conversation-legacy", true);

  expect(refreshSpaceConversations).not.toHaveBeenCalled();
});

test("refreshes the owning Space after renaming a Space-owned conversation", async () => {
  const refreshSpaceConversations = vi.fn().mockResolvedValue(undefined);
  const { controller, appRef } = createFixture({
    conversations: [spaceConversationSummary("conversation-1")],
    options: { refreshSpaceConversations },
  });
  stubConversationResponse("/api/conversations/conversation-1/rename", conversationResponse("conversation-1", "新标题"));

  await controller.renameConversation("conversation-1", "新标题");

  expect(refreshSpaceConversations).toHaveBeenCalledTimes(1);
  expect(refreshSpaceConversations).toHaveBeenCalledWith("space-1");
  expect(appRef.current.conversations[0]?.title).toBe("新标题");
});

test("refreshes the owning Space after deleting a Space-owned conversation", async () => {
  const refreshSpaceConversations = vi.fn().mockResolvedValue(undefined);
  const { controller } = createFixture({
    conversations: [spaceConversationSummary("conversation-1")],
    options: { refreshSpaceConversations },
  });
  stubDeleteConversationResponse("conversation-1");

  await controller.deleteConversation("conversation-1");

  expect(refreshSpaceConversations).toHaveBeenCalledTimes(1);
  expect(refreshSpaceConversations).toHaveBeenCalledWith("space-1");
});

test("keeps the mutation outcome when the Space refresh fails", async () => {
  const refreshSpaceConversations = vi.fn().mockRejectedValue(new Error("refresh failed"));
  const { controller, appRef } = createFixture({
    conversations: [spaceConversationSummary("conversation-1")],
    options: { refreshSpaceConversations },
  });
  stubConversationPinResponse("conversation-1", true);

  await expect(controller.toggleConversationPinned("conversation-1", true)).resolves.toBeUndefined();
  expect(appRef.current.conversations[0]?.pinnedAt).toBeDefined();
  expect(appRef.current.error).toBeUndefined();
});

function createFixture(input: {
  readonly conversations?: readonly ConversationSummary[];
  readonly options?: Partial<AppSidebarConversationControllerOptions>;
} = {}) {
  const app = { ...createInitialAppState(), conversations: [...(input.conversations ?? [])] } as AppState;
  const appRef = { current: app };
  const setApp: React.Dispatch<React.SetStateAction<AppState>> = (updater) => {
    appRef.current = typeof updater === "function"
      ? (updater as (previous: AppState) => AppState)(appRef.current)
      : updater;
  };
  const mutationConversationIdsRef = { current: new Set<string>() };
  const setMutationConversationIds = vi.fn();
  const optionsWithDefaults: AppSidebarConversationControllerOptions = {
    app,
    appRef,
    setApp,
    mountedRef: { current: true },
    mutationConversationIdsRef,
    setMutationConversationIds,
    resetChat: vi.fn(),
    setInputCloseSignal: vi.fn(),
    setGoal: vi.fn(),
    setAttachments: vi.fn(),
    setLegacyConversationScreen: vi.fn(),
    ...(input.options ?? {}),
  };
  return {
    controller: createAppSidebarConversationController(optionsWithDefaults),
    appRef,
    setApp,
  };
}

function spaceConversationSummary(conversationId: string): ConversationSummary {
  return {
    conversationId,
    title: "空间会话",
    owner: { kind: "space", id: "space-1" },
  };
}

function conversationResponse(conversationId: string, title: string): { readonly conversation: Conversation } {
  return { conversation: { conversationId, title, turns: [] } };
}

function stubConversationPinResponse(conversationId: string, pinned: boolean): void {
  stubConversationResponse(
    `/api/conversations/${encodeURIComponent(conversationId)}/pin`,
    { conversation: { conversationId, title: "空间会话", turns: [], pinnedAt: pinned ? "2026-08-01T00:00:00.000Z" : undefined } },
  );
}

function stubConversationResponse(path: string, body: unknown): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) !== path) throw new Error(`Unexpected request: ${input}`);
    return jsonResponse(body);
  }));
}

function stubDeleteConversationResponse(conversationId: string): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) !== `/api/conversations/${encodeURIComponent(conversationId)}`) throw new Error(`Unexpected request: ${input}`);
    return jsonResponse({ ok: true, conversations: [] });
  }));
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
