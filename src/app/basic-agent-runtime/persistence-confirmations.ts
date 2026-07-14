import type { ConfirmationDecision } from "../../domain/basic-agent/index.js";
import type {
  RuntimeConfirmationRecord,
  RuntimeRunSnapshot,
} from "../../domain/runtime-database/index.js";

export function upsertRestoredConfirmation(input: {
  readonly snapshot: RuntimeRunSnapshot;
  readonly confirmationId: string;
  readonly decision: Pick<ConfirmationDecision, "decision" | "guidance">;
  readonly decidedAt: string;
}): readonly RuntimeConfirmationRecord[] {
  const status =
    input.decision.decision === "approve_once"
      ? "approved"
      : input.decision.decision === "deny"
        ? "denied"
        : "guidance";
  const previous = input.snapshot.confirmations.find((confirmation) => confirmation.confirmationId === input.confirmationId);
  const next: RuntimeConfirmationRecord = {
    confirmationId: input.confirmationId,
    runId: input.snapshot.run.runId,
    conversationId: previous?.conversationId ?? input.snapshot.run.conversationId,
    status,
    title: previous?.title ?? restoredConfirmationTitle(status),
    actionSummary: previous?.actionSummary ?? restoredConfirmationActionSummary(status),
    affectedResources: previous?.affectedResources ?? [],
    riskLevel: previous?.riskLevel ?? "medium",
    toolCallId: previous?.toolCallId,
    toolName: previous?.toolName,
    resumeAvailability: previous?.resumeAvailability,
    sourceRefs: previous?.sourceRefs,
    requestedAt: previous?.requestedAt ?? input.decidedAt,
    expiresAt: previous?.expiresAt,
    decidedAt: input.decidedAt,
    guidance:
      input.decision.guidance === undefined
        ? previous?.guidance
        : input.decision.guidance,
    eventRefs: unique([...(previous?.eventRefs ?? []), `confirmation:${input.confirmationId}`]),
  };
  return [
    ...input.snapshot.confirmations.filter((confirmation) => confirmation.confirmationId !== input.confirmationId),
    next,
  ];
}

export function restoredConfirmationContinuationIsLost(
  snapshot: Pick<RuntimeRunSnapshot, "run" | "toolCalls">,
  confirmation: RuntimeConfirmationRecord,
): boolean {
  if (confirmation.status !== "approved") {
    return false;
  }
  if (
    snapshot.run.status === "approval_needed" ||
    snapshot.run.stopReason === "confirmation_continuation_lost" ||
    snapshot.run.continuationAvailability === "lost_after_restart"
  ) {
    return true;
  }
  const toolCall = confirmation.toolCallId === undefined
    ? undefined
    : snapshot.toolCalls.find((call) => call.callId === confirmation.toolCallId);
  return toolCall?.status === "requested" || toolCall?.status === "approval_required";
}

function restoredConfirmationTitle(status: RuntimeConfirmationRecord["status"]): string {
  if (status === "guidance") return "补充要求";
  if (status === "denied") return "已不执行";
  if (status === "approved") return "已确认";
  return "待处理";
}

function restoredConfirmationActionSummary(status: RuntimeConfirmationRecord["status"]): string {
  if (status === "guidance") return "用户已补充要求。";
  if (status === "denied") return "用户已选择不执行。";
  if (status === "approved") return "用户已确认。";
  return "等待你判断。";
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
