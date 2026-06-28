import type { ChildAgentRun, ChildAgentRunParentInstruction } from "../../domain/underground/agent-fabric.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import type { WorkspaceFolderSummary } from "../workspace-folder-summary.js";
import { workspaceFolderSummaryFromPath } from "../workspace-folder-summary.js";
import { safeAgentRunTreeRef } from "../underground-events.js";
import type {
  DeepConversation,
  DeepFollowUpContext,
  DeepLiveChildExecutionProjection,
  DeepLiveChildParentOperationProjection,
  DeepLiveChildParentInstructionProjection,
  DeepLiveChildWorkflowItem,
  DeepLiveProjection,
  DeepRunStatus,
} from "./contracts.js";
import type { DeepRunRecord } from "./deep-runtime.js";

export function summarizeTerminalDeepRunForIntake(record: DeepRunRecord): string {
  const conclusion = record.report?.conclusion.conclusion ??
    record.liveProjection?.conclusion?.oneLineRationale ??
    "(上一轮尚无明确结论)";
  const synthesis = record.report?.synthesisRecords.at(-1)?.decisionSummary ??
    record.liveProjection?.synthesis?.summary ??
    "(上一轮尚无综合摘要)";
  const childResults = record.report?.childSummaries
    .slice(0, 4)
    .map((child, index) => `${index + 1}. ${child.spec.displayName}：${child.summary}`)
    .join("； ");
  return [
    `上一轮目标：${record.run.goal}`,
    `上一轮结论：${conclusion}`,
    `上一轮综合：${synthesis}`,
    `探索结果：${childResults === undefined || childResults.length === 0 ? "(无协作探索结果)" : childResults}`,
    "续聊默认：用户新消息优先视为围绕上一轮目标的补充、解释、追问或继续研究要求。",
  ].join("; ");
}

export function summarizeTaskSoilInputForIntake(
  input: DesktopTaskSoilInput | undefined,
): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  const refs = input.contextRefs?.map((ref) => `${ref.kind}:${ref.ref}`) ?? [];
  const permissions = input.permissionBoundaryRefs ?? [];
  const segments = [
    refs.length > 0 ? `contextRefs=${refs.join(", ")}` : undefined,
    permissions.length > 0 ? `permissionBoundaryRefs=${permissions.join(", ")}` : undefined,
  ].filter((segment): segment is string => segment !== undefined);
  return segments.length === 0 ? "(no extra context)" : segments.join("; ");
}

export function projectDeepConversation(conversation: DeepConversation): Record<string, unknown> {
  return {
    conversationId: conversation.conversationId,
    title: conversation.title,
    goal: conversation.goal,
    intakeTurns: conversation.intakeTurns ?? [],
    currentObjective: conversation.currentObjective,
    birthWorkspaceDirectory: conversation.birthWorkspaceDirectory,
    isolation: conversation.isolation,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

export function latestDeepRunRecordsByRoot(records: readonly DeepRunRecord[]): readonly DeepRunRecord[] {
  const selected = new Map<string, DeepRunRecord>();
  for (const record of records) {
    const rootRunId = record.run.rootRunId ?? record.run.runId;
    const current = selected.get(rootRunId);
    if (current === undefined || record.run.updatedAt.localeCompare(current.run.updatedAt) > 0) {
      selected.set(rootRunId, record);
    }
  }
  return [...selected.values()].sort((left, right) => right.run.updatedAt.localeCompare(left.run.updatedAt));
}

function workspaceFolderForDeepRecord(record: DeepRunRecord): WorkspaceFolderSummary | undefined {
  return workspaceFolderSummaryFromPath(workspaceDirectoryFromDeepRunRecord(record));
}

function workspaceFolderForDeepConversation(conversation: DeepConversation | undefined): WorkspaceFolderSummary | undefined {
  return workspaceFolderSummaryFromPath(conversation?.birthWorkspaceDirectory);
}

export function workspaceDirectoryFromDeepRunRecord(record: DeepRunRecord): string | undefined {
  return record.run.capabilitySnapshot?.workspace.workspaceDirectory;
}

export function projectDeepRunSummary(
  record: DeepRunRecord,
  rootRecord?: DeepRunRecord,
): Record<string, unknown> {
  const workspaceFolder = workspaceFolderForDeepRecord(rootRecord ?? record) ??
    workspaceFolderForDeepRecord(record);
  return {
    runId: record.run.runId,
    conversationId: record.run.conversationId,
    parentRunId: record.run.parentRunId,
    rootRunId: record.run.rootRunId ?? record.run.runId,
    turnOrdinal: record.run.turnOrdinal ?? 1,
    goal: record.run.goal,
    status: record.run.status,
    runKind: record.run.isolation.runKind,
    runMode: record.run.isolation.runMode,
    startedAt: record.run.startedAt,
    updatedAt: record.run.updatedAt,
    hasConclusion: record.report?.conclusion !== undefined,
    childCount: record.agentRunTree.childRuns.length,
    eventCount: record.eventSequence.length,
    workspaceFolder,
    brief: record.brief,
  };
}

/**
 * Safe run view projection for Panel. Raw prompt, raw response and raw tool
 * output stay out of this read-model.
 */
export function projectDeepRunView(
  record: DeepRunRecord,
  conversation?: DeepConversation,
): Record<string, unknown> {
  const workspaceFolder = workspaceFolderForDeepRecord(record) ??
    workspaceFolderForDeepConversation(conversation);
  return {
    run: {
      runId: record.run.runId,
      conversationId: record.run.conversationId,
      parentRunId: record.run.parentRunId,
      rootRunId: record.run.rootRunId ?? record.run.runId,
      turnOrdinal: record.run.turnOrdinal ?? 1,
      goal: record.run.goal,
      status: record.run.status,
      runKind: record.run.isolation.runKind,
      runMode: record.run.isolation.runMode,
      startedAt: record.run.startedAt,
      updatedAt: record.run.updatedAt,
      workspaceFolder,
    },
    agentRunTree: safeAgentRunTreeRef(record.agentRunTree),
    report: record.report,
    eventSequence: record.eventSequence,
    liveProjection: record.liveProjection ?? fallbackLiveProjectionForRecord(record),
    brief: record.brief,
    conversation: conversation === undefined ? undefined : projectDeepConversation(conversation),
  };
}

export function fallbackLiveProjectionForRecord(record: DeepRunRecord): DeepLiveProjection {
  const updatedAt = record.run.updatedAt;
  const children =
    record.report?.childSummaries.map((summary) => {
      const childRun = record.agentRunTree.childRuns.find((run) => run.childRunId === summary.childRunId);
      return {
        childRunId: summary.childRunId,
        displayName: summary.spec.displayName,
        objective: summary.spec.objective,
        role: summary.spec.role,
        status: summary.status,
        summary: summary.summary,
        latestResult: summary.summary,
        confidence: summary.confidence,
        uncertainty: summary.uncertainty,
        workflowItems: childRun === undefined
          ? fallbackWorkflowItemsForSummary(summary.childRunId, summary.spec.objective, summary.summary, updatedAt)
          : fallbackWorkflowItemsForChildRun(childRun, summary.summary, updatedAt),
        execution: childRun === undefined ? undefined : fallbackExecutionFromChildRun(childRun),
        parentInstructions: childRun === undefined ? undefined : fallbackParentInstructionsFromChildRun(childRun),
        parentOperation: liveParentOperationFromInstruction(childRun?.parentInstructions?.at(-1)),
        updatedAt,
      };
    }) ?? [];
  const conclusion =
    record.report?.conclusion === undefined
      ? undefined
      : {
          conclusionId: record.report.conclusion.conclusionId,
          oneLineRationale: record.report.conclusion.oneLineRationale,
          confidence: record.report.conclusion.confidence,
          updatedAt,
        };
  const synthesis = record.report?.synthesisRecords.at(-1);
  return {
    phase: livePhaseForRunStatus(record.run.status),
    activeNodeId: conclusion === undefined ? "decision" : "conclusion",
    children,
    decision: undefined,
    synthesis:
      synthesis === undefined
        ? undefined
        : {
            synthesisId: synthesis.synthesisId,
            status: "completed",
            summary: synthesis.decisionSummary,
            confidence: synthesis.confidence,
            updatedAt,
          },
    conclusion,
    updatedAt,
  };
}

function fallbackWorkflowItemsForSummary(
  childRunId: string,
  objective: string,
  summary: string,
  updatedAt: string,
): readonly DeepLiveChildWorkflowItem[] {
  return [
    {
      itemId: `objective:${childRunId}`,
      kind: "objective_set",
      title: "目标已明确",
      detail: objective,
      status: "completed",
      timestamp: updatedAt,
    },
    {
      itemId: `status:${childRunId}:completed`,
      kind: "completed",
      title: "结果已返回",
      detail: summary,
      status: "completed",
      timestamp: updatedAt,
    },
  ];
}

function fallbackWorkflowItemsForChildRun(
  childRun: ChildAgentRun,
  summary: string,
  updatedAt: string,
): readonly DeepLiveChildWorkflowItem[] {
  const items: DeepLiveChildWorkflowItem[] = [
    {
      itemId: `objective:${childRun.childRunId}`,
      kind: "objective_set",
      title: "目标已明确",
      detail: childRun.spec.instructions?.objective,
      status: "completed",
      timestamp: childRun.startedAt,
    },
  ];
  for (const instruction of childRun.parentInstructions ?? []) {
    const timestamp = instruction.executedAt ?? instruction.cancelledAt ?? instruction.queuedAt ?? instruction.requestedAt;
    items.push({
      itemId: `parent-instruction:${childRun.childRunId}:${instruction.instructionId}`,
      kind: instruction.status === "queued" ? "parent_message_queued" : "parent_message_applied",
      title: instruction.status === "queued" ? "已追加要求" : instruction.status === "cancelled" ? "跟进已取消" : "已跟进",
      detail: instruction.instructionSummary,
      status: instruction.status === "queued" ? "pending" : instruction.status === "cancelled" ? "cancelled" : "completed",
      timestamp,
    });
  }
  for (const [index, segment] of (childRun.executionHistory ?? []).entries()) {
    for (const [callIndex, call] of segment.toolCalls.entries()) {
      items.push({
        itemId: `tool:${childRun.childRunId}:${index}:${call.callId || callIndex}`,
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
        timestamp: segment.recordedAt,
      });
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
    detail: childRun.failureReason ?? summary,
    status: childRun.status === "resumed" || childRun.status === "planned" || childRun.status === "running"
      ? "running"
      : childRun.status,
    timestamp: childRun.completedAt ?? updatedAt,
  });
  return mergeWorkflowItems(items);
}

function fallbackExecutionFromChildRun(
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

function fallbackParentInstructionsFromChildRun(
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

function mergeWorkflowItems(
  items: readonly DeepLiveChildWorkflowItem[],
): readonly DeepLiveChildWorkflowItem[] {
  const byId = new Map<string, DeepLiveChildWorkflowItem>();
  for (const item of items) {
    byId.set(item.itemId, item);
  }
  return [...byId.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

export function liveParentOperationFromInstruction(
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
    case "running":
      return "deciding";
    default:
      return "starting";
  }
}

export function buildDeepFollowUpContext(
  previous: DeepRunRecord,
  message: string,
): DeepFollowUpContext {
  const reportChildSummaries = previous.report?.childSummaries.map((summary) => ({
    childRunId: summary.childRunId,
    displayName: summary.spec.displayName,
    role: summary.spec.role,
    status: summary.status,
    summary: summary.summary,
    findings: summary.findings,
    evidenceRefs: summary.evidenceRefs,
    confidence: summary.confidence,
    uncertainty: summary.uncertainty,
  }));
  const liveChildSummaries = previous.liveProjection?.children.map((child) => ({
    childRunId: child.childRunId,
    displayName: child.displayName,
    role: child.role,
    status: child.status,
    summary: child.summary ?? "",
    findings: [],
    evidenceRefs: [],
    confidence: child.confidence,
    uncertainty: child.uncertainty,
  }));
  const latestSynthesis = previous.report?.synthesisRecords.at(-1);
  return {
    message,
    previousRunId: previous.run.runId,
    previousGoal: previous.run.goal,
    previousStatus: previous.run.status,
    previousConclusion: previous.report?.conclusion.conclusion,
    previousOneLineRationale:
      previous.report?.conclusion.oneLineRationale ?? previous.liveProjection?.conclusion?.oneLineRationale,
    childSummaries: reportChildSummaries ?? liveChildSummaries ?? [],
    synthesisSummary: latestSynthesis?.decisionSummary ?? previous.liveProjection?.synthesis?.summary,
  };
}
