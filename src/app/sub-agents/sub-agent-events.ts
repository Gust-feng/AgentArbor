import type { ArborMessage } from "../../domain/common.js";
import { createMessage } from "../../kernel/messages/create-message.js";

export type SubAgentStartedEventPayload = {
  readonly runId: string;
  readonly subRunId: string;
  readonly subAgentId: string;
  readonly subAgentName: string;
  readonly task: string;
  readonly parentRunId?: string;
  readonly timestamp: string;
};

export type SubAgentCompletedEventPayload = {
  readonly runId: string;
  readonly subRunId: string;
  readonly subAgentId: string;
  readonly subAgentName: string;
  readonly status: "completed" | "failed" | "approval_required" | "cancelled";
  readonly summary: string;
  readonly toolCalls: number;
  readonly modelRounds: number;
  readonly durationMs: number;
  readonly timestamp: string;
};

export type SubAgentBatchStartedEventPayload = {
  readonly runId: string;
  readonly batchId: string;
  readonly tasks: readonly {
    readonly subAgentId: string;
    readonly subAgentName: string;
    readonly task: string;
  }[];
  readonly totalCount: number;
  readonly maxConcurrency: number;
  readonly timestamp: string;
};

export type SubAgentBatchCompletedEventPayload = {
  readonly runId: string;
  readonly batchId: string;
  readonly results: readonly {
    readonly subAgentId: string;
    readonly subAgentName: string;
    readonly status: "completed" | "failed" | "approval_required" | "cancelled";
    readonly summary: string;
    readonly durationMs?: number;
  }[];
  readonly successCount: number;
  readonly failedCount: number;
  readonly cancelledCount?: number;
  readonly approvalRequiredCount?: number;
  readonly notStartedCount?: number;
  readonly totalDurationMs: number;
  readonly timestamp: string;
};

export type SubAgentEventPayload =
  | SubAgentStartedEventPayload
  | SubAgentCompletedEventPayload
  | SubAgentBatchStartedEventPayload
  | SubAgentBatchCompletedEventPayload;

export function createSubAgentStartedMessage(input: {
  readonly traceId: string;
  readonly runId: string;
  readonly subRunId: string;
  readonly subAgentId: string;
  readonly subAgentName: string;
  readonly task: string;
  readonly parentRunId?: string;
  readonly timestamp: string;
  readonly fromId?: string;
}): ArborMessage<SubAgentStartedEventPayload> {
  return createMessage({
    traceId: input.traceId,
    from: { id: input.fromId ?? "sub-agent-runner", role: "runtime" },
    to: { role: "runtime" },
    type: "sub_agent.started",
    intent: "start_sub_agent",
    payload: {
      runId: input.runId,
      subRunId: input.subRunId,
      subAgentId: input.subAgentId,
      subAgentName: input.subAgentName,
      task: input.task,
      parentRunId: input.parentRunId,
      timestamp: input.timestamp,
    },
  });
}

export function createSubAgentCompletedMessage(input: {
  readonly traceId: string;
  readonly runId: string;
  readonly subRunId: string;
  readonly subAgentId: string;
  readonly subAgentName: string;
  readonly status: "completed" | "failed" | "approval_required" | "cancelled";
  readonly summary: string;
  readonly toolCalls: number;
  readonly modelRounds: number;
  readonly durationMs: number;
  readonly timestamp: string;
  readonly fromId?: string;
}): ArborMessage<SubAgentCompletedEventPayload> {
  return createMessage({
    traceId: input.traceId,
    from: { id: input.fromId ?? "sub-agent-runner", role: "runtime" },
    to: { role: "runtime" },
    type: "sub_agent.completed",
    intent: "complete_sub_agent",
    payload: {
      runId: input.runId,
      subRunId: input.subRunId,
      subAgentId: input.subAgentId,
      subAgentName: input.subAgentName,
      status: input.status,
      summary: input.summary,
      toolCalls: input.toolCalls,
      modelRounds: input.modelRounds,
      durationMs: input.durationMs,
      timestamp: input.timestamp,
    },
  });
}

export function createSubAgentBatchStartedMessage(input: {
  readonly traceId: string;
  readonly runId: string;
  readonly batchId: string;
  readonly tasks: readonly {
    readonly subAgentId: string;
    readonly subAgentName: string;
    readonly task: string;
  }[];
  readonly totalCount: number;
  readonly maxConcurrency: number;
  readonly timestamp: string;
  readonly fromId?: string;
}): ArborMessage<SubAgentBatchStartedEventPayload> {
  return createMessage({
    traceId: input.traceId,
    from: { id: input.fromId ?? "sub-agent-runner", role: "runtime" },
    to: { role: "runtime" },
    type: "sub_agent_batch.started",
    intent: "start_sub_agent_batch",
    payload: {
      runId: input.runId,
      batchId: input.batchId,
      tasks: input.tasks.map((task) => ({ ...task })),
      totalCount: input.totalCount,
      maxConcurrency: input.maxConcurrency,
      timestamp: input.timestamp,
    },
  });
}

export function createSubAgentBatchCompletedMessage(input: {
  readonly traceId: string;
  readonly runId: string;
  readonly batchId: string;
  readonly results: readonly {
    readonly subAgentId: string;
    readonly subAgentName: string;
    readonly status: "completed" | "failed" | "approval_required" | "cancelled";
    readonly summary: string;
    readonly durationMs?: number;
  }[];
  readonly successCount: number;
  readonly failedCount: number;
  readonly cancelledCount?: number;
  readonly approvalRequiredCount?: number;
  readonly notStartedCount?: number;
  readonly totalDurationMs: number;
  readonly timestamp: string;
  readonly fromId?: string;
}): ArborMessage<SubAgentBatchCompletedEventPayload> {
  return createMessage({
    traceId: input.traceId,
    from: { id: input.fromId ?? "sub-agent-runner", role: "runtime" },
    to: { role: "runtime" },
    type: "sub_agent_batch.completed",
    intent: "complete_sub_agent_batch",
    payload: {
      runId: input.runId,
      batchId: input.batchId,
      results: input.results.map((result) => ({ ...result })),
      successCount: input.successCount,
      failedCount: input.failedCount,
      cancelledCount: input.cancelledCount,
      approvalRequiredCount: input.approvalRequiredCount,
      notStartedCount: input.notStartedCount,
      totalDurationMs: input.totalDurationMs,
      timestamp: input.timestamp,
    },
  });
}

export function safeSubAgentStartedProjection(
  payload: SubAgentStartedEventPayload
): SubAgentStartedEventPayload {
  return {
    ...payload,
    task: compactSafeText(payload.task, 500) ?? "",
  };
}

export function safeSubAgentCompletedProjection(
  payload: SubAgentCompletedEventPayload
): SubAgentCompletedEventPayload {
  return {
    ...payload,
    summary: compactSafeText(payload.summary, 1000) ?? "",
  };
}

export function safeSubAgentBatchStartedProjection(
  payload: SubAgentBatchStartedEventPayload
): SubAgentBatchStartedEventPayload {
  return {
    ...payload,
    tasks: payload.tasks.map((task) => ({
      ...task,
      task: compactSafeText(task.task, 200) ?? "",
    })),
  };
}

export function safeSubAgentBatchCompletedProjection(
  payload: SubAgentBatchCompletedEventPayload
): SubAgentBatchCompletedEventPayload {
  return {
    ...payload,
    results: payload.results.map((result) => ({
      ...result,
      summary: compactSafeText(result.summary, 500) ?? "",
    })),
  };
}

export const SUB_AGENT_EVENT_VISIBILITY = {
  "sub_agent.started": "expanded" as const,
  "sub_agent.completed": "expanded" as const,
  "sub_agent_batch.started": "expanded" as const,
  "sub_agent_batch.completed": "expanded" as const,
} as const;

export type SubAgentEventType = keyof typeof SUB_AGENT_EVENT_VISIBILITY;

export function isSubAgentEventType(type: string): type is SubAgentEventType {
  return type in SUB_AGENT_EVENT_VISIBILITY;
}

export const SUB_AGENT_TRANSCRIPT_MAPPING = {
  "sub_agent.started": {
    kind: "sub_agent" as const,
    defaultCollapsed: true,
  },
  "sub_agent.completed": {
    kind: "sub_agent" as const,
    defaultCollapsed: true,
  },
  "sub_agent_batch.started": {
    kind: "sub_agent_batch" as const,
    defaultCollapsed: true,
  },
  "sub_agent_batch.completed": {
    kind: "sub_agent_batch" as const,
    defaultCollapsed: true,
  },
} as const;

function compactSafeText(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const text = value.trim();
  if (text.length === 0) {
    return undefined;
  }
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}
