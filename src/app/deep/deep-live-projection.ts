import type {
  ChildAgentRun,
  ChildAgentRunModelMessageTrace,
  ChildAgentRunParentInstruction,
  ParentSynthesisResult,
} from "../../domain/underground/agent-fabric.js";
import type {
  DeepChildStatus,
  DeepChildTask,
  DeepDelegationDecision,
  DeepLiveChildExecutionProjection,
  DeepLiveChildParentOperationProjection,
  DeepLiveChildParentInstructionProjection,
  DeepLiveChildProjection,
  DeepLiveChildWorkflowItem,
  DeepLivePhase,
  DeepLiveProjection,
  DeepRun,
  DeepRunStatus,
  DeepTaskBoardPhase,
  DeepTaskBoardSnapshot,
  SynthesizedConclusion,
} from "./contracts.js";
import type { DeepRunProgressEvent } from "./deep-run-executor.js";

export function createStartingLiveProjection(updatedAt: string): DeepLiveProjection {
  return {
    phase: "starting",
    activeNodeId: "goal",
    children: [],
    updatedAt,
  };
}

/**
 * T2-1（FR-PROJ-01/02）：从 DeepTaskBoard.snapshot() 派生 liveProjection。
 *
 * board 是运行中单一事实源（design.md §6 风险3）：children 从 snapshot.tasks 派生
 * （status 经 DeepChildStatus → ChildAgentRun["status"] 映射），phase 从 snapshot.phase
 * 经 DeepTaskBoardPhase → DeepLivePhase 映射。可选的 event 用于叠加 decision/synthesis/
 * conclusion 字段（board 不承载这些投影字段），child 事件不经此参数（由 scheduler 回调
 * 直接调本函数，不传 event）。
 */
export function liveProjectionFromBoard(
  snapshot: DeepTaskBoardSnapshot,
  previous: DeepLiveProjection,
  event?: DeepRunProgressEvent,
): DeepLiveProjection {
  // children 从 board 单一事实源派生（DeepChildStatus 七态映射为展示状态），
  // 父层操作短投影由 scheduler 回调叠加并在后续 board 投影中按 childRunId 保留。
  const previousChildren = new Map(previous.children.map((child) => [child.childRunId, child]));
  const children = snapshot.tasks.map((task) =>
    mapTaskToLiveChild(task, previousChildren.get(task.childRunId))
  );
  let activeNodeId = previous.activeNodeId;
  let decision = previous.decision;
  let synthesis = previous.synthesis;
  let conclusion = previous.conclusion;

  // event 叠加 decision/synthesis/conclusion 投影字段（board 不承载这些）。
  if (event) {
    switch (event.kind) {
      case "decision.started":
        activeNodeId = "decision";
        break;
      case "manager.decided":
        decision = {
          decisionId: event.decision.decisionId,
          action: event.decision.action,
          summary: event.decision.decisionSummary,
          confidence: event.decision.confidence,
          updatedAt: event.recordedAt,
        };
        activeNodeId = activeNodeForDecision(event.decision.action);
        break;
      case "synthesis.started":
        activeNodeId = "synthesis";
        synthesis = {
          ...(previous.synthesis ?? { status: "running" as const }),
          status: "running",
          updatedAt: event.recordedAt,
        };
        break;
      case "synthesis.completed":
        activeNodeId = "conclusion";
        synthesis = {
          synthesisId: event.synthesisRecord.synthesisId,
          status: "completed",
          summary: event.synthesisRecord.decisionSummary,
          confidence: event.synthesisRecord.confidence,
          updatedAt: event.recordedAt,
        };
        conclusion = {
          conclusionId: event.conclusion.conclusionId,
          oneLineRationale: event.conclusion.oneLineRationale,
          confidence: event.conclusion.confidence,
          updatedAt: event.recordedAt,
        };
        break;
      // child.started/child.completed 不经 onProgress（由 scheduler 回调直接调本函数）。
      default:
        break;
    }
  }

  return {
    ...previous,
    phase: mapBoardPhaseToLivePhase(snapshot.phase),
    activeNodeId,
    children,
    decision,
    synthesis,
    conclusion,
    updatedAt: event?.recordedAt ?? snapshot.updatedAt,
  };
}

/**
 * DeepTaskBoardPhase（调度相位）→ DeepLivePhase（展示相位）映射。
 * planning/waiting 等调度相位映射为用户可理解的展示相位（design.md §3.4.3）。
 */
function mapBoardPhaseToLivePhase(phase: DeepTaskBoardPhase): DeepLivePhase {
  switch (phase) {
    case "planning":
    case "deciding":
      return "deciding";
    case "exploring":
    case "waiting":
      return "exploring";
    case "synthesizing":
      return "synthesizing";
    case "completed":
      return "completed";
    case "needs_input":
      return "needs_input";
    case "stopped":
      return "stopped";
    case "failed":
      return "failed";
    default:
      return "deciding";
  }
}

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
function mapTaskToLiveChild(
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

/**
 * T2-1（FR-PROJ-03）：终态投影从 board.terminalSnapshot() 派生 children（单一事实源）。
 * 不再依赖 previous.children 或 childSummaries 事后重建——终态 children 直接从 board
 * 终态快照映射，保证 AgentRunTree/liveProjection/eventSequence 三者在同一事实源上对齐。
 */
export function liveProjectionFromFinal(input: {
  readonly previous: DeepLiveProjection;
  readonly run: DeepRun;
  readonly terminalSnapshot: DeepTaskBoardSnapshot;
  readonly synthesisRecord?: ParentSynthesisResult;
  readonly conclusion?: SynthesizedConclusion;
  readonly updatedAt: string;
}): DeepLiveProjection {
  // T2-1：children 从 board terminalSnapshot 单一事实源派生；父层操作短投影
  // 是 scheduler 已发布的安全附加事实，按 childRunId 保留到终态流程图。
  const previousChildren = new Map(input.previous.children.map((child) => [child.childRunId, child]));
  const children = input.terminalSnapshot.tasks.map((task) =>
    mapTaskToLiveChild(task, previousChildren.get(task.childRunId))
  );
  const conclusion =
    input.conclusion === undefined
      ? input.previous.conclusion
      : {
          conclusionId: input.conclusion.conclusionId,
          oneLineRationale: input.conclusion.oneLineRationale,
          confidence: input.conclusion.confidence,
          updatedAt: input.updatedAt,
        };
  const synthesis =
    input.synthesisRecord === undefined
      ? input.previous.synthesis
      : {
          synthesisId: input.synthesisRecord.synthesisId,
          status: "completed" as const,
          summary: input.synthesisRecord.decisionSummary,
          confidence: input.synthesisRecord.confidence,
          updatedAt: input.updatedAt,
        };
  const phase = livePhaseForRunStatus(input.run.status);
  return {
    ...input.previous,
    phase,
    activeNodeId: liveActiveNodeForFinal(phase, conclusion !== undefined),
    children,
    synthesis,
    conclusion,
    updatedAt: input.updatedAt,
  };
}

function activeNodeForDecision(action: DeepDelegationDecision["action"]): string {
  switch (action) {
    case "spawn_children":
    case "wait_children":
    case "continue_child":
      return "children";
    case "direct_answer":
    case "synthesize":
      return "synthesis";
    case "ask_user":
      return "decision";
    case "stop":
      return "synthesis";
    default:
      return "decision";
  }
}

function livePhaseForRunStatus(status: DeepRunStatus): DeepLiveProjection["phase"] {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "interrupted":
    case "corrected":
      return "needs_input";
    case "stopped":
      return "stopped";
    default:
      return "deciding";
  }
}

function liveActiveNodeForFinal(
  phase: DeepLiveProjection["phase"],
  hasConclusion: boolean,
): string {
  if (hasConclusion) {
    return "conclusion";
  }
  if (phase === "failed" || phase === "needs_input") {
    return "decision";
  }
  return "synthesis";
}

// ---------------------------------------------------------------------------
// AgentRunTree 增量构建 + 事件序列发布（复用 agent-fabric + underground/events）
