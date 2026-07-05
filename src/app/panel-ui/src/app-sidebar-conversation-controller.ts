import type React from "react";
import {
  type ConversationManagementResponse,
  isMissingConversationError,
  removeConversation,
  renameConversationTitle,
  updateConversationPinnedState,
  upsertConversationSummary,
} from "./app-conversation-management";
import {
  isMissingDeepConversationError,
  removeDeepConversation,
  renameDeepConversationTitle,
  updateDeepConversationPinnedState,
  upsertManagedDeepConversationSummary,
} from "./app-deep-conversation-management";
import type { DeepRunUpdateController } from "./app-deep-live-updates";
import type { AppState } from "./app-state";
import type { ContextAttachment } from "./contracts/context";

export type AppSidebarConversationController = {
  readonly renameConversation: (conversationId: string, title: string) => Promise<void>;
  readonly toggleConversationPinned: (conversationId: string, pinned: boolean) => Promise<void>;
  readonly deleteConversation: (conversationId: string) => Promise<void>;
  readonly renameDeepConversation: (conversationId: string, title: string) => Promise<void>;
  readonly toggleDeepConversationPinned: (conversationId: string, pinned: boolean) => Promise<void>;
  readonly deleteDeepConversation: (conversationId: string) => Promise<void>;
};

export type AppSidebarConversationControllerOptions = {
  readonly app: AppState;
  readonly setApp: React.Dispatch<React.SetStateAction<AppState>>;
  readonly mountedRef: React.MutableRefObject<boolean>;
  readonly pinningConversationIdsRef: React.MutableRefObject<Set<string>>;
  readonly setPinningConversationIds: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  readonly resetChat: () => void;
  readonly setSelectedWorkspaceDirectory: React.Dispatch<React.SetStateAction<string | undefined>>;
  readonly setInputCloseSignal: React.Dispatch<React.SetStateAction<number>>;
  readonly setGoal: React.Dispatch<React.SetStateAction<string>>;
  readonly setAttachments: React.Dispatch<React.SetStateAction<readonly ContextAttachment[]>>;
  readonly setScreen: (screen: "chat-empty" | "chat-active") => void;
  readonly deepRunUpdateController: DeepRunUpdateController;
};

export function createAppSidebarConversationController(
  options: AppSidebarConversationControllerOptions,
): AppSidebarConversationController {
  async function renameConversation(conversationId: string, title: string): Promise<void> {
    try {
      const response = await renameConversationTitle(conversationId, title);
      if (!options.mountedRef.current) return;
      applyConversationManagementResponse(response);
    } catch (error) {
      if (options.mountedRef.current) {
        options.setApp((previous) => ({ ...previous, error: errorText(error, "重命名会话失败。") }));
      }
    }
  }

  async function toggleConversationPinned(conversationId: string, pinned: boolean): Promise<void> {
    if (options.pinningConversationIdsRef.current.has(conversationId)) return;
    const previousPinnedAt = conversationPinnedAt(options.app, conversationId);
    const optimisticPinnedAt = pinned ? new Date().toISOString() : undefined;
    setConversationPinning(conversationId, true);
    options.setApp((previous) => patchConversationPinnedAt(previous, conversationId, optimisticPinnedAt));
    try {
      const response = await updateConversationPinnedState(conversationId, pinned);
      if (!options.mountedRef.current) return;
      applyConversationManagementResponse(response);
    } catch (error) {
      if (options.mountedRef.current) {
        options.setApp((previous) => ({
          ...patchConversationPinnedAt(previous, conversationId, previousPinnedAt),
          error: errorText(error, "更新会话置顶失败。"),
        }));
      }
    } finally {
      if (!options.mountedRef.current) return;
      setConversationPinning(conversationId, false);
    }
  }

  async function deleteConversation(conversationId: string): Promise<void> {
    try {
      const response = await removeConversation(conversationId);
      if (!options.mountedRef.current) return;
      options.setSelectedWorkspaceDirectory(undefined);
      options.resetChat();
      options.setApp((previous) => ({
        ...previous,
        conversations: (response.conversations ?? previous.conversations).filter((item) => item.conversationId !== conversationId),
        error: undefined,
      }));
    } catch (error) {
      if (options.mountedRef.current) {
        if (isMissingConversationError(error)) {
          options.setSelectedWorkspaceDirectory(undefined);
          options.resetChat();
          options.setApp((previous) => ({
            ...previous,
            conversations: previous.conversations.filter((item) => item.conversationId !== conversationId),
            error: undefined,
          }));
        } else {
          options.setApp((previous) => ({ ...previous, error: errorText(error, "删除会话失败。") }));
        }
      }
    }
  }

  async function renameDeepConversation(conversationId: string, title: string): Promise<void> {
    try {
      const response = await renameDeepConversationTitle(conversationId, title);
      if (!options.mountedRef.current) return;
      applyDeepConversationManagementResponse(response);
    } catch (error) {
      if (options.mountedRef.current) {
        options.setApp((previous) => ({ ...previous, error: errorText(error, "重命名 Agent 集群会话失败。") }));
      }
    }
  }

  async function toggleDeepConversationPinned(conversationId: string, pinned: boolean): Promise<void> {
    if (options.pinningConversationIdsRef.current.has(conversationId)) return;
    const previousPinnedAt = deepConversationPinnedAt(options.app, conversationId);
    const optimisticPinnedAt = pinned ? new Date().toISOString() : undefined;
    setConversationPinning(conversationId, true);
    options.setApp((previous) => patchDeepConversationPinnedAt(previous, conversationId, optimisticPinnedAt));
    try {
      const response = await updateDeepConversationPinnedState(conversationId, pinned);
      if (!options.mountedRef.current) return;
      applyDeepConversationManagementResponse(response);
    } catch (error) {
      if (options.mountedRef.current) {
        options.setApp((previous) => ({
          ...patchDeepConversationPinnedAt(previous, conversationId, previousPinnedAt),
          error: errorText(error, "更新 Agent 集群会话置顶失败。"),
        }));
      }
    } finally {
      if (!options.mountedRef.current) return;
      setConversationPinning(conversationId, false);
    }
  }

  async function deleteDeepConversation(conversationId: string): Promise<void> {
    try {
      const response = await removeDeepConversation(conversationId);
      if (!options.mountedRef.current) return;
      clearDeletedDeepConversation(conversationId, response.conversations);
    } catch (error) {
      if (options.mountedRef.current) {
        if (isMissingDeepConversationError(error)) {
          clearDeletedDeepConversation(conversationId);
        } else {
          options.setApp((previous) => ({ ...previous, error: errorText(error, "删除 Agent 集群会话失败。") }));
        }
      }
    }
  }

  function applyConversationManagementResponse(response: ConversationManagementResponse): void {
    options.setApp((previous) => ({
      ...previous,
      conversations: response.conversations ?? upsertConversationSummary(previous.conversations, response.conversation),
      conversation:
        previous.conversation?.conversationId === response.conversation.conversationId
          ? response.conversation
          : previous.conversation,
      error: undefined,
    }));
  }

  function applyDeepConversationManagementResponse(response: {
    readonly conversation: AppState["deepConversation"];
    readonly conversations?: AppState["deepConversations"];
  }): void {
    const conversation = response.conversation;
    if (conversation === undefined) {
      return;
    }
    options.setApp((previous) => ({
      ...previous,
      deepConversations: response.conversations ??
        upsertManagedDeepConversationSummary(previous.deepConversations, conversation),
      deepConversation:
        previous.deepConversation?.conversationId === conversation.conversationId
          ? conversation
          : previous.deepConversation,
      deep:
        previous.deep?.conversation?.conversationId === conversation.conversationId
          ? {
            ...previous.deep,
            conversation,
          }
          : previous.deep,
      error: undefined,
    }));
  }

  function setConversationPinning(conversationId: string, pinning: boolean): void {
    const next = new Set(options.pinningConversationIdsRef.current);
    if (pinning) {
      next.add(conversationId);
    } else {
      next.delete(conversationId);
    }
    options.pinningConversationIdsRef.current = next;
    options.setPinningConversationIds(next);
  }

  function clearDeletedDeepConversation(
    conversationId: string,
    nextConversations?: AppState["deepConversations"],
  ): void {
    options.deepRunUpdateController.stopPolling();
    options.setSelectedWorkspaceDirectory(undefined);
    options.setInputCloseSignal((value) => value + 1);
    options.setGoal("");
    options.setAttachments([]);
    options.setScreen("chat-empty");
    options.setApp((previous) => ({
      ...previous,
      deep: undefined,
      deepConversation: undefined,
      deepIntakeStatus: undefined,
      deepPendingGoal: undefined,
      deepActiveRunId: undefined,
      deepSelectedRunId: undefined,
      deepBusy: false,
      deepConversations: (nextConversations ?? previous.deepConversations)
        .filter((item) => item.conversationId !== conversationId),
      deepRuns: previous.deepRuns.filter((item) => item.conversationId !== conversationId),
      error: undefined,
    }));
  }

  return {
    renameConversation,
    toggleConversationPinned,
    deleteConversation,
    renameDeepConversation,
    toggleDeepConversationPinned,
    deleteDeepConversation,
  };
}

function conversationPinnedAt(app: AppState, conversationId: string): string | undefined {
  return app.conversation?.conversationId === conversationId
    ? app.conversation.pinnedAt
    : app.conversations.find((conversation) => conversation.conversationId === conversationId)?.pinnedAt;
}

function patchConversationPinnedAt(
  app: AppState,
  conversationId: string,
  pinnedAt: string | undefined,
): AppState {
  return {
    ...app,
    conversations: app.conversations.map((conversation) =>
      conversation.conversationId === conversationId
        ? { ...conversation, pinnedAt }
        : conversation
    ),
    conversation: app.conversation?.conversationId === conversationId
      ? { ...app.conversation, pinnedAt }
      : app.conversation,
  };
}

function deepConversationPinnedAt(app: AppState, conversationId: string): string | undefined {
  return app.deepConversation?.conversationId === conversationId
    ? app.deepConversation.pinnedAt
    : app.deepConversations.find((conversation) => conversation.conversationId === conversationId)?.pinnedAt;
}

function patchDeepConversationPinnedAt(
  app: AppState,
  conversationId: string,
  pinnedAt: string | undefined,
): AppState {
  return {
    ...app,
    deepConversations: app.deepConversations.map((conversation) =>
      conversation.conversationId === conversationId
        ? { ...conversation, pinnedAt }
        : conversation
    ),
    deepConversation: app.deepConversation?.conversationId === conversationId
      ? { ...app.deepConversation, pinnedAt }
      : app.deepConversation,
    deep:
      app.deep?.conversation?.conversationId === conversationId
        ? {
          ...app.deep,
          conversation: {
            ...app.deep.conversation,
            pinnedAt,
          },
        }
        : app.deep,
  };
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
