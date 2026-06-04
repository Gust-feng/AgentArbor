import type { ConfirmationDecision } from "../domain/basic-agent/index.js";
import { redactOrdinaryText } from "./safe-projection.js";

export function cleanConfirmationSummary(value: string): string {
  return value
    .replace(/^User approval was requested\.?\s*/i, "")
    .replace(/^Approval required\.?\s*/i, "")
    .replace(/^需要确认[:：]?\s*/i, "")
    .replace(/请求执行执行操作/g, "请求执行操作")
    .replace(/\btool:call[_:A-Za-z0-9-]+\b/g, "")
    .replace(/[:：]\s*[:：]/g, "：")
    .replace(/^[，,。.\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function basicConfirmationDecisionSummary(
  decision: Pick<ConfirmationDecision, "decision" | "guidance">
): string {
  if (decision.decision === "approve_once") {
    return "已批准本次操作。";
  }
  if (decision.decision === "deny") {
    return "已拒绝本次操作，运行不会继续执行该动作。";
  }
  const guidance = decision.guidance === undefined ? undefined : compactSafeText(decision.guidance, 240);
  return guidance === undefined || guidance.length === 0
    ? "已收到补充指导。"
    : `已收到补充指导：${guidance}`;
}

function compactSafeText(value: string, maxLength: number): string {
  const normalized = redactOrdinaryText(value, maxLength).replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}
