import React from "react";
import type { TranscriptNode } from "../contracts/run";
import {
  ConfirmationNode,
  type ConfirmationProjection,
} from "./transcript-confirmation";
import {
  type AgentWorkTimelineView,
} from "../../../panel-agent-work-timeline-view";
import type { ActivityItem } from "../../../panel-transcript-activity-copy";

export type { ConfirmationProjection } from "./transcript-confirmation";
export { pendingForTurn } from "../../../panel-transcript-confirmation-projection";

export function AgentWorkTimeline(props: {
  readonly view: AgentWorkTimelineView<TranscriptNode, ConfirmationProjection>;
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
}): React.ReactElement | null {
  const { confirmation, items } = props.view;

  if (!props.view.hasContent) return null;

  return (
    <section className="agent-workline" aria-label="工作进度">
      <div className="agent-activity">
        {items.map((item, index) => (
          <div
            className={`agent-activity-step ${item.tone} ${item.phase}`}
            data-current={confirmation.current === undefined && index === items.length - 1 ? "true" : undefined}
            aria-current={confirmation.current === undefined && index === items.length - 1 ? "step" : undefined}
            key={item.key}
          >
            <span className="agent-activity-marker" aria-hidden="true" />
            <ActivityLine item={item} />
          </div>
        ))}
        {confirmation.current !== undefined && (
          <div className="agent-activity-step confirmation waiting_approval" data-current="true" aria-current="step">
            <span className="agent-activity-marker" aria-hidden="true" />
            <ConfirmationNode
              confirmation={confirmation.current}
              busy={props.confirmationBusy}
              onDecision={props.onDecision}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function ActivityLine({ item }: { readonly item: ActivityItem }): React.ReactElement {
  const label = item.copy.label;
  const line = (
    <>
      {label !== undefined && <span className="agent-activity-label">{label}</span>}
      <span className="agent-activity-detail">{item.copy.detail}</span>
    </>
  );
  if (item.copy.expandedDetail !== undefined) {
    return (
      <details className="agent-activity-disclosure" data-tone={item.tone}>
        <summary className="agent-activity-line">{line}</summary>
        <p className="agent-activity-expanded-detail">{item.copy.expandedDetail}</p>
      </details>
    );
  }
  return (
    <p className="agent-activity-line">
      {line}
    </p>
  );
}
