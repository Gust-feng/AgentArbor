import React, { useEffect, useState } from "react";
import type { TranscriptNode } from "../contracts/run";
import type { ConfirmationProjection } from "./transcript-confirmation";
import { timelineNarration } from "./transcript-timeline-copy";
import { TranscriptTimelineDetail } from "./transcript-timeline-detail";
import { TimelineEventHeader } from "./transcript-timeline-header";
import {
  defaultOpenForNode,
  nodeTone,
  timelineRowCanExpand,
  timelineRowCategory,
  timelineRowIdentity,
  timelineRowUsesEventLayout,
} from "./transcript-timeline-classification";

export function AgentTimelineRow(props: {
  readonly node: TranscriptNode;
  readonly isLast: boolean;
  readonly pending?: ConfirmationProjection;
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
}): React.ReactElement {
  const detail = TranscriptTimelineDetail({
    node: props.node,
    pending: props.pending,
    onDecision: props.onDecision,
    confirmationBusy: props.confirmationBusy,
  });
  const hasDetail = detail !== undefined;
  const expandable = hasDetail && timelineRowCanExpand(props.node);
  const rowIdentity = timelineRowIdentity(props.node);
  const [manualOpen, setManualOpen] = useState<boolean | undefined>(undefined);
  const eventLayout = timelineRowUsesEventLayout(props.node);
  const category = timelineRowCategory(props.node);
  const automaticOpen = defaultOpenForNode(props.node);
  const open = manualOpen ?? automaticOpen;

  useEffect(() => {
    setManualOpen(undefined);
  }, [rowIdentity]);

  const header = eventLayout
    ? (
        <TimelineEventHeader
          node={props.node}
          expandable={expandable}
          open={open}
          toggleOpen={() => setManualOpen((value) => !(value ?? automaticOpen))}
        />
      )
    : <p className="agent-timeline-thought">{timelineNarration(props.node)}</p>;

  return (
    <article
      className={`agent-timeline-row ${nodeTone(props.node)} ${eventLayout ? "event" : "thought"}`}
      data-open={open ? "true" : "false"}
      data-kind={props.node.kind}
      data-category={category}
      data-last={props.isLast ? "true" : "false"}
    >
      <span className="agent-timeline-marker" aria-hidden="true" />
      <div className="agent-timeline-row-body">
        {header}
        {eventLayout && open && hasDetail && (
          <div className="agent-timeline-row-detail">
            {detail}
          </div>
        )}
      </div>
    </article>
  );
}
