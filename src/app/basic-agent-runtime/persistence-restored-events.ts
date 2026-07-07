import type { BasicAgentRun, RunEvent } from "../../domain/basic-agent/index.js";
import type {
  RuntimeConfirmationRecord,
  RuntimeRunSnapshot,
} from "../../domain/runtime-database/index.js";
import { redactOrdinaryText } from "../safe-projection.js";
import { restoredRunTerminalSummary } from "../restored-run-projection.js";
import {
  isSubAgentStreamEventType,
  subAgentStreamDetailFromTraces,
  subAgentStreamSummaryFromDetail,
} from "../sub-agent-stream-projection.js";
import {
  agentTaskStatusFromSnapshot,
  basicRunTitleFromStatus,
} from "./persistence-status.js";

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
  const events: RunEvent[] = [];
  for (const record of snapshot.events) {
    if (record.type === "goal.received") {
      continue;
    }
    const type = basicEventTypeForRuntimeEvent(record.type);
    if (type === undefined) {
      continue;
    }
    const detail = isSubAgentStreamEventType(type)
      ? subAgentStreamDetailFromTraces({
          type,
          refs: record.refs,
          fallbackSummary: record.summary,
          runs: snapshot.subAgentRuns,
        })
      : undefined;
    events.push({
      id: `${snapshot.run.runId}:restored:event:${record.sequence}:${type}`,
      runId: snapshot.run.runId,
      sequence: events.length + 1,
      type,
      title: basicEventTitleFromType(type),
      summary: isSubAgentStreamEventType(type)
        ? redactOrdinaryText(subAgentStreamSummaryFromDetail(type, detail, record.summary), 1_200)
        : redactOrdinaryText(record.summary, 1_200),
      status: agentTaskStatusFromBasicEventType(type, detail),
      timestamp: record.recordedAt,
      refs: record.refs,
      visibility: type.startsWith("tool.") || type.startsWith("sub_agent") || type === "confirmation.needed" ? "expanded" : "compact",
      detail,
    });
  }
  for (const confirmation of snapshot.confirmations) {
    if (confirmation.status === "pending") {
      events.push({
        id: `${snapshot.run.runId}:restored:confirmation:${confirmation.confirmationId}:pending`,
        runId: snapshot.run.runId,
        sequence: events.length + 1,
        type: "confirmation.needed",
        title: basicEventTitleFromType("confirmation.needed"),
        summary: redactOrdinaryText(confirmation.actionSummary, 1_200),
        status: "approval_needed",
        timestamp: confirmation.requestedAt,
        refs: [{ kind: "event", id: `confirmation:${confirmation.confirmationId}` }],
        visibility: "expanded",
      });
      continue;
    }
    if (confirmation.decidedAt === undefined) {
      continue;
    }
    if (confirmation.status === "approved") {
      continue;
    }
    const type = confirmation.status === "guidance" ? "user.guidance" : "user_approval.received";
    events.push({
      id: `${snapshot.run.runId}:restored:confirmation:${confirmation.confirmationId}:${confirmation.status}`,
      runId: snapshot.run.runId,
      sequence: events.length + 1,
      type,
      title: basicEventTitleFromType(type),
      summary: restoredConfirmationDecisionSummary(confirmation),
      status: "running",
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
    summary: restoredBasicTerminalSummary(snapshot, status),
    status,
    timestamp: snapshot.run.updatedAt,
    refs: [],
    visibility: "compact",
  };
}

function restoredBasicTerminalSummary(
  snapshot: RuntimeRunSnapshot,
  status: BasicAgentRun["status"]
): string {
  if (
    status === "blocked" ||
    status === "cancelled" ||
    status === "completed" ||
    status === "failed"
  ) {
    return restoredRunTerminalSummary({ run: snapshot.run, status });
  }
  return "";
}

function basicEventTypeForRuntimeEvent(type: RuntimeRunSnapshot["events"][number]["type"]): string | undefined {
  if (type === "tool.requested" || type === "tool.completed" || type === "tool.failed") return type;
  if (
    type === "sub_agent.started" ||
    type === "sub_agent.completed" ||
    type === "sub_agent_batch.started" ||
    type === "sub_agent_batch.completed"
  ) {
    return type;
  }
  if (type === "user_approval.requested") return "confirmation.needed";
  if (type === "user_approval.received") return "user_approval.received";
  if (type === "model.failed") return "run.failed";
  return undefined;
}

function basicEventTitleFromType(type: string): string {
  if (type === "run.started") return "任务";
  if (type === "run.cancelled") return "已取消";
  if (type === "run.blocked") return "需要处理";
  if (type === "run.resumed") return "运行恢复";
  if (type === "tool.requested" || type === "tool.completed") return "动作";
  if (type === "tool.failed") return "未完成";
  if (type === "sub_agent.started" || type === "sub_agent.completed") return "子 Agent";
  if (type === "sub_agent_batch.started" || type === "sub_agent_batch.completed") return "子 Agent 批次";
  if (type === "confirmation.needed") return "需要你判断";
  if (type === "user_approval.received") return "用户决定";
  if (type === "user.guidance") return "补充要求";
  if (type === "final.result") return "结果";
  if (type === "run.failed") return "未完成";
  return "更新";
}

function agentTaskStatusFromBasicEventType(
  type: string,
  detail?: RunEvent["detail"]
): BasicAgentRun["status"] {
  if (type === "confirmation.needed") return "approval_needed";
  if (type === "user.guidance") return "needs_input";
  if (type === "sub_agent.started" || type === "sub_agent_batch.started") return "running";
  if (type === "sub_agent.completed") {
    if (detail?.subAgentStatus === "failed") return "failed";
    if (detail?.subAgentStatus === "cancelled") return "cancelled";
    if (detail?.subAgentStatus === "approval_required") return "approval_needed";
    return "completed";
  }
  if (type === "sub_agent_batch.completed") return "completed";
  if (type === "run.cancelled") return "cancelled";
  if (type === "run.blocked") return "blocked";
  if (type === "run.failed") return "failed";
  if (type === "final.result") return "completed";
  return "running";
}

function restoredConfirmationDecisionSummary(confirmation: RuntimeConfirmationRecord): string {
  if (confirmation.status === "approved") {
    return "已确认。";
  }
  if (confirmation.status === "denied") {
    return "已不执行。";
  }
  return confirmation.guidance === undefined || confirmation.guidance.trim().length === 0
    ? "已补充要求。"
    : redactOrdinaryText(confirmation.guidance, 240);
}
