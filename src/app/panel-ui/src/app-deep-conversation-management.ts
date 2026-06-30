import { ApiError, deleteJson, postJson } from "./api";
import type {
  DeepConversationDeleteResponse,
  DeepConversationManagementResponse,
  DeepConversationSummary,
  DeepConversationView,
} from "./contracts/deep";

export function renameDeepConversationTitle(
  conversationId: string,
  title: string,
): Promise<DeepConversationManagementResponse> {
  return postJson<DeepConversationManagementResponse>(
    `/api/deep/conversations/${encodeURIComponent(conversationId)}/rename`,
    { title },
  );
}

export function updateDeepConversationPinnedState(
  conversationId: string,
  pinned: boolean,
): Promise<DeepConversationManagementResponse> {
  return postJson<DeepConversationManagementResponse>(
    `/api/deep/conversations/${encodeURIComponent(conversationId)}/pin`,
    { pinned },
  );
}

export function removeDeepConversation(
  conversationId: string,
): Promise<DeepConversationDeleteResponse> {
  return deleteJson<DeepConversationDeleteResponse>(`/api/deep/conversations/${encodeURIComponent(conversationId)}`);
}

export function upsertManagedDeepConversationSummary(
  conversations: readonly DeepConversationSummary[],
  conversation: DeepConversationView,
): readonly DeepConversationSummary[] {
  const summary: DeepConversationSummary = {
    conversationId: conversation.conversationId,
    title: conversation.title,
    titleEditedAt: conversation.titleEditedAt,
    goal: conversation.goal,
    currentObjective: conversation.currentObjective,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    pinnedAt: conversation.pinnedAt,
  };
  return conversations.some((item) => item.conversationId === conversation.conversationId)
    ? conversations.map((item) => item.conversationId === conversation.conversationId ? { ...item, ...summary } : item)
    : [summary, ...conversations];
}

export function isMissingDeepConversationError(error: unknown): boolean {
  return error instanceof ApiError &&
    error.status === 404 &&
    error.code === "deep_conversation_not_found";
}
