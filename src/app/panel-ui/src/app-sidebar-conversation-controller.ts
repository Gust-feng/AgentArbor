import type React from "react";
import {
  type ConversationManagementResponse,
  isMissingConversationError,
  removeConversation,
  renameConversationTitle,
  updateConversationPinnedState,
  upsertConversationSummary,
} from "./app-conversation-management";
import type { AppState } from "./app-state";
import type { ContextAttachment } from "./contracts/context";

export type AppSidebarConversationController = {
  readonly renameConversation: (conversationId: string, title: string) => Promise<void>;
  readonly toggleConversationPinned: (conversationId: string, pinned: boolean) => Promise<void>;
  readonly deleteConversation: (conversationId: string) => Promise<void>;
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

  return {
    renameConversation,
    toggleConversationPinned,
    deleteConversation,
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


function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
