import {
  timelineConfirmationProjection,
  type ConfirmationNodeLike,
  type ConfirmationIdentity,
  type TimelineConfirmationProjection,
} from "./panel-transcript-confirmation-projection.js";
import {
  workflowItemsForNodes,
  type ActivityItem,
} from "./panel-transcript-activity-copy.js";
import {
  timelineVisibleNodes,
  type ProjectableTranscriptNode,
} from "./panel-transcript-node-projection.js";

export type AgentWorkTimelineView<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
> = {
  readonly nodes: readonly TNode[];
  readonly items: readonly ActivityItem[];
  readonly confirmation: TimelineConfirmationProjection<TConfirmation>;
  readonly hasContent: boolean;
};

export function projectAgentWorkTimelineView<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity = ConfirmationIdentity,
>(input: {
  readonly nodes: readonly TNode[];
  readonly pending?: TConfirmation;
}): AgentWorkTimelineView<TNode, TConfirmation> {
  const nodes = timelineVisibleNodes(input.nodes);
  const confirmation = timelineConfirmationProjection(confirmationNodesForProjection<TNode, TConfirmation>(nodes), input.pending);
  const items = workflowItemsForNodes(nodes)
    .filter((item) => item.nodeId !== confirmation.currentNodeId);
  return {
    nodes,
    items,
    confirmation,
    hasContent: items.length > 0 || confirmation.current !== undefined,
  };
}

function confirmationNodesForProjection<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(nodes: readonly TNode[]): readonly ConfirmationNodeLike<TConfirmation>[] {
  return nodes.filter((node): node is TNode & ConfirmationNodeLike<TConfirmation> => (
    node.kind === "confirmation" &&
    node.confirmation !== undefined &&
    typeof node.confirmation.confirmationId === "string"
  ));
}
