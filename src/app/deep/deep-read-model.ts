import type { ChildAgentRunParentInstruction } from "../../domain/underground/agent-fabric.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import type { WorkspaceFolderSummary } from "../workspace-folder-summary.js";
import { workspaceFolderSummaryFromPath } from "../workspace-folder-summary.js";
import { safeAgentRunTreeRef } from "../underground-events.js";
import type {
  DeepConversation,
  DeepFollowUpContext,
  DeepLiveChildParentOperationProjection,
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
      workspaceFolder: workspaceFolderForDeepRecord(record),
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
        confidence: summary.confidence,
        uncertainty: summary.uncertainty,
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
