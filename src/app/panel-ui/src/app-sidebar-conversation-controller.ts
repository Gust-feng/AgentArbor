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
import type { LegacyConversationScreen } from "./app-screen";
import type { ContextAttachment } from "./contracts/context";

export type AppSidebarConversationController = {
  readonly renameConversation: (conversationId: string, title: string) => Promise<void>;
  readonly toggleConversationPinned: (conversationId: string, pinned: boolean) => Promise<void>;
  readonly deleteConversation: (conversationId: string) => Promise<void>;
};

export type AppSidebarConversationControllerOptions = {
  readonly app: AppState;
  readonly appRef: React.MutableRefObject<AppState>;
  readonly setApp: React.Dispatch<React.SetStateAction<AppState>>;
  readonly mountedRef: React.MutableRefObject<boolean>;
  readonly mutationConversationIdsRef: React.MutableRefObject<Set<string>>;
  readonly setMutationConversationIds: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  readonly resetChat: () => void;
  readonly setSelectedWorkspaceDirectory: React.Dispatch<React.SetStateAction<string | undefined>>;
  readonly setInputCloseSignal: React.Dispatch<React.SetStateAction<number>>;
  readonly setGoal: React.Dispatch<React.SetStateAction<string>>;
  readonly setAttachments: React.Dispatch<React.SetStateAction<readonly ContextAttachment[]>>;
  readonly setLegacyConversationScreen: (screen: LegacyConversationScreen) => void;
};

export function createAppSidebarConversationController(
  options: AppSidebarConversationControllerOptions,
): AppSidebarConversationController {
  async function renameConversation(conversationId: string, title: string): Promise<void> {
    await runConversationMutation(conversationId, async () => {
      const response = await renameConversationTitle(conversationId, title);
      if (!options.mountedRef.current) return;
      applyConversationManagementResponse(response);
    }, "重命名会话失败。");
  }

  async function toggleConversationPinned(conversationId: string, pinned: boolean): Promise<void> {
    const previousPinnedAt = conversationPinnedAt(options.appRef.current, conversationId);
    const optimisticPinnedAt = pinned ? new Date().toISOString() : undefined;
    await runConversationMutation(conversationId, async () => {
      options.setApp((previous) => patchConversationPinnedAt(previous, conversationId, optimisticPinnedAt));
      const response = await updateConversationPinnedState(conversationId, pinned);
      if (!options.mountedRef.current) return;
      applyConversationManagementResponse(response);
    }, "更新会话置顶失败。", (previous) => patchConversationPinnedAt(previous, conversationId, previousPinnedAt));
  }

  async function deleteConversation(conversationId: string): Promise<void> {
    await runConversationMutation(conversationId, async () => {
      const response = await removeConversation(conversationId);
      if (!options.mountedRef.current) return;
      if (options.appRef.current.conversation?.conversationId === conversationId) {
        options.setSelectedWorkspaceDirectory(undefined);
        options.resetChat();
      }
      options.setApp((previous) => ({
        ...previous,
        conversations: (response.conversations ?? previous.conversations).filter((item) => item.conversationId !== conversationId),
        error: undefined,
      }));
    }, "删除会话失败。", undefined, (error) => {
      if (isMissingConversationError(error)) {
        if (options.appRef.current.conversation?.conversationId === conversationId) {
          options.setSelectedWorkspaceDirectory(undefined);
          options.resetChat();
        }
        options.setApp((previous) => ({
          ...previous,
          conversations: previous.conversations.filter((item) => item.conversationId !== conversationId),
          error: undefined,
        }));
        return true;
      }
      return false;
    });
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

  async function runConversationMutation(
    conversationId: string,
    operation: () => Promise<void>,
    fallbackError: string,
    rollback?: (previous: AppState) => AppState,
    recover?: (error: unknown) => boolean,
  ): Promise<void> {
    if (options.mutationConversationIdsRef.current.has(conversationId)) return;
    setConversationMutation(conversationId, true);
    try {
      await operation();
    } catch (error: unknown) {
      if (!options.mountedRef.current || recover?.(error) === true) return;
      options.setApp((previous) => ({
        ...(rollback?.(previous) ?? previous),
        error: errorText(error, fallbackError),
      }));
    } finally {
      if (options.mountedRef.current) setConversationMutation(conversationId, false);
    }
  }

  function setConversationMutation(conversationId: string, pending: boolean): void {
    const next = new Set(options.mutationConversationIdsRef.current);
    if (pending) {
      next.add(conversationId);
    } else {
      next.delete(conversationId);
    }
    options.mutationConversationIdsRef.current = next;
    options.setMutationConversationIds(next);
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
