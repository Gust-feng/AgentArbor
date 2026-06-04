import type { ConversationSummary } from "./contracts/conversation";

export type ConversationUserActionKind = "approval" | "input";

export function conversationUserActionKind(
  conversation: ConversationSummary
): ConversationUserActionKind | undefined {
  if (conversation.status === "approval_needed") {
    return "approval";
  }
  if (conversation.status === "needs_input") {
    return "input";
  }
  return conversation.requiresUserAction === true ? "approval" : undefined;
}

export function isConversationApprovalNeeded(conversation: ConversationSummary): boolean {
  return conversationUserActionKind(conversation) === "approval";
}

export function isConversationNeedsInput(conversation: ConversationSummary): boolean {
  return conversationUserActionKind(conversation) === "input";
}

export function isConversationWaitingForUser(conversation: ConversationSummary): boolean {
  return conversationUserActionKind(conversation) !== undefined;
}
