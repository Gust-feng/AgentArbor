import React from "react";
import type { TranscriptNode } from "../contracts/run";
import { confirmationRunId, type ConfirmationProjection } from "./transcript-confirmation";
import { timelineVisibleNodes } from "./transcript-node-visibility";
import { timelineRowIdentity } from "./transcript-timeline-classification";
import { AgentTimelineRow } from "./transcript-timeline-row";

export type { ConfirmationProjection } from "./transcript-confirmation";

export function AgentWorkTimeline(props: {
  readonly nodes: readonly TranscriptNode[];
  readonly pending?: ConfirmationProjection;
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
}): React.ReactElement | null {
  const nodes = timelineVisibleNodes(props.nodes);
  if (nodes.length === 0) return null;

  return (
    <section className="agent-work-timeline" aria-label="工作进度">
      <div className="agent-timeline-track">
        {nodes.map((node, index) => (
          <AgentTimelineRow
            key={timelineRowIdentity(node)}
            node={node}
            isLast={index === nodes.length - 1}
            pending={props.pending}
            onDecision={props.onDecision}
            confirmationBusy={props.confirmationBusy}
          />
        ))}
      </div>
    </section>
  );
}

export function pendingForTurn(pending: ConfirmationProjection | undefined, runId: string | undefined): ConfirmationProjection | undefined {
  if (pending === undefined || runId === undefined) return undefined;
  const pendingRunId = confirmationRunId(pending);
  return pendingRunId === undefined || pendingRunId === runId ? pending : undefined;
}
