/**
 * Owns the durable effects of a deep child control operation.
 *
 * Route handlers decide which operation is allowed and execute the model turn.
 * This module records the resulting child state, parent message history, event
 * sequence, and live read model as one coherent update.
 */
import { createId, nowIso } from "../../kernel/id.js";
import type { ObservationRef } from "../../domain/observation/contracts.js";
import {
  appendDelegationDecisionToTree,
  appendParentSynthesisToTree,
  replaceChildRunInTree,
  type ChildAgentRun,
  type ChildAgentRunModelMessageTrace,
  type ChildAgentRunParentInstructionStatus,
  type ParentSynthesisResult,
} from "../../domain/underground/agent-fabric.js";
import {
  DeepChildPendingContinuationStore,
} from "./deep-child-continuations.js";
import {
  createDeepChildMessageRecord,
  createDeepChildMessageRef,
  summarizeDeepChildMessage,
  type DeepChildMessageInput,
  type DeepChildMessageStore,
} from "./deep-child-messages.js";
import type { DeepChildParentMessageContext, DeepChildAgentRunResult } from "./deep-child-agent-runner.js";
import type { DeepRunStreamEvent } from "./deep-events.js";
import {
  fallbackLiveProjectionForRecord,
  liveParentOperationFromInstruction,
} from "./deep-read-model.js";
import type { DeepRunRecord, DeepRunRecordStore } from "./deep-runtime.js";
import type {
  DeepChildSpec,
  DeepChildSummary,
  DeepLiveChildExecutionProjection,
  DeepLiveChildParentInstructionProjection,
  DeepLiveChildWorkflowItem,
  DeepLiveProjection,
  SynthesizedConclusion,
} from "./contracts.js";

/** The subset of route state required to update a child-control result. */
export type DeepChildControlUpdateState = {
  readonly runRecordStore: DeepRunRecordStore;
  readonly childMessageStore: DeepChildMessageStore;
  readonly childContinuations: DeepChildPendingContinuationStore;
};

export type DeepChildOperationTarget = {
  readonly childRun: ChildAgentRun;
  readonly childSpec: DeepChildSpec | undefined;
  readonly previousSummary: DeepChildSummary | undefined;
};

export type DeepResynthesisResult = {
  readonly conclusion: SynthesizedConclusion;
  readonly synthesisRecord: ParentSynthesisResult;
};

export function summarizeDeepChildParentInstruction(instruction: string): string {
  return summarizeDeepChildMessage(instruction);
}

export function deepChildParentInstructionMessageRef(instructionId: string): string {
  return createDeepChildMessageRef(instructionId);
}

export function resolveDeepChildOperationTarget(
  state: DeepChildControlUpdateState,
  record: DeepRunRecord,
  childRunId: string,
): DeepChildOperationTarget | undefined {
  const previousSummary = findChildSummary(record, childRunId);
  const childRun = findChildRun(record, childRunId);
  if (childRun !== undefined) {
    return {
      childRun,
      childSpec: previousSummary?.spec ?? childRunSpecFromRun(childRun),
      previousSummary,
    };
  }
  const continuation = state.childContinuations.findByChildRun(record.run.runId, childRunId);
  if (continuation !== undefined) {
    return {
      childRun: continuation.childRun,
      childSpec: continuation.childSpec,
      previousSummary,
    };
  }
  return undefined;
}

export async function recordDeepChildMessageForResult(
  state: DeepChildControlUpdateState,
  runId: string,
  content: string,
  childRun: ChildAgentRun,
): Promise<void> {
  const instruction = childRun.parentInstructions?.at(-1);
  if (instruction === undefined) {
    return;
  }
  await recordDeepChildMessage(state, {
    runId,
    childRunId: childRun.childRunId,
    instructionId: instruction.instructionId,
    messageRef: instruction.messageRef ?? deepChildParentInstructionMessageRef(instruction.instructionId),
    source: instruction.source,
    status: instruction.status,
    content,
    requestedAt: instruction.requestedAt,
    queuedAt: instruction.queuedAt,
    executedAt: instruction.executedAt,
    cancelledAt: instruction.cancelledAt,
  });
}

export async function loadDeepChildParentMessageContext(
  state: DeepChildControlUpdateState,
  runId: string,
  childRunId: string,
): Promise<readonly DeepChildParentMessageContext[]> {
  const records = await state.childMessageStore.listForChild(runId, childRunId);
  return records
    .filter((record) => record.status === "executed")
    .map((record) => ({
      messageRef: record.messageRef,
      source: record.source,
      status: record.status,
      content: record.content,
      updatedAt: record.updatedAt,
    }));
}

export async function recordDeepChildMessage(
  state: DeepChildControlUpdateState,
  input: DeepChildMessageInput,
): Promise<void> {
  await state.childMessageStore.upsert(createDeepChildMessageRecord(input));
}

export async function applyDeepChildOperationResult(
  state: DeepChildControlUpdateState,
  record: DeepRunRecord,
  result: DeepChildAgentRunResult,
  copy: {
    readonly eventTitle: string;
    readonly eventSummary: string;
  },
): Promise<DeepRunRecord> {
  const updatedAt = nowIso();
  const replacedTree = replaceChildRunInTree(record.agentRunTree, result.completedRun, updatedAt);
  const latestParentInstruction = result.completedRun.parentInstructions?.at(-1);
  const childInstructionRef = latestParentInstruction === undefined
    ? undefined
    : latestParentInstruction.messageRef ?? deepChildParentInstructionMessageRef(latestParentInstruction.instructionId);
  const agentRunTree = appendDelegationDecisionToTree(
    replacedTree,
    {
      decisionId: createId("deep-decision"),
      parentAgentId: result.completedRun.parentAgentId,
      action: "resume_child",
      childSpecIds: [result.completedRun.spec.specId],
      childRunIds: [result.completedRun.childRunId],
      inputRefs: [
        `child_run:${result.completedRun.childRunId}`,
        ...(childInstructionRef === undefined ? [] : [childInstructionRef]),
      ],
      rationale: copy.eventTitle,
      uncertainty: result.summary.uncertainty ?? result.completedRun.failureReason ?? "",
      source: "control_api",
      confidence: result.summary.confidence ?? result.completedRun.confidence ?? 0.5,
      reasoningTraceRefs: [
        ...(childInstructionRef === undefined ? [] : [childInstructionRef]),
        `child_run:${result.completedRun.childRunId}`,
      ],
      createdAt: latestParentInstruction?.requestedAt ?? updatedAt,
    },
    updatedAt,
  );
  const report = record.report === undefined
    ? undefined
    : {
        ...record.report,
        agentRunTree,
        childSummaries: replaceChildSummary(record.report.childSummaries, result.summary),
      };
  const liveProjection = updateLiveProjectionForChild(
    record.liveProjection ?? fallbackLiveProjectionForRecord(record),
    result,
    updatedAt,
    { markSynthesisPending: record.report?.conclusion !== undefined },
  );
  const eventSequence = appendChildOperationEvent(record, result.completedRun, {
    title: copy.eventTitle,
    summary: copy.eventSummary,
    timestamp: updatedAt,
  });
  const updated: DeepRunRecord = {
    ...record,
    run: { ...record.run, updatedAt },
    agentRunTree,
    report,
    eventSequence,
    liveProjection,
    updatedAt,
  };
  await state.runRecordStore.upsert(updated);
  return updated;
}

export async function applyDeepResynthesisResult(
  state: DeepChildControlUpdateState,
  record: DeepRunRecord,
  synthesis: DeepResynthesisResult,
): Promise<DeepRunRecord> {
  const updatedAt = nowIso();
  const agentRunTree = appendParentSynthesisToTree(record.agentRunTree, synthesis.synthesisRecord, updatedAt);
  const report = record.report === undefined
    ? undefined
    : {
        ...record.report,
        agentRunTree,
        synthesisRecords: [...record.report.synthesisRecords, synthesis.synthesisRecord],
        conclusion: synthesis.conclusion,
      };
  const liveProjection = updateLiveProjectionForResynthesis(
    record.liveProjection ?? fallbackLiveProjectionForRecord(record),
    synthesis,
    updatedAt,
  );
  const eventSequence = appendResynthesisEvents(record, synthesis, updatedAt);
  const updated: DeepRunRecord = {
    ...record,
    run: { ...record.run, updatedAt },
    agentRunTree,
    report,
    eventSequence,
    liveProjection,
    updatedAt,
  };
  await state.runRecordStore.upsert(updated);
  return updated;
}

export function collectDeepChildEvidenceRefs(childSummaries: readonly DeepChildSummary[]): string[] {
  const refs = new Set<string>();
  for (const summary of childSummaries) {
    for (const ref of summary.evidenceRefs) {
      const trimmed = ref.trim();
      if (trimmed.length > 0) {
        refs.add(trimmed);
      }
    }
  }
  return [...refs];
}

export function buildDeepResynthesisInputRefs(record: DeepRunRecord): ObservationRef[] {
  const refs: ObservationRef[] = [
    { kind: "trace", id: record.run.runId },
    { kind: "goal", id: record.run.conversationId },
    { kind: "agent_run", id: record.run.runId, label: "deep-manager-resynthesis" },
  ];
  for (const decision of record.agentRunTree.delegationDecisions) {
    refs.push({ kind: "agent_delegation", id: decision.decisionId });
  }
  for (const childRun of record.agentRunTree.childRuns) {
    refs.push({ kind: "agent_run", id: childRun.childRunId, label: childRun.spec.displayName });
  }
  return refs;
}

function findChildRun(record: DeepRunRecord, childRunId: string): ChildAgentRun | undefined {
  return record.agentRunTree.childRuns.find((run) => run.childRunId === childRunId);
}

function findChildSummary(record: DeepRunRecord, childRunId: string): DeepChildSummary | undefined {
  return record.report?.childSummaries.find((summary) => summary.childRunId === childRunId);
}

function childRunSpecFromRun(childRun: ChildAgentRun): DeepChildSpec {
  return {
    specId: childRun.spec.specId,
    displayName: childRun.spec.displayName,
    role: childRun.spec.role,
    objective: childRun.spec.instructions?.objective ?? childRun.spec.role,
    allowedTools: [...childRun.spec.permissions.allowedTools],
    inputRefs: [...childRun.spec.inputRefs],
    maxModelRounds: childRun.spec.permissions.maxModelRounds,
    maxToolRounds: childRun.spec.permissions.maxToolRounds,
  };
}

function replaceChildSummary(
  summaries: readonly DeepChildSummary[],
  summary: DeepChildSummary,
): readonly DeepChildSummary[] {
  const found = summaries.some((item) => item.childRunId === summary.childRunId);
  return found
    ? summaries.map((item) => item.childRunId === summary.childRunId ? summary : item)
    : [...summaries, summary];
}

function updateLiveProjectionForResynthesis(
  projection: DeepLiveProjection,
  synthesis: DeepResynthesisResult,
  updatedAt: string,
): DeepLiveProjection {
  return {
    ...projection,
    phase: "completed",
    activeNodeId: "conclusion",
    synthesis: {
      synthesisId: synthesis.synthesisRecord.synthesisId,
      status: "completed",
      summary: synthesis.synthesisRecord.decisionSummary,
      confidence: synthesis.synthesisRecord.confidence,
      updatedAt,
    },
    conclusion: {
      conclusionId: synthesis.conclusion.conclusionId,
      oneLineRationale: synthesis.conclusion.oneLineRationale,
      confidence: synthesis.conclusion.confidence,
      updatedAt,
    },
    updatedAt,
  };
}

function updateLiveProjectionForChild(
  projection: DeepLiveProjection,
  result: DeepChildAgentRunResult,
  updatedAt: string,
  options?: { readonly markSynthesisPending?: boolean },
): DeepLiveProjection {
  const child = {
    childRunId: result.completedRun.childRunId,
    displayName: result.summary.spec.displayName,
    objective: result.summary.spec.objective,
    role: result.summary.spec.role,
    status: result.completedRun.status,
    updatedAt,
    summary: result.summary.summary,
    latestResult: result.summary.summary,
    confidence: result.summary.confidence,
    uncertainty: result.summary.uncertainty,
    failureDetail: result.summary.failureDetail,
    continuationContextRef: result.summary.continuationContextRef,
    workflowItems: liveChildWorkflowItemsForControlResult(result, updatedAt),
    execution: liveChildExecutionForControlResult(result.completedRun),
    parentInstructions: liveChildParentInstructionsForControlResult(result.completedRun),
    pendingApproval: result.completedRun.pendingApproval,
    parentOperation: liveParentOperationFromInstruction(result.completedRun.parentInstructions?.at(-1)),
  };
  const found = projection.children.some((item) => item.childRunId === child.childRunId);
  const children = found
    ? projection.children.map((item) => item.childRunId === child.childRunId ? child : item)
    : [...projection.children, child];
  const synthesis = options?.markSynthesisPending === true
    ? {
        ...(projection.synthesis ?? { status: "pending" as const }),
        status: "pending" as const,
        summary: "子 Agent 已更新，等待父层重新综合。",
        updatedAt,
      }
    : projection.synthesis;
  return {
    ...projection,
    phase: result.completedRun.status === "blocked" ? "needs_input" : projection.phase,
    activeNodeId: options?.markSynthesisPending === true && result.completedRun.status !== "blocked"
      ? "synthesis"
      : result.completedRun.status === "completed"
        ? "synthesis"
        : "children",
    children,
    synthesis,
    updatedAt,
  };
}

function liveChildWorkflowItemsForControlResult(
  result: DeepChildAgentRunResult,
  updatedAt: string,
): readonly DeepLiveChildWorkflowItem[] {
  const childRun = result.completedRun;
  const items: DeepLiveChildWorkflowItem[] = [{
    itemId: `objective:${childRun.childRunId}`,
    kind: "objective_set",
    title: "目标已明确",
    detail: result.summary.spec.objective,
    status: "completed",
    timestamp: childRun.startedAt,
  }];
  for (const instruction of childRun.parentInstructions ?? []) {
    const timestamp = instruction.executedAt ?? instruction.cancelledAt ?? instruction.queuedAt ?? instruction.requestedAt;
    items.push({
      itemId: `parent-instruction:${childRun.childRunId}:${instruction.instructionId}`,
      kind: instruction.status === "queued" ? "parent_message_queued" : "parent_message_applied",
      title: instruction.status === "queued" ? "已追加要求" : instruction.status === "cancelled" ? "跟进已取消" : "已跟进",
      detail: safeParentInstructionProjectionSummary(instruction.status),
      status: instruction.status === "queued" ? "pending" : instruction.status === "cancelled" ? "cancelled" : "completed",
      timestamp,
    });
  }
  for (const [index, segment] of (childRun.executionHistory ?? []).entries()) {
    for (const [messageIndex, message] of (segment.modelMessages ?? []).entries()) {
      const item = workflowItemForModelMessage(childRun.childRunId, index, messageIndex, message);
      if (item !== undefined) {
        items.push(item);
      }
    }
    for (const [callIndex, call] of segment.toolCalls.entries()) {
      items.push(toolWorkflowItem(childRun.childRunId, index, call.callId || callIndex, call, segment.recordedAt));
    }
    items.push({
      itemId: `segment:${childRun.childRunId}:${index}`,
      kind: segment.outcome === "completed" ? "completed" : segment.outcome,
      title: segment.outcome === "completed" ? "阶段结果已返回" : "执行未完成",
      detail: `模型 ${segment.modelRounds} 轮，工具 ${segment.toolRounds} 轮`,
      status: segment.outcome,
      timestamp: segment.recordedAt,
    });
  }
  if ((childRun.executionHistory?.length ?? 0) === 0 && childRun.execution !== undefined) {
    const recordedAt = childRun.completedAt ?? updatedAt;
    for (const [messageIndex, message] of (childRun.execution.modelMessages ?? []).entries()) {
      const item = workflowItemForModelMessage(childRun.childRunId, "latest", messageIndex, message);
      if (item !== undefined) {
        items.push(item);
      }
    }
    for (const [callIndex, call] of childRun.execution.toolCalls.entries()) {
      items.push(toolWorkflowItem(childRun.childRunId, "latest", call.callId || callIndex, call, recordedAt));
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
  items.push({
    itemId: `status:${childRun.childRunId}:${childRun.status}`,
    kind: childRun.status === "blocked" || childRun.status === "failed" || childRun.status === "interrupted"
      ? childRun.status
      : "completed",
    title: childRun.status === "completed" ? "结果已返回" : childRun.status === "blocked" ? "等待处理" : "未完成",
    detail: childRun.failureReason ?? result.summary.summary,
    status: childRun.status === "planned" || childRun.status === "running" || childRun.status === "resumed"
      ? "running"
      : childRun.status,
    timestamp: childRun.completedAt ?? updatedAt,
  });
  return mergeLiveChildWorkflowItems(items);
}

function toolWorkflowItem(
  childRunId: string,
  segmentIndex: string | number,
  callId: string | number,
  call: { readonly toolName: string; readonly status: "approval_required" | "completed" | "cancelled" | "failed" },
  timestamp: string,
): DeepLiveChildWorkflowItem {
  return {
    itemId: `tool:${childRunId}:${segmentIndex}:${callId}`,
    kind: call.status === "approval_required" ? "tool_waiting" : "tool_completed",
    title: call.status === "approval_required" ? "等待工具确认" : "工具调用完成",
    detail: `${call.toolName}：${call.status}`,
    status: call.status === "approval_required"
      ? "blocked"
      : call.status === "completed"
        ? "completed"
        : call.status === "cancelled"
          ? "cancelled"
          : "failed",
    timestamp,
  };
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
    status: message.status === "completed" ? "completed" : message.status === "cancelled" ? "cancelled" : "failed",
    timestamp: message.completedAt,
  };
}

function modelMessageProjectionText(message: ChildAgentRunModelMessageTrace): string | undefined {
  const text = message.text?.trim();
  if (text !== undefined && text.length > 0) {
    return text;
  }
  const reasoning = message.reasoningSummary?.trim();
  return reasoning === undefined || reasoning.length === 0 ? undefined : reasoning;
}

function liveChildExecutionForControlResult(
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

function liveChildParentInstructionsForControlResult(
  childRun: ChildAgentRun,
): readonly DeepLiveChildParentInstructionProjection[] | undefined {
  if (childRun.parentInstructions === undefined || childRun.parentInstructions.length === 0) {
    return undefined;
  }
  return childRun.parentInstructions.map((instruction) => ({
    instructionId: instruction.instructionId,
    status: instruction.status,
    instructionSummary: safeParentInstructionProjectionSummary(instruction.status),
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

function safeParentInstructionProjectionSummary(status: ChildAgentRunParentInstructionStatus): string {
  switch (status) {
    case "queued":
      return "父层追加了跟进要求，等待子 Agent 处理。";
    case "cancelled":
      return "父层追加的跟进要求已取消。";
    default:
      return "父层追加了跟进要求，子 Agent 已处理。";
  }
}

function mergeLiveChildWorkflowItems(
  items: readonly DeepLiveChildWorkflowItem[],
): readonly DeepLiveChildWorkflowItem[] {
  const byId = new Map<string, DeepLiveChildWorkflowItem>();
  for (const item of items) {
    byId.set(item.itemId, item);
  }
  return [...byId.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function appendChildOperationEvent(
  record: DeepRunRecord,
  childRun: ChildAgentRun,
  copy: { readonly title: string; readonly summary: string; readonly timestamp: string },
): readonly DeepRunStreamEvent[] {
  const type = childRun.status === "completed"
    ? "deep.child.completed"
    : childRun.status === "blocked"
      ? "deep.child.blocked"
      : childRun.status === "interrupted"
        ? "deep.child.interrupted"
        : "deep.child.failed";
  const event: DeepRunStreamEvent = {
    id: createId("deep-evt"),
    runId: record.run.runId,
    sequence: (record.eventSequence.at(-1)?.sequence ?? 0) + 1,
    type,
    title: copy.title,
    summary: copy.summary,
    status: childRun.status,
    timestamp: copy.timestamp,
    refs: [
      { kind: "child_run", refId: childRun.childRunId },
      { kind: "agent_run_tree", refId: record.agentRunTree.treeId },
    ],
    visibility: "public",
  };
  return [...record.eventSequence, event];
}

function appendResynthesisEvents(
  record: DeepRunRecord,
  synthesis: DeepResynthesisResult,
  timestamp: string,
): readonly DeepRunStreamEvent[] {
  const baseSequence = record.eventSequence.at(-1)?.sequence ?? 0;
  const synthesisEvent: DeepRunStreamEvent = {
    id: createId("deep-evt"),
    runId: record.run.runId,
    sequence: baseSequence + 1,
    type: "deep.parent_synthesis.completed",
    title: "父层已重新综合",
    summary: synthesis.synthesisRecord.decisionSummary,
    status: "completed",
    timestamp,
    refs: [
      { kind: "parent_synthesis", refId: synthesis.synthesisRecord.synthesisId },
      ...synthesis.synthesisRecord.childRunIds.map((childRunId) => ({ kind: "child_run" as const, refId: childRunId })),
      { kind: "agent_run_tree", refId: record.agentRunTree.treeId },
    ],
    visibility: "public",
  };
  const conclusionEvent: DeepRunStreamEvent = {
    id: createId("deep-evt"),
    runId: record.run.runId,
    sequence: baseSequence + 2,
    type: "deep.conclusion.produced",
    title: "重新综合结论",
    summary: synthesis.conclusion.oneLineRationale,
    status: "completed",
    timestamp,
    refs: [
      { kind: "conclusion", refId: synthesis.conclusion.conclusionId },
      { kind: "parent_synthesis", refId: synthesis.synthesisRecord.synthesisId },
    ],
    visibility: "public",
  };
  return [...record.eventSequence, synthesisEvent, conclusionEvent];
}
