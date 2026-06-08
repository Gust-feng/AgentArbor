import React from "react";
import type { DesktopWorkView, PendingConfirmation, TranscriptConfirmation } from "../contracts/run";
import { cleanConfirmationSummary } from "../../../confirmation-copy";
import {
  confirmationForNode,
  confirmationRunId,
} from "../../../panel-transcript-confirmation-projection";

export { cleanConfirmationSummary };
export { confirmationForNode, confirmationRunId };

export type ConfirmationProjection = PendingConfirmation | NonNullable<DesktopWorkView["pendingConfirmation"]> | TranscriptConfirmation;

export function ConfirmationNode(props: {
  readonly confirmation?: ConfirmationProjection;
  readonly busy: boolean;
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
}): React.ReactElement {
  const resumeLost = props.confirmation?.resumeAvailability === "lost_after_restart";
  const action = props.confirmation === undefined ? "" : confirmationAction(props.confirmation);
  const title = confirmationDisplayTitle(props.confirmation, action);
  const actionPreview = confirmationActionPreview(action);
  const showActionPreview = actionPreview.length > 0 && !sameDisplayText(actionPreview, title);
  const resources = props.confirmation === undefined ? [] : confirmationAffectedResources(props.confirmation);
  return (
    <div className="confirmation-node-body" data-risk={props.confirmation === undefined ? "medium" : confirmationRiskLevel(props.confirmation)}>
      {title.length > 0 && (
        <div className="confirmation-node-header">
          <strong>{title}</strong>
        </div>
      )}
      {showActionPreview && (
        <p className="confirmation-action-summary">{actionPreview}</p>
      )}
      {resources.length > 0 && (
        <div className="confirmation-node-meta">
          {resources.slice(0, 6).map((resource) => <span key={resource}>{resource}</span>)}
        </div>
      )}
      {resumeLost && <p className="transcript-node-summary">需重新发起。</p>}
      {props.onDecision !== undefined && (
        <>
          <div className="confirmation-actions">
            <button
              type="button"
              className="primary"
              onClick={() => props.onDecision?.("approve_once")}
              disabled={props.busy || resumeLost}
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

function confirmationAction(confirmation: ConfirmationProjection): string {
  const raw = "actionSummary" in confirmation ? confirmation.actionSummary : confirmation.question;
  const sanitized = cleanConfirmationSummary(raw);
  return sanitized;
}

export function confirmationDisplayTitle(confirmation: ConfirmationProjection | undefined, action: string): string {
  const rawTitle = confirmation?.title === undefined ? "" : cleanConfirmationSummary(confirmation.title);
  const title = isGenericConfirmationTitle(rawTitle) ? "" : rawTitle;
  if (title.length > 0) return title;
  if (action.length > 0) return action;
  return "";
}

function isGenericConfirmationTitle(value: string): boolean {
  return /^(?:.*确认.*|需要你判断|待处理|运行命令|执行 Shell)$/i.test(value.trim());
}

export function confirmationActionPreview(action: string): string {
  return action
    .replace(/^(?:运行|执行)?\s*命令[:：]?\s*/i, "")
    .replace(/^command[:：]?\s*/i, "")
    .trim() || action;
}

function confirmationRiskLevel(confirmation: ConfirmationProjection): "low" | "medium" | "high" {
  return confirmation.riskLevel === "low" || confirmation.riskLevel === "medium" || confirmation.riskLevel === "high"
    ? confirmation.riskLevel
    : "medium";
}

function confirmationAffectedResources(confirmation: ConfirmationProjection): readonly string[] {
  return "affectedResources" in confirmation
    ? confirmation.affectedResources.filter((resource) => !isInternalReference(resource))
    : [];
}

function isInternalReference(value: string): boolean {
  return /^(?:tool|tool_call|trace|model|model_call|event|confirmation|goal):/i.test(value.trim()) ||
    /\bcall[_:A-Za-z0-9-]{8,}\b/.test(value);
}

function sameDisplayText(left: string, right: string): boolean {
  return normalizeDisplayText(left) === normalizeDisplayText(right);
}

function normalizeDisplayText(value: string): string {
  return value
    .replace(/[。.!！?？；;:：、，,\s]/g, "")
    .trim();
}
