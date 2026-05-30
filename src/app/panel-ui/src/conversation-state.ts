import type { ConversationSummary } from "./types";

export function isConversationWaitingForUser(conversation: ConversationSummary): boolean {
  return conversation.requiresUserAction === true || conversation.status === "approval_needed" || conversation.status === "needs_input";
}
