import type {
  ChildAgentRun,
  ChildAgentRunModelMessageTrace,
  ChildAgentRunParentInstruction,
} from "../../domain/underground/agent-fabric.js";
import type {
  DeepChildStatus,
  DeepChildTask,
  DeepLiveChildExecutionProjection,
  DeepLiveChildParentOperationProjection,
  DeepLiveChildParentInstructionProjection,
  DeepLiveChildProjection,
  DeepLiveChildWorkflowItem,
  DeepLiveProjection,
} from "./contracts.js";

/**
 * DeepChildStatus（任务板七态）→ ChildAgentRun["status"]（展示态）映射。
 * pending → planned（未启动），blocked/interrupted 保留 child 自身状态，cancelled → interrupted（被取消视同打断）。
 */
function mapBoardChildStatusToLiveStatus(status: DeepChildStatus): ChildAgentRun["status"] {
  switch (status) {
    case "pending":
      return "planned";
    case "blocked":
      return "blocked";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    case "cancelled":
      return "interrupted";
    default:
      return "planned";
  }
}

/** DeepChildTask → DeepLiveChildProjection（从 board 任务派生展示节点）。 */
export function mapTaskToLiveChild(
  task: DeepChildTask,
  previous?: DeepLiveChildProjection,
): DeepLiveChildProjection {
  const status = mapBoardChildStatusToLiveStatus(task.status);
  const workflowItems = liveChildWorkflowItemsFromTask(task, previous);
  return {
    childRunId: task.childRunId,
    displayName: task.spec.displayName,
    objective: task.spec.objective,
    role: task.spec.role,
    status,
    updatedAt: task.updatedAt,
    summary: task.summary?.summary,
    latestResult: latestResultForLiveChild(task.summary?.summary, task.failure),
    confidence: task.summary?.confidence,
    uncertainty: task.summary?.uncertainty,
    failureDetail: task.summary?.failureDetail,
    continuationContextRef: task.summary?.continuationContextRef,
    workflowItems,
    execution: previous?.execution,
    parentInstructions: previous?.parentInstructions,
    pendingApproval: task.pendingApproval,
    parentOperation: previous?.parentOperation,
  };
}

export function withChildParentOperation(
  projection: DeepLiveProjection,
  childRunId: string,
  operation: DeepLiveChildParentOperationProjection,
): DeepLiveProjection {
  let found = false;
  const children = projection.children.map((child) => {
    if (child.childRunId !== childRunId) {
      return child;
    }
    found = true;
    return {
      ...child,
      parentOperation: operation,
      workflowItems: mergeLiveChildWorkflowItems([
        ...(child.workflowItems ?? []),
        workflowItemForParentOperation(childRunId, operation),
      ]),
      updatedAt: operation.updatedAt,
    };
  });
  if (!found) {
    return projection;
  }
  return {
    ...projection,
    activeNodeId: childRunId,
    children,
    updatedAt: operation.updatedAt,
  };
}

export function withChildDetailFromRun(
  projection: DeepLiveProjection,
  childRun: ChildAgentRun,
): DeepLiveProjection {
  let found = false;
  const children = projection.children.map((child) => {
    if (child.childRunId !== childRun.childRunId) {
      return child;
    }
    found = true;
    const operation = liveParentOperationFromInstruction(childRun.parentInstructions?.at(-1));
    const execution = liveChildExecutionFromRun(childRun);
    const parentInstructions = liveChildParentInstructionsFromRun(childRun);
    const workflowItems = liveChildWorkflowItemsFromRun(childRun, child);
    const updatedAt = childRun.completedAt ?? operation?.updatedAt ?? child.updatedAt;
    return {
      ...child,
      status: childRun.status,
      updatedAt,
      latestResult: latestResultForLiveChild(
        child.latestResult ?? child.summary,
        childRun.failureReason,
      ),
      failureDetail: childRun.failureDetail ?? child.failureDetail,
      continuationContextRef: childRun.continuationContextRef ?? child.continuationContextRef,
      execution,
      parentInstructions,
      workflowItems,
      pendingApproval: childRun.pendingApproval ?? child.pendingApproval,
      parentOperation: operation ?? child.parentOperation,
    };
  });
  if (!found) {
    return projection;
  }
  return {
    ...projection,
    activeNodeId: childRun.childRunId,
    children,
    updatedAt: childRun.completedAt ?? projection.updatedAt,
  };
}

function liveChildWorkflowItemsFromTask(
  task: DeepChildTask,
  previous?: DeepLiveChildProjection,
): readonly DeepLiveChildWorkflowItem[] {
  return mergeLiveChildWorkflowItems([
    {
      itemId: `objective:${task.childRunId}`,
      kind: "objective_set",
      title: "目标已明确",
      detail: task.spec.objective,
      status: "completed",
      timestamp: task.startedAt ?? task.updatedAt,
    },
    ...preservedLiveChildWorkflowItems(previous),
    ...workflowItemsForTaskState(task),
  ]);
}

function preservedLiveChildWorkflowItems(
  previous: DeepLiveChildProjection | undefined,
): readonly DeepLiveChildWorkflowItem[] {
  if (previous?.workflowItems === undefined) {
    return [];
  }
  return previous.workflowItems.filter((item) =>
    item.kind !== "objective_set" &&
    item.kind !== "running" &&
    item.itemId !== `status:${previous.childRunId}:${previous.status}`
  );
}

function workflowItemsForTaskState(task: DeepChildTask): readonly DeepLiveChildWorkflowItem[] {
  const items: DeepLiveChildWorkflowItem[] = [];
  if (task.pendingApproval !== undefined) {
    items.push({
      itemId: `tool-waiting:${task.childRunId}:${task.pendingApproval.confirmationId}`,
      kind: "tool_waiting",
      title: "等待确认",
      detail: `${task.pendingApproval.toolName}：${task.pendingApproval.actionSummary}`,
      status: "blocked",
      timestamp: task.pendingApproval.requestedAt,
    });
  }
  switch (task.status) {
    case "pending":
      items.push({
        itemId: `status:${task.childRunId}:pending`,
        kind: "running",
        title: "等待启动",
        status: "pending",
        timestamp: task.updatedAt,
      });
      break;
    case "running":
      items.push({
        itemId: `status:${task.childRunId}:running`,
        kind: "running",
        title: "正在探索",
        detail: task.summary?.summary,
        status: "running",
        timestamp: task.updatedAt,
      });
      break;
    case "completed":
      items.push({
        itemId: `status:${task.childRunId}:completed`,
        kind: "completed",
        title: "结果已返回",
        detail: task.summary?.summary,
        status: "completed",
        timestamp: task.completedAt ?? task.updatedAt,
      });
      break;
    case "blocked":
      items.push({
        itemId: `status:${task.childRunId}:blocked`,
        kind: "blocked",
        title: "等待处理",
        detail: task.failure ?? task.summary?.summary,
        status: "blocked",
        timestamp: task.completedAt ?? task.updatedAt,
      });
      break;
    case "failed":
      items.push({
        itemId: `status:${task.childRunId}:failed`,
        kind: "failed",
        title: "未完成",
        detail: task.failure ?? task.summary?.summary,
        status: "failed",
        timestamp: task.completedAt ?? task.updatedAt,
      });
      break;
    case "interrupted":
    case "cancelled":
      items.push({
        itemId: `status:${task.childRunId}:${task.status}`,
        kind: "interrupted",
        title: task.status === "cancelled" ? "已取消" : "已中断",
        detail: task.failure ?? task.summary?.summary,
        status: task.status === "cancelled" ? "cancelled" : "interrupted",
        timestamp: task.completedAt ?? task.updatedAt,
      });
      break;
    default:
      break;
  }
  return items;
}

function liveChildWorkflowItemsFromRun(
  childRun: ChildAgentRun,
  previous: DeepLiveChildProjection,
): readonly DeepLiveChildWorkflowItem[] {
  const items: DeepLiveChildWorkflowItem[] = [
    {
      itemId: `objective:${childRun.childRunId}`,
      kind: "objective_set",
      title: "目标已明确",
      detail: childRun.spec.instructions?.objective ?? previous.objective,
      status: "completed",
      timestamp: childRun.startedAt,
    },
  ];
  for (const instruction of childRun.parentInstructions ?? []) {
    items.push(workflowItemForParentInstruction(childRun.childRunId, instruction));
  }
  for (const [index, segment] of (childRun.executionHistory ?? []).entries()) {
    for (const [messageIndex, message] of (segment.modelMessages ?? []).entries()) {
      const item = workflowItemForModelMessage(childRun.childRunId, index, messageIndex, message);
      if (item !== undefined) {
        items.push(item);
      }
    }
    for (const [callIndex, call] of segment.toolCalls.entries()) {
      items.push({
        itemId: `tool:${childRun.childRunId}:${index}:${call.callId || callIndex}`,
        kind: call.status === "approval_required" ? "tool_waiting" : "tool_completed",
        title: call.status === "approval_required" ? "等待工具确认" : "工具调用完成",
        detail: `${call.toolName}：${toolCallStatusLabel(call.status)}`,
        status: liveWorkflowStatusForToolCall(call.status),
        timestamp: segment.recordedAt,
      });
    }
    items.push({
      itemId: `segment:${childRun.childRunId}:${index}`,
      kind: workflowKindForExecutionOutcome(segment.outcome),
      title: executionOutcomeTitle(segment.outcome),
      detail: `模型 ${segment.modelRounds} 轮，工具 ${segment.toolRounds} 轮`,
      status: segment.outcome,
      timestamp: segment.recordedAt,
    });
  }
  if ((childRun.executionHistory?.length ?? 0) === 0 && childRun.execution !== undefined) {
    const recordedAt = childRun.completedAt ?? previous.updatedAt;
    for (const [messageIndex, message] of (childRun.execution.modelMessages ?? []).entries()) {
      const item = workflowItemForModelMessage(childRun.childRunId, "latest", messageIndex, message);
      if (item !== undefined) {
        items.push(item);
      }
    }
    for (const [callIndex, call] of childRun.execution.toolCalls.entries()) {
      items.push({
        itemId: `tool:${childRun.childRunId}:latest:${call.callId || callIndex}`,
        kind: call.status === "approval_required" ? "tool_waiting" : "tool_completed",
        title: call.status === "approval_required" ? "等待工具确认" : "工具调用完成",
        detail: `${call.toolName}：${toolCallStatusLabel(call.status)}`,
        status: liveWorkflowStatusForToolCall(call.status),
        timestamp: recordedAt,
      });
    }
    items.push({
      itemId: `execution:${childRun.childRunId}`,
      kind: childRun.status === "running" || childRun.status === "resumed" ? "running" : "completed",
      title: childRun.status === "running" || childRun.status === "resumed" ? "正在探索" : "已产生执行结果",
      detail: `模型 ${childRun.execution.modelRounds} 轮，工具 ${childRun.execution.toolRounds} 轮`,
      status: childRun.status === "running" || childRun.status === "resumed" ? "running" : "completed",
      timestamp: recordedAt,
    });
  }
  if (childRun.pendingApproval !== undefined) {
    items.push({
      itemId: `tool-waiting:${childRun.childRunId}:${childRun.pendingApproval.confirmationId}`,
      kind: "tool_waiting",
      title: "等待确认",
      detail: `${childRun.pendingApproval.toolName}：${childRun.pendingApproval.actionSummary}`,
      status: "blocked",
      timestamp: childRun.pendingApproval.requestedAt,
    });
  }
  items.push(workflowItemForRunStatus(childRun, previous));
  return mergeLiveChildWorkflowItems(items);
}

function workflowItemForModelMessage(
  childRunId: string,
  segmentIndex: string | number,
  messageIndex: number,
  message: ChildAgentRunModelMessageTrace,
): DeepLiveChildWorkflowItem | undefined {
  const detail = modelMessageProjectionText(message);
  if (detail === undefined) {
    return undefined;
  }
  return {
    itemId: `model:${childRunId}:${segmentIndex}:${message.responseId ?? message.requestId}:${messageIndex}`,
    kind: "model_message",
    title: message.toolCallIds.length > 0 ? "工具调用前说明" : "模型回答",
    detail,
    status: liveWorkflowStatusForModelMessage(message.status),
    timestamp: message.completedAt,
  };
}

function modelMessageProjectionText(message: ChildAgentRunModelMessageTrace): string | undefined {
  const text = message.text?.trim();
  if (text !== undefined && text.length > 0) {
    return text;
  }
  const reasoning = message.reasoningSummary?.trim();
  if (reasoning !== undefined && reasoning.length > 0) {
    return reasoning;
  }
  return undefined;
}

function workflowItemForRunStatus(
  childRun: ChildAgentRun,
  previous: DeepLiveChildProjection,
): DeepLiveChildWorkflowItem {
  const timestamp = childRun.completedAt ?? previous.updatedAt;
  switch (childRun.status) {
    case "completed":
      return {
        itemId: `status:${childRun.childRunId}:completed`,
        kind: "completed",
        title: "结果已返回",
        detail: previous.summary,
        status: "completed",
        timestamp,
      };
    case "blocked":
      return {
        itemId: `status:${childRun.childRunId}:blocked`,
        kind: "blocked",
        title: "等待处理",
        detail: childRun.failureReason ?? previous.summary,
        status: "blocked",
        timestamp,
      };
    case "failed":
      return {
        itemId: `status:${childRun.childRunId}:failed`,
        kind: "failed",
        title: "未完成",
        detail: childRun.failureReason ?? previous.summary,
        status: "failed",
        timestamp,
      };
    case "interrupted":
      return {
        itemId: `status:${childRun.childRunId}:interrupted`,
        kind: "interrupted",
        title: "已中断",
        detail: childRun.failureReason ?? previous.summary,
        status: "interrupted",
        timestamp,
      };
    default:
      return {
        itemId: `status:${childRun.childRunId}:running`,
        kind: "running",
        title: "正在探索",
        detail: previous.summary,
        status: "running",
        timestamp,
      };
  }
}

function workflowItemForParentOperation(
  childRunId: string,
  operation: DeepLiveChildParentOperationProjection,
): DeepLiveChildWorkflowItem {
  return {
    itemId: `parent-operation:${childRunId}:${operation.messageRef ?? operation.updatedAt}`,
    kind: operation.status === "queued" ? "parent_message_queued" : "parent_message_applied",
    title: operation.status === "queued" ? "已追加要求" : operation.status === "cancelled" ? "跟进已取消" : "已跟进",
    detail: operation.queuedCount !== undefined && operation.queuedCount > 1
      ? `排队 ${operation.queuedCount} 条`
      : undefined,
    status: operation.status === "queued" ? "pending" : operation.status === "cancelled" ? "cancelled" : "completed",
    timestamp: operation.updatedAt,
  };
}

function workflowItemForParentInstruction(
  childRunId: string,
  instruction: ChildAgentRunParentInstruction,
): DeepLiveChildWorkflowItem {
  const timestamp = instruction.executedAt ?? instruction.cancelledAt ?? instruction.queuedAt ?? instruction.requestedAt;
  return {
    itemId: `parent-instruction:${childRunId}:${instruction.instructionId}`,
    kind: instruction.status === "queued" ? "parent_message_queued" : "parent_message_applied",
    title: instruction.status === "queued" ? "已追加要求" : instruction.status === "cancelled" ? "跟进已取消" : "已跟进",
    detail: instruction.instructionSummary,
    status: instruction.status === "queued" ? "pending" : instruction.status === "cancelled" ? "cancelled" : "completed",
    timestamp,
  };
}

function mergeLiveChildWorkflowItems(
  items: readonly DeepLiveChildWorkflowItem[],
): readonly DeepLiveChildWorkflowItem[] {
  const byId = new Map<string, DeepLiveChildWorkflowItem>();
  for (const item of items) {
    byId.set(item.itemId, item);
  }
  return [...byId.values()].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp)
  );
}

function liveChildExecutionFromRun(
  childRun: ChildAgentRun,
): DeepLiveChildExecutionProjection | undefined {
  const history = childRun.executionHistory ?? [];
  const latest = history.at(-1);
  const execution = latest ?? childRun.execution;
  if (execution === undefined) {
    return undefined;
  }
  return {
    modelRounds: execution.modelRounds,
    toolRounds: execution.toolRounds,
    segmentCount: history.length === 0 ? 1 : history.length,
    latestOutcome: latest?.outcome,
  };
}

function liveChildParentInstructionsFromRun(
  childRun: ChildAgentRun,
): readonly DeepLiveChildParentInstructionProjection[] | undefined {
  if (childRun.parentInstructions === undefined || childRun.parentInstructions.length === 0) {
    return undefined;
  }
  return childRun.parentInstructions.map((instruction) => ({
    instructionId: instruction.instructionId,
    status: instruction.status,
    instructionSummary: instruction.instructionSummary,
    requestedAt: instruction.requestedAt,
    review: instruction.review === undefined
      ? undefined
      : {
          decision: instruction.review.decision,
          reason: instruction.review.reason,
          confidence: instruction.review.confidence,
        },
  }));
}

function latestResultForLiveChild(summary: string | undefined, failure: string | undefined): string | undefined {
  const trimmedSummary = summary?.trim();
  if (trimmedSummary !== undefined && trimmedSummary.length > 0) {
    return trimmedSummary;
  }
  const trimmedFailure = failure?.trim();
  if (trimmedFailure !== undefined && trimmedFailure.length > 0) {
    return trimmedFailure;
  }
  return undefined;
}

function toolCallStatusLabel(
  status: NonNullable<ChildAgentRun["execution"]>["toolCalls"][number]["status"],
): string {
  switch (status) {
    case "completed":
      return "完成";
    case "failed":
      return "失败";
    case "approval_required":
      return "等待确认";
    case "cancelled":
      return "取消";
    default:
      return status;
  }
}

function liveWorkflowStatusForToolCall(
  status: NonNullable<ChildAgentRun["execution"]>["toolCalls"][number]["status"],
): DeepLiveChildWorkflowItem["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "approval_required":
      return "blocked";
    case "cancelled":
      return "cancelled";
    default:
      return "completed";
  }
}

function liveWorkflowStatusForModelMessage(
  status: ChildAgentRunModelMessageTrace["status"],
): DeepLiveChildWorkflowItem["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "failed":
    default:
      return "failed";
  }
}

function workflowKindForExecutionOutcome(
  outcome: NonNullable<DeepLiveChildExecutionProjection["latestOutcome"]>,
): DeepLiveChildWorkflowItem["kind"] {
  switch (outcome) {
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    case "completed":
    default:
      return "completed";
  }
}

function executionOutcomeTitle(
  outcome: NonNullable<DeepLiveChildExecutionProjection["latestOutcome"]>,
): string {
  switch (outcome) {
    case "blocked":
      return "等待处理";
    case "failed":
      return "执行未完成";
    case "interrupted":
      return "执行已中断";
    case "completed":
    default:
      return "阶段结果已返回";
  }
}

function liveParentOperationFromInstruction(
  instruction: ChildAgentRunParentInstruction | undefined,
): DeepLiveChildParentOperationProjection | undefined {
  if (instruction === undefined) {
    return undefined;
  }
  return {
    status: instruction.status,
    messageRef: instruction.messageRef,
    updatedAt: instruction.executedAt ?? instruction.cancelledAt ?? instruction.queuedAt ?? instruction.requestedAt,
  };
}
