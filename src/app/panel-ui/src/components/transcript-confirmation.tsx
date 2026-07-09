import React from "react";
import type { DesktopWorkView, PendingConfirmation, TranscriptConfirmation } from "../contracts/run";
import { projectConfirmationDisplay } from "../confirmation-display-projection";

export type ConfirmationProjection = PendingConfirmation | NonNullable<DesktopWorkView["pendingConfirmation"]> | TranscriptConfirmation;

export function ConfirmationNode(props: {
  readonly confirmation?: ConfirmationProjection;
  readonly busy: boolean;
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
}): React.ReactElement {
  const view = projectConfirmationDisplay(props.confirmation);
  return (
    <div className="confirmation-node-body" data-risk={view.riskLevel}>
      {view.title.length > 0 && (
        <div className="confirmation-node-header">
          <strong>{view.title}</strong>
        </div>
      )}
      {view.showActionPreview && (
        <p className="confirmation-action-summary">{view.actionPreview}</p>
      )}
      {view.resources.length > 0 && (
        <div className="confirmation-node-meta">
          {view.resources.map((resource) => <span key={resource}>{resource}</span>)}
        </div>
      )}
      {view.resumeLostSummary !== undefined && <p className="transcript-node-summary">{view.resumeLostSummary}</p>}
      {props.onDecision !== undefined && (
        <>
          <div className="confirmation-actions">
            <button
              type="button"
              className="primary"
              onClick={() => props.onDecision?.("approve_once")}
              disabled={props.busy || view.resumeLost}
            >
              {props.busy ? "执行中" : "执行"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => props.onDecision?.("deny")}
              disabled={props.busy}
            >
              不执行
            </button>
          </div>
        </>
      )}
    </div>
  );
}
