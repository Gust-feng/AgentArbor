import React from "react";
import type { DesktopWorkSession, PendingConfirmation, TranscriptConfirmation, TranscriptNode } from "../contracts/run";

export type ConfirmationProjection = PendingConfirmation | NonNullable<DesktopWorkSession["pendingConfirmation"]> | TranscriptConfirmation;

export function ConfirmationNode(props: {
  readonly confirmation?: ConfirmationProjection;
  readonly busy: boolean;
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
}): React.ReactElement {
  const resumeLost = props.confirmation?.resumeAvailability === "lost_after_restart";
  const action = props.confirmation === undefined ? "" : confirmationAction(props.confirmation);
  const title = confirmationDisplayTitle(props.confirmation, action);
  const resources = props.confirmation === undefined ? [] : confirmationAffectedResources(props.confirmation);
  return (
    <div className="confirmation-node-body" data-risk={props.confirmation === undefined ? "medium" : confirmationRiskLevel(props.confirmation)}>
      <div className="confirmation-node-header">
        <strong>{title}</strong>
      </div>
      {action.length > 0 && (
        <div className="confirmation-command-row">
          <pre>{confirmationActionPreview(action)}</pre>
        </div>
      )}
      {resources.length > 0 && (
        <div className="confirmation-node-meta">
          {resources.slice(0, 6).map((resource) => <span key={resource}>{resource}</span>)}
        </div>
      )}
      {resumeLost && <p className="transcript-node-summary">需重新发起。</p>}
      {props.onDecision !== undefined && (
        <div className="confirmation-actions">
          <button
            type="button"
            className="primary"
            onClick={() => props.onDecision?.("approve_once")}
            disabled={props.busy || resumeLost}
          >
            {props.busy ? "处理中" : "允许"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => props.onDecision?.("deny")}
            disabled={props.busy}
          >
            拒绝
          </button>
        </div>
      )}
    </div>
  );
}

export function confirmationForNode(node: TranscriptNode, pending: ConfirmationProjection | undefined): ConfirmationProjection | undefined {
  if (node.kind !== "confirmation") return undefined;
  const nodeConfirmation = node.confirmation;
  const pendingRunId = pending === undefined ? undefined : confirmationRunId(pending);
  if (pending !== undefined && (nodeConfirmation === undefined || pending.confirmationId === nodeConfirmation.confirmationId || pendingRunId === node.runId)) {
    return pending;
  }
  return nodeConfirmation;
}

export function confirmationRunId(confirmation: ConfirmationProjection): string | undefined {
  return "runId" in confirmation ? confirmation.runId : undefined;
}

function confirmationAction(confirmation: ConfirmationProjection): string {
  const raw = "actionSummary" in confirmation ? confirmation.actionSummary : confirmation.question;
  const sanitized = cleanConfirmationSummary(raw);
  return sanitized;
}

export function confirmationDisplayTitle(confirmation: ConfirmationProjection | undefined, action: string): string {
  const rawTitle = confirmation?.title === undefined ? "" : cleanConfirmationSummary(confirmation.title);
  const title = isGenericConfirmationTitle(rawTitle) ? "" : rawTitle;
  const combined = [title, action].filter((value) => value.length > 0).join(" ").trim();
  return combined.length > 0 ? combined : "确认";
}

function isGenericConfirmationTitle(value: string): boolean {
  return /^(?:需要确认|待确认|确认继续|确认执行命令)$/i.test(value.trim());
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

export function cleanConfirmationSummary(value: string): string {
  return value
    .replace(/^(?:需要确认|待确认|继续前需要确认)[。.!！?？]?$/g, "")
    .replace(/批准后只允许继续本次对应工具操作；拒绝则不会执行该动作。?/g, "")
    .replace(/继续前需要确认。?/g, "")
    .replace(/执行前需要用户确认。?/g, "")
    .replace(/运行命令请求执行执行操作[。；]*/g, "")
    .replace(/\btool:call[_:A-Za-z0-9-]+\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

