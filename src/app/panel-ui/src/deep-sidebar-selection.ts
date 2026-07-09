export type DeepConversationSelectionLike = {
  readonly conversationId: string;
  readonly latestRun?: {
    readonly runId: string;
  };
};

export function isDeepConversationActive<TConversation extends DeepConversationSelectionLike>(
  conversation: TConversation,
  input: {
    readonly activeConversationId?: string;
    readonly activeRunId?: string;
  },
): boolean {
  if (conversation.conversationId === input.activeConversationId) {
    return true;
  }
  return conversation.latestRun !== undefined &&
    input.activeRunId !== undefined &&
    conversation.latestRun.runId === input.activeRunId;
}
