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

export function confirmationActionSummaryText(input: {
  readonly question?: string;
  readonly consequence?: string;
  readonly fallback?: string;
}): string {
  const question = cleanConfirmationSummary(input.question ?? "");
  const consequence = cleanConfirmationSummary(input.consequence ?? "");
  if (question.length > 0 && !isGenericConfirmationPrompt(question)) {
    return question;
  }
  if (consequence.length > 0) {
    return consequence;
  }
  if (question.length > 0) {
    return question;
  }
  return cleanConfirmationSummary(input.fallback ?? "") || "等待确认。";
}

export function basicConfirmationDecisionSummary(
  decision: Pick<ConfirmationDecision, "decision" | "guidance">
): string {
  if (decision.decision === "approve_once") {
    return "已继续。";
  }
  if (decision.decision === "deny") {
    return "已拒绝。";
  }
  const guidance = decision.guidance === undefined ? undefined : compactSafeText(decision.guidance, 240);
  return guidance === undefined || guidance.length === 0
    ? "已补充要求。"
    : guidance;
}

function compactSafeText(value: string, maxLength: number): string {
  const normalized = redactOrdinaryText(value, maxLength).replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function isGenericConfirmationPrompt(value: string): boolean {
  const normalized = value
    .replace(/[。.!！?？；;:：、，,\s]/g, "")
    .trim();
  return normalized === "确认" ||
    normalized === "需要确认" ||
    normalized === "待确认" ||
    normalized === "继续" ||
    normalized === "是否继续" ||
    normalized === "确认继续" ||
    normalized === "继续执行" ||
    normalized === "确认下一步" ||
    normalized === "等待确认" ||
    normalized === "等待用户确认下一步";
}
