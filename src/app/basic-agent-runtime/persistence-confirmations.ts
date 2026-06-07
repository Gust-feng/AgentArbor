import type { ConfirmationDecision, RunEvent } from "../../domain/basic-agent/index.js";
import type {
  RuntimeConfirmationRecord,
  RuntimeRunSnapshot,
} from "../../domain/runtime-database/index.js";
import { redactOrdinaryText } from "../safe-projection.js";

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
    title: previous?.title ?? "用户确认",
    actionSummary: previous?.actionSummary ?? "用户已补充确认或指导。",
    affectedResources: previous?.affectedResources ?? [],
    riskLevel: previous?.riskLevel ?? "medium",
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
    title: input.decision.decision === "guidance" ? "收到用户指导" : "收到确认结果",
    summary:
      input.decision.decision === "approve_once"
        ? "已批准本次操作，但无法继续原操作。"
        : input.decision.decision === "deny"
          ? "已拒绝本次操作。"
          : guidance === undefined
            ? "已收到补充指导。"
            : `已收到补充指导：${guidance}`,
    status: input.decision.decision === "guidance" ? "needs_input" : "blocked",
    timestamp: input.decidedAt,
    refs: [{ kind: "event", id: `confirmation:${input.confirmationId}` }],
    visibility: "expanded",
  };
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
    title: "任务已暂停",
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
