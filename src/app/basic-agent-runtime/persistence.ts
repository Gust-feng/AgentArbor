import type { BasicAgentRun, ConfirmationDecision, RunEvent } from "../../domain/basic-agent/index.js";
import type {
  RuntimeConfirmationRecord,
  RuntimeDatabase,
  RuntimeRunRecord,
  RuntimeRunSnapshot,
} from "../../domain/runtime-database/index.js";
import { redactOrdinaryText } from "./safe-projection.js";

export type BasicAgentPersistedReplay = {
  readonly cursor: {
    readonly runId: string;
    readonly lastSequence: number;
    readonly eventCount: number;
  };
  readonly events: readonly RunEvent[];
};

export function basicRunFromRuntimeSnapshot(snapshot: RuntimeRunSnapshot): BasicAgentRun {
  const status = agentTaskStatusFromSnapshot(snapshot);
  const events = restoredBasicEventsFromRuntimeSnapshot(snapshot);
  const latestEvent = [...events].reverse().find((event) => event.summary !== undefined);
  const persisted = snapshot.basicRun;
  return {
    runId: persisted?.runId ?? snapshot.run.runId,
    conversationId: persisted?.conversationId ?? snapshot.run.conversationId,
    title: basicRunTitleFromStatus(status, snapshot.run.resultTitle),
    goalSummary: persisted?.goalSummary ?? redactOrdinaryText(snapshot.run.goalSummary, 400),
    status,
    runMode: persisted?.runMode ?? snapshot.run.runMode,
    createdAt: persisted?.createdAt ?? snapshot.run.createdAt,
    updatedAt: persisted?.updatedAt ?? snapshot.run.updatedAt,
    currentStep:
      status === "blocked" && snapshot.run.status === "running"
        ? "运行已中断，需要重新发起或继续处理。"
        : latestEvent?.summary ?? persisted?.currentStep,
    nextStep: basicRunNextStepFromStatus(status),
    requiresUserAction: status === "approval_needed" || status === "blocked" || status === "needs_input",
    eventCursor: {
      lastSequence: events.at(-1)?.sequence ?? 0,
      eventCount: events.length,
    },
  };
}

export function basicRunReplayFromRuntimeSnapshot(snapshot: RuntimeRunSnapshot): BasicAgentPersistedReplay {
  const events = restoredBasicEventsFromRuntimeSnapshot(snapshot);
  return {
    cursor: {
      runId: snapshot.run.runId,
      lastSequence: events.at(-1)?.sequence ?? 0,
      eventCount: events.length,
    },
    events,
  };
}

export async function submitRestoredBasicConfirmationDecision(input: {
  readonly runtimeDatabase: RuntimeDatabase | undefined;
  readonly runId: string;
  readonly confirmationId: string;
  readonly decision: Pick<ConfirmationDecision, "decision" | "guidance">;
}): Promise<BasicAgentRun | undefined> {
  const snapshot = await input.runtimeDatabase?.getRun(input.runId);
  if (input.runtimeDatabase === undefined || snapshot === undefined) {
    return undefined;
  }
  const decidedAt = new Date().toISOString();
  const blockedByMissingContinuation = input.decision.decision === "approve_once";
  const nextRun: RuntimeRunRecord = {
    ...snapshot.run,
    status: input.decision.decision === "guidance" ? snapshot.run.status : "blocked",
    updatedAt: decidedAt,
    completedAt: input.decision.decision === "guidance" ? snapshot.run.completedAt : decidedAt,
    error:
      input.decision.decision === "guidance"
        ? snapshot.run.error
        : {
            code: blockedByMissingContinuation ? "confirmation_continuation_lost" : "confirmation_denied",
            message: blockedByMissingContinuation
              ? "运行已中断，需要重新发起或继续处理。"
              : "用户已拒绝本次操作，运行已暂停。",
          },
  };
  const nextConfirmations = upsertRestoredConfirmation({
    snapshot,
    confirmationId: input.confirmationId,
    decision: input.decision,
    decidedAt,
  });
  const events = [
    ...restoredBasicEventsFromRuntimeSnapshot(snapshot),
    restoredConfirmationDecisionEvent({
      runId: input.runId,
      confirmationId: input.confirmationId,
      decision: input.decision,
      decidedAt,
      sequence: nextBasicEventSequence(restoredBasicEventsFromRuntimeSnapshot(snapshot)),
    }),
  ];
  const blockedEvents =
    input.decision.decision === "guidance"
      ? events
      : [
          ...events,
          restoredBlockedEvent({
            runId: input.runId,
            decidedAt,
            sequence: nextBasicEventSequence(events),
            summary: nextRun.error?.message ?? "运行已中断，需要重新发起或继续处理。",
          }),
        ];
  const nextSnapshot: RuntimeRunSnapshot = {
    ...snapshot,
    run: nextRun,
    basicEvents: blockedEvents,
    confirmations: nextConfirmations,
  };
  const basicRun = basicRunFromRuntimeSnapshot(nextSnapshot);

  await input.runtimeDatabase.upsertRun(nextRun);
  await input.runtimeDatabase.replaceConfirmations(input.runId, nextConfirmations);
  await input.runtimeDatabase.replaceBasicRunEvents(input.runId, blockedEvents);
  await input.runtimeDatabase.upsertBasicRun(basicRun);
  return basicRun;
}

export function restoredBasicEventsFromRuntimeSnapshot(snapshot: RuntimeRunSnapshot): readonly RunEvent[] {
  const status = agentTaskStatusFromSnapshot(snapshot);
  const persisted = snapshot.basicEvents.length > 0
    ? snapshot.basicEvents.filter((event) => event.visibility !== "debug")
    : fallbackBasicEventsFromRuntimeSnapshot(snapshot);
  const terminalType =
    status === "blocked"
      ? "run.blocked"
      : status === "cancelled"
        ? "run.cancelled"
        : status === "failed"
          ? "run.failed"
          : status === "completed"
            ? "final.result"
            : undefined;
  if (terminalType === undefined || persisted.some((event) => event.type === terminalType)) {
    return persisted;
  }
  return [...persisted, createRestoredBasicTerminalEvent(snapshot, status, terminalType, persisted.at(-1)?.sequence ?? 0)];
}

function fallbackBasicEventsFromRuntimeSnapshot(snapshot: RuntimeRunSnapshot): readonly RunEvent[] {
  const events: RunEvent[] = [
    {
      id: `${snapshot.run.runId}:restored:run.started`,
      runId: snapshot.run.runId,
      sequence: 1,
      type: "run.started",
      title: "任务已开始",
      summary: "已从本地记录恢复这次运行。",
      status: agentTaskStatusFromRuntimeStatus(snapshot.run.status),
      timestamp: snapshot.run.createdAt,
      refs: [],
      visibility: "compact",
    },
  ];
  for (const record of snapshot.events) {
    if (record.type === "goal.received") {
      continue;
    }
    const type = basicEventTypeForRuntimeEvent(record.type);
    if (type === undefined) {
      continue;
    }
    events.push({
      id: `${snapshot.run.runId}:restored:event:${record.sequence}:${type}`,
      runId: snapshot.run.runId,
      sequence: events.length + 1,
      type,
      title: basicEventTitleFromType(type),
      summary: redactOrdinaryText(record.summary, 1_200),
      status: agentTaskStatusFromBasicEventType(type),
      timestamp: record.recordedAt,
      refs: record.refs,
      visibility: type.startsWith("tool.") || type === "confirmation.needed" ? "expanded" : "compact",
    });
  }
  for (const confirmation of snapshot.confirmations) {
    if (confirmation.decidedAt === undefined) {
      continue;
    }
    const type = confirmation.status === "guidance" ? "user.guidance" : confirmation.status === "approved" ? "run.resumed" : "user_approval.received";
    events.push({
      id: `${snapshot.run.runId}:restored:confirmation:${confirmation.confirmationId}:${confirmation.status}`,
      runId: snapshot.run.runId,
      sequence: events.length + 1,
      type,
      title: basicEventTitleFromType(type),
      summary: restoredConfirmationDecisionSummary(confirmation),
      status: confirmation.status === "denied" ? "blocked" : confirmation.status === "guidance" ? "needs_input" : "running",
      timestamp: confirmation.decidedAt,
      refs: [{ kind: "event", id: `confirmation:${confirmation.confirmationId}` }],
      visibility: "expanded",
    });
  }
  return events.filter((event) => event.visibility !== "debug");
}

function createRestoredBasicTerminalEvent(
  snapshot: RuntimeRunSnapshot,
  status: BasicAgentRun["status"],
  type: string,
  lastSequence: number
): RunEvent {
  return {
    id: `${snapshot.run.runId}:restored:basic:${type}`,
    runId: snapshot.run.runId,
    sequence: lastSequence + 1,
    type,
    title: basicRunTitleFromStatus(status, undefined),
    summary:
      status === "blocked"
        ? "运行已中断，需要重新发起或继续处理。"
        : redactOrdinaryText(snapshot.run.error?.message ?? snapshot.run.resultSummary ?? "", 800),
    status,
    timestamp: snapshot.run.updatedAt,
    refs: [],
    visibility: "compact",
  };
}

function upsertRestoredConfirmation(input: {
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

function restoredConfirmationDecisionEvent(input: {
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
        ? "已批准本次操作，但运行已中断，需要重新发起或继续处理。"
        : input.decision.decision === "deny"
          ? "已拒绝本次操作，运行不会继续执行该动作。"
          : guidance === undefined
            ? "已收到补充指导。"
            : `已收到补充指导：${guidance}`,
    status: input.decision.decision === "guidance" ? "needs_input" : "blocked",
    timestamp: input.decidedAt,
    refs: [{ kind: "event", id: `confirmation:${input.confirmationId}` }],
    visibility: "expanded",
  };
}

function restoredBlockedEvent(input: {
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

function agentTaskStatusFromRuntimeStatus(status: RuntimeRunRecord["status"]): BasicAgentRun["status"] {
  if (status === "pending") return "queued";
  if (status === "running" || status === "stopped") return "blocked";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "blocked") return "blocked";
  return "failed";
}

function agentTaskStatusFromSnapshot(snapshot: RuntimeRunSnapshot): BasicAgentRun["status"] {
  if (snapshot.confirmations.some((confirmation) => confirmation.status === "denied")) {
    return "blocked";
  }
  if (snapshot.confirmations.some((confirmation) => confirmation.status === "guidance")) {
    return "needs_input";
  }
  const pendingConfirmation = snapshot.confirmations.some((confirmation) => confirmation.status === "pending");
  if (pendingConfirmation && snapshot.run.status !== "failed" && snapshot.run.status !== "cancelled" && snapshot.run.status !== "blocked") {
    return "approval_needed";
  }
  return agentTaskStatusFromRuntimeStatus(snapshot.run.status);
}

function basicRunTitleFromStatus(status: BasicAgentRun["status"], resultTitle: string | undefined): string {
  if (resultTitle !== undefined && resultTitle.trim().length > 0) {
    return redactOrdinaryText(resultTitle, 120);
  }
  if (status === "queued") return "等待开始";
  if (status === "approval_needed") return "需要确认";
  if (status === "needs_input") return "需要补充";
  if (status === "blocked") return "需要处理";
  if (status === "cancelled") return "已取消";
  if (status === "failed") return "未完成";
  if (status === "completed") return "已完成";
  return "正在处理";
}

function basicRunNextStepFromStatus(status: BasicAgentRun["status"]): string | undefined {
  if (status === "queued") return "等待前一个任务完成。";
  if (status === "approval_needed") return "等待你确认或补充材料。";
  if (status === "needs_input") return "等待你补充指导后继续。";
  if (status === "blocked") return "运行已中断，需要重新发起或继续处理。";
  if (status === "running" || status === "planning") return "继续整理结果。";
  return undefined;
}

function basicEventTypeForRuntimeEvent(type: RuntimeRunSnapshot["events"][number]["type"]): string | undefined {
  if (type === "tool.requested" || type === "tool.completed" || type === "tool.failed") return type;
  if (type === "user_approval.requested") return "confirmation.needed";
  if (type === "user_approval.received") return "user_approval.received";
  if (type === "model.failed") return "run.failed";
  return undefined;
}

function basicEventTitleFromType(type: string): string {
  if (type === "run.started") return "任务已开始";
  if (type === "run.cancelled") return "任务已取消";
  if (type === "run.blocked") return "任务已暂停";
  if (type === "run.resumed") return "任务继续";
  if (type === "tool.requested") return "正在使用工具";
  if (type === "tool.completed") return "工具已完成";
  if (type === "tool.failed") return "工具未完成";
  if (type === "confirmation.needed") return "需要确认";
  if (type === "user_approval.received") return "收到确认结果";
  if (type === "user.guidance") return "收到用户指导";
  if (type === "final.result") return "结果已生成";
  if (type === "run.failed") return "运行未完成";
  return "工作状态更新";
}

function agentTaskStatusFromBasicEventType(type: string): BasicAgentRun["status"] {
  if (type === "confirmation.needed") return "approval_needed";
  if (type === "user.guidance") return "needs_input";
  if (type === "user_approval.received") return "blocked";
  if (type === "run.cancelled") return "cancelled";
  if (type === "run.blocked") return "blocked";
  if (type === "run.failed") return "failed";
  if (type === "final.result") return "completed";
  return "running";
}

function restoredConfirmationDecisionSummary(confirmation: RuntimeConfirmationRecord): string {
  if (confirmation.status === "approved") {
    return "已批准本次操作。";
  }
  if (confirmation.status === "denied") {
    return "已拒绝本次操作，运行不会继续执行该动作。";
  }
  return confirmation.guidance === undefined || confirmation.guidance.trim().length === 0
    ? "已收到补充指导。"
    : `已收到补充指导：${redactOrdinaryText(confirmation.guidance, 240)}`;
}

function nextBasicEventSequence(events: readonly RunEvent[]): number {
  return (events.at(-1)?.sequence ?? 0) + 1;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
