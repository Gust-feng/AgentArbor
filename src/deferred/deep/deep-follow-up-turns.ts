import { createId } from "../../kernel/id.js";
import type { DeepConversation, DeepRunFollowUpTurn } from "./contracts.js";

export function createDeepRunFollowUpTurn(input: {
  readonly runId: string;
  readonly correctionContext: readonly string[];
  readonly createdAt: string;
}): DeepRunFollowUpTurn {
  return {
    turnId: createId("deep-follow-up"),
    runId: input.runId,
    userMessage: deepRunFollowUpUserMessage(input.correctionContext),
    createdAt: input.createdAt,
  };
}

export function appendDeepRunFollowUpTurn(
  conversation: DeepConversation,
  followUp: DeepRunFollowUpTurn,
): DeepConversation {
  return {
    ...conversation,
    followUpTurns: [...(conversation.followUpTurns ?? []), followUp],
    updatedAt: followUp.createdAt,
  };
}

export function deepRunFollowUpUserMessage(correctionContext: readonly string[]): string {
  return correctionContext
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .join("\n");
}
