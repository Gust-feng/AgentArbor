import React from "react";
import type { TranscriptNode } from "../contracts/run";
import { ConfirmationNode, confirmationForNode, type ConfirmationProjection } from "./transcript-confirmation";
import { ToolNodeDetail } from "./transcript-tool-detail";

export function TranscriptTimelineDetail(props: {
  readonly node: TranscriptNode;
  readonly pending?: ConfirmationProjection;
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
}): React.ReactElement | undefined {
  if (props.node.kind === "thinking") {
    return undefined;
  }
  if (props.node.kind === "confirmation") {
    const confirmation = confirmationForNode(props.node, props.pending);
    return (
      <ConfirmationNode
        confirmation={confirmation}
        busy={props.confirmationBusy}
        onDecision={props.onDecision}
      />
    );
  }
  if (props.node.kind === "tool") {
    return <ToolNodeDetail node={props.node} />;
  }
  if (props.node.kind === "user_decision" && props.node.summary !== undefined) {
    return <p className="transcript-node-summary">{props.node.summary}</p>;
  }
  if (props.node.kind === "system" && props.node.summary !== undefined) {
    return <p className="transcript-node-summary">{props.node.summary}</p>;
  }
  return undefined;
}
