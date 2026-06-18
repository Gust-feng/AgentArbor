import type {
  AssistantMessageSegment,
  AssistantMessageSegmentLifecycle,
} from "./panel-assistant-message-structure.js";
import type { ConfirmationIdentity } from "./panel-transcript-confirmation-projection.js";
import type { ProjectableTranscriptNode } from "./panel-transcript-node-projection.js";

export type AssistantSegmentUpdatePolicy = {
  readonly updateContent: boolean;
  readonly carryCollapsedHint: boolean;
};

export function assistantSegmentUpdatePolicy<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(
  previous: AssistantMessageSegment<TNode, TConfirmation>,
  next: AssistantMessageSegment<TNode, TConfirmation>,
): AssistantSegmentUpdatePolicy {
  return {
    updateContent: shouldUpdateSegmentContent(previous.lifecycle, next.lifecycle),
    carryCollapsedHint: shouldCarryCollapsedHint(next.lifecycle),
  };
}

export function shouldUpdateSegmentContent(
  previous: AssistantMessageSegmentLifecycle,
  next: AssistantMessageSegmentLifecycle,
): boolean {
  return previous !== "settled" || next !== "settled";
}

export function shouldCarryCollapsedHint(lifecycle: AssistantMessageSegmentLifecycle): boolean {
  return lifecycle === "settled";
}
