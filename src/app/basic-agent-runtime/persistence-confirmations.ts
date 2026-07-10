import type { ConfirmationDecision, RunEvent } from "../../domain/basic-agent/index.js";
import type {
  RuntimeConfirmationRecord,
  RuntimeRunSnapshot,
} from "../../domain/runtime-database/index.js";
import { redactOrdinaryText } from "../safe-projection.js";
import { ORDINARY_RUN_BLOCKED_FALLBACK } from "../run-read-model/restored-run-projection.js";

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
        : redactOrdinaryText(input.decision.guidance, 500),
    eventRefs: unique([...(previous?.eventRefs ?? []), `confirmation:${input.confirmationId}`]),
  };
  return [
    ...input.snapshot.confirmations.filter((confirmation) => confirmation.confirmationId !== input.confirmationId),
    next,
  ];
}

export function restoredConfirmationDecisionEvent(input: {
  readonly runId: string;
  readonly confirmationId: string;
  readonly decision: Pick<ConfirmationDecision, "decision" | "guidance">;
  readonly decidedAt: string;
  readonly sequence: number;
}): RunEvent {
  const guidance = input.decision.guidance === undefined ? undefined : redactOrdinaryText(input.decision.guidance, 240);
  return {
    id: `${input.runId}:restored:confirmation:${input.confirmationId}:${input.decision.decision}`,
    runId: input.runId,
    sequence: input.sequence,
    type: input.decision.decision === "guidance" ? "user.guidance" : "user_approval.received",
    title: input.decision.decision === "guidance" ? "补充要求" : "用户决定",
    summary:
      input.decision.decision === "approve_once"
        ? ORDINARY_RUN_BLOCKED_FALLBACK
        : input.decision.decision === "deny"
          ? "已不执行。"
          : guidance === undefined
            ? "已补充要求。"
            : guidance,
    status: input.decision.decision === "guidance" ? "needs_input" : "blocked",
    timestamp: input.decidedAt,
    refs: [{ kind: "event", id: `confirmation:${input.confirmationId}` }],
    visibility: "expanded",
  };
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

export function restoredBlockedEvent(input: {
  readonly runId: string;
  readonly decidedAt: string;
  readonly sequence: number;
  readonly summary: string;
}): RunEvent {
  return {
    id: `${input.runId}:restored:run.blocked`,
    runId: input.runId,
    sequence: input.sequence,
    type: "run.blocked",
    title: "需要处理",
    summary: redactOrdinaryText(input.summary, 500),
    status: "blocked",
    timestamp: input.decidedAt,
    refs: [],
    visibility: "compact",
  };
}

export function nextBasicEventSequence(events: readonly RunEvent[]): number {
  return (events.at(-1)?.sequence ?? 0) + 1;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
