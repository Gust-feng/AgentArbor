import type { ArborMessageType } from "../domain/common.js";
import type { RunObservationSnapshot } from "../domain/observation/index.js";
import type { RootletClusterKind } from "../domain/underground/index.js";
import { ROOTLET_CLUSTER_KINDS } from "../domain/underground/index.js";
import type { PanelTranscriptModelCall } from "./panel-transcript-model-calls.js";
import { eventRefsFor, hasEvent, isString, lastRecordedAt, unique } from "./panel-read-model-utils.js";
import type { AgentWorkNote, PanelWorkNotesInput } from "./panel-work-note-contracts.js";

export type { AgentWorkNote, PanelWorkNotesInput } from "./panel-work-note-contracts.js";

export function createPanelWorkNotes(input: PanelWorkNotesInput): readonly AgentWorkNote[] {
  const candidateRefs = candidateRefsFromObservation(input.observation);
  const noteInput: NoteFactoryInput = {
    ...input,
    candidateRefs,
  };

  if (input.summary === undefined && input.observation === undefined) {
    if (input.desktopChatOnly) {
      return [
        createDesktopChatNote(noteInput),
        createModelCallsNote(noteInput),
      ];
    }
    if (input.agentRunTree !== undefined) {
      return [
        createWorkSessionManagerNote(noteInput),
        createAgentRunTreeNote(noteInput),
        createModelCallsNote(noteInput),
      ];
    }
  }

  return [
    createIntentCoreNote(noteInput),
    createGrowthGovernorNote(noteInput),
    createAgentRunTreeNote(noteInput),
    createRootletAgentsNote(noteInput),
    createModelCallsNote(noteInput),
    createAutonomyCoreNote(noteInput),
    createConvergenceJudgeNote(noteInput),
    createHandoffStewardNote(noteInput),
  ];
}

function createIntentCoreNote(input: NoteFactoryInput): AgentWorkNote {
  const eventRefs = eventRefsFor(input.eventEntries, ["goal.received", "underground.exploration_planned"]);
  const planned = hasEvent(input.eventEntries, "underground.exploration_planned");
  const received = hasEvent(input.eventEntries, "goal.received");
  const trace = extractReasoningTraceFromModelCalls(input.modelCalls, "underground.intent_profile.v1");
  return note({
    input,
    noteId: "intent-core",
    agentId: "underground-intent-core",
    agentLabel: "Intent Core",
    stage: "intent_profile",
    status: planned ? "completed" : received ? "running" : "pending",
    summary: planned ? "目标画像已成形，地下探索计划已发布。" : received ? "目标已进入地下认知运行时，正在形成目标画像。" : "等待目标进入地下认知运行时。",
    detail: "工作笔记只记录目标接收和画像成形状态，不展示隐藏推理链或完整用户输入。",
    eventRefs,
    reasoningTrace: trace,
  });
}

function createDesktopChatNote(input: NoteFactoryInput): AgentWorkNote {
  const eventRefs = eventRefsFor(input.eventEntries, [
    "goal.received",
    "model.requested",
    "model.completed",
    "model.failed",
    "context.compaction.completed",
    "context.compaction.failed",
    "tool.requested",
    "tool.completed",
    "tool.failed",
    "user_approval.requested",
  ]);
  const failed = input.modelCalls.some((call) => call.status === "failed");
  const completed = input.modelCalls.some((call) => call.status === "completed");
  const requested = input.modelCalls.some((call) => call.status === "requested");
  const needsConfirmation = hasEvent(input.eventEntries, "user_approval.requested");
  return note({
    input,
    noteId: "desktop-agent",
    agentId: "desktop-agent-session",
    agentLabel: "桌面助手",
    stage: "desktop_agent",
    status: failed ? "failed" : needsConfirmation ? "running" : completed ? "completed" : requested ? "running" : "pending",
    summary: needsConfirmation
      ? "桌面助手已暂停在确认边界，等待用户补充授权或材料。"
      : completed
        ? "桌面助手已完成本轮结果；没有启动地下组织或方向包。"
        : requested
          ? "桌面助手正在判断本轮处理方式。"
          : "等待用户消息。",
    detail: "普通模式由桌面助手直接处理，可在授权范围内调用工具；缺少权限时请求确认，深入模式只由用户显式选择。",
    eventRefs,
    modelCallRefs: input.modelCalls.map((call) => call.requestId),
  });
}

function createWorkSessionManagerNote(input: NoteFactoryInput): AgentWorkNote {
  const eventRefs = eventRefsFor(input.eventEntries, [
    "goal.received",
    "agent.delegation.planned",
    "agent.child.started",
    "agent.child.completed",
    "agent.child.waiting",
    "agent.parent_synthesis.completed",
    "artifact.produced",
  ]);
  const tree = input.agentRunTree;
  const producedArtifact = hasEvent(input.eventEntries, "artifact.produced");
  const producedDirectAnswer = input.modelCalls.some((call) => call.outputContractId === "work_session.direct_answer.v1" && call.status === "completed");
  const hasSynthesis = (tree?.parentSyntheses.length ?? 0) > 0;
  return note({
    input,
    noteId: "work-session-manager",
    agentId: "cognitive-work-session-manager",
    agentLabel: "Legacy Work Session Manager",
    stage: "cognitive_work_session",
    status: producedArtifact || producedDirectAnswer ? "completed" : hasSynthesis ? "running" : eventRefs.length > 0 ? "running" : "pending",
    summary: producedDirectAnswer
      ? "Legacy Work Session 已直接回答当前问题。"
      : producedArtifact
        ? "Legacy Work Session 已生成最终项目分析报告。"
        : hasSynthesis
          ? "父层综合已形成，正在准备最终报告。"
          : "主 Agent 正在决定读取、派生、综合或停止。",
    detail:
      tree === undefined
        ? "Legacy Work Session 仅保留兼容，不作为当前 Desktop 深度模式主线。"
        : `root ${tree.rootAgentId}；child ${tree.childRuns.length} 个；parent synthesis ${tree.parentSyntheses.length} 次。`,
    eventRefs,
    evidenceRefs: tree?.parentSyntheses.flatMap((synthesis) => synthesis.outputRefs) ?? [],
    modelCallRefs: input.modelCalls.map((call) => call.requestId),
  });
}

function createGrowthGovernorNote(input: NoteFactoryInput): AgentWorkNote {
  const eventRefs = eventRefsFor(input.eventEntries, ["underground.exploration_planned", "rootlet_cluster.started"]);
  const started = hasEvent(input.eventEntries, "rootlet_cluster.started");
  const planned = hasEvent(input.eventEntries, "underground.exploration_planned");
  return note({
    input,
    noteId: "growth-governor",
    agentId: "underground-growth-governor",
    agentLabel: "Growth Governor",
    stage: "rootlet_planning",
    status: started ? "completed" : planned ? "running" : "pending",
    summary: started ? "Rootlet 集群已按地下探索计划启动。" : planned ? "已接收探索计划，正在准备 rootlet 集群。" : "等待 Intent Core 输出探索计划。",
    detail: "该笔记只展示调度状态和 rootlet kind 计划，不写入 Plan 或地上执行计划。",
    eventRefs,
  });
}

function createAgentRunTreeNote(input: NoteFactoryInput): AgentWorkNote {
  const eventRefs = eventRefsFor(input.eventEntries, [
    "agent.delegation.planned",
    "agent.child.started",
    "agent.child.completed",
    "agent.child.waiting",
    "agent.parent_synthesis.completed",
  ]);
  const tree = input.observation?.underground.agentRunTree ?? input.agentRunTree;
  const completedChildren = tree?.childRuns.filter((run) => run.status === "completed").length ?? 0;
  const runningChildren = tree?.childRuns.filter((run) => run.status === "running" || run.status === "resumed").length ?? 0;
  const hasSynthesis = (tree?.parentSyntheses.length ?? 0) > 0;
  return note({
    input,
    noteId: "agent-run-tree",
    agentId: "underground-center-manager",
    agentLabel: "运行树",
    stage: "delegation",
    status: hasSynthesis ? "completed" : runningChildren > 0 || eventRefs.length > 0 ? "running" : "pending",
    summary:
      tree === undefined
        ? "等待生成分工运行树。"
        : `运行树 ${tree.status}，局部检查 ${completedChildren}/${tree.childRuns.length} 已完成。`,
    detail:
      tree === undefined
        ? "分工、等待、继续和父层综合会作为安全事件进入活动流。"
        : `delegation ${tree.delegationDecisions.length} 次，parent synthesis ${tree.parentSyntheses.length} 次；child 输出不会直接进入最终 artifact / Plan。`,
    eventRefs,
    evidenceRefs: tree?.parentSyntheses.flatMap((synthesis) => synthesis.outputRefs) ?? [],
    candidateRefs: tree?.parentSyntheses.flatMap((synthesis) => synthesis.retainedMaterialRefs) ?? [],
  });
}

function createRootletAgentsNote(input: NoteFactoryInput): AgentWorkNote {
  const eventRefs = eventRefsFor(input.eventEntries, [
    "rootlet_cluster.started",
    "model.requested",
    "model.completed",
    "model.failed",
    "tool.requested",
    "tool.completed",
    "tool.failed",
    "exploration_candidate.produced",
    "candidate_pool.updated",
  ]);
  const candidatePoolUpdated = hasEvent(input.eventEntries, "candidate_pool.updated");
  const rootletsStarted = hasEvent(input.eventEntries, "rootlet_cluster.started");
  const modelCallRefs = input.modelCalls.map((call) => call.requestId);
  return note({
    input,
    noteId: "rootlet-agents",
    agentId: "underground-rootlet-agents",
    agentLabel: "Rootlet Agents",
    stage: "rootlet_outputs",
    status: candidatePoolUpdated ? "completed" : rootletsStarted || modelCallRefs.length > 0 ? "running" : "pending",
    summary: candidatePoolUpdated
      ? "Rootlet 产物已进入唯一候选池。"
      : rootletsStarted
        ? "Rootlet agents 正在产出候选和模型建议引用。"
        : "等待 Rootlet 集群启动。",
    detail: `Rootlet kinds: ${rootletKindsFor(input).join(" / ")}。模型和工具只记录调用引用、状态和候选引用，不展示 prompt、raw output 或 secret。`,
    eventRefs,
    candidateRefs: input.candidateRefs,
    modelCallRefs,
  });
}

function createModelCallsNote(input: NoteFactoryInput): AgentWorkNote {
  const eventRefs = eventRefsFor(input.eventEntries, ["model.requested", "model.completed", "model.failed"]);
  const requested = input.modelCalls.filter((call) => call.status === "requested").length;
  const completed = input.modelCalls.filter((call) => call.status === "completed").length;
  const failed = input.modelCalls.filter((call) => call.status === "failed").length;
  const status =
    input.modelCalls.length === 0
      ? input.status === "completed" && input.summary?.ai.enabled === false
        ? "skipped"
        : "pending"
      : requested > 0
        ? "running"
        : failed > 0
          ? "failed"
          : "completed";
  return note({
    input,
    noteId: "model-calls",
    agentId: "intelligence-channel",
    agentLabel: "Model Calls",
    stage: "model_call",
    status,
    summary:
      input.modelCalls.length === 0
        ? "当前没有模型调用事件。"
        : `模型调用 requested/completed/failed = ${requested}/${completed}/${failed}。`,
    detail: "模型调用笔记只包含脱敏目的、rootlet kind、模型名、候选引用和事件引用。",
    eventRefs,
    candidateRefs: unique(input.modelCalls.flatMap((call) => call.candidateRefs)),
    modelCallRefs: input.modelCalls.map((call) => call.requestId),
  });
}

function createAutonomyCoreNote(input: NoteFactoryInput): AgentWorkNote {
  const eventRefs = eventRefsFor(input.eventEntries, [
    "candidate_pool.updated",
    "autonomy_review.completed",
    "convergence_review.requested",
    "rootlet_cluster.started",
  ]);
  const autonomy = autonomyNoteSummary(input);
  const completed = hasEvent(input.eventEntries, "autonomy_review.completed");
  const poolUpdated = hasEvent(input.eventEntries, "candidate_pool.updated");
  return note({
    input,
    noteId: "autonomy-core",
    agentId: "underground-autonomy-core",
    agentLabel: "Autonomy Core",
    stage: "autonomy_review",
    status: completed ? "completed" : poolUpdated ? "running" : "pending",
    summary:
      autonomy?.latestAction === undefined
        ? "等待候选池后进行自治评审。"
        : `自治动作 ${autonomy.latestAction}，cycle 数 ${autonomy.cycleCount}。`,
    detail:
      autonomy?.stopReason === undefined
        ? "自治核心只决定继续探索、请求收束、请求用户澄清或停止，不直接批准 Plan。"
        : `停止原因 ${autonomy.stopReason}；模型调用和候选引用仅保留安全摘要。`,
    eventRefs,
    evidenceRefs: autonomy?.sourceRefs ?? [],
    modelCallRefs: autonomy?.modelCallRefs ?? [],
  });
}

function autonomyNoteSummary(input: NoteFactoryInput):
  | {
      readonly latestAction?: string;
      readonly cycleCount: number;
      readonly stopReason?: string;
      readonly sourceRefs: readonly string[];
      readonly modelCallRefs: readonly string[];
    }
  | undefined {
  if (input.summary?.underground.autonomy !== undefined) {
    return input.summary.underground.autonomy;
  }
  const autonomy = input.observation?.underground.autonomy;
  if (autonomy === undefined) {
    return undefined;
  }
  return {
    latestAction: autonomy.latestDecision?.action,
    cycleCount: autonomy.cycles.length,
    stopReason: autonomy.stopReason,
    sourceRefs: autonomy.latestDecision?.sourceRefs ?? [],
    modelCallRefs: autonomy.latestDecision?.modelCallRefs ?? [],
  };
}

function createConvergenceJudgeNote(input: NoteFactoryInput): AgentWorkNote {
  const eventRefs = eventRefsFor(input.eventEntries, [
    "autonomy_review.completed",
    "convergence_review.requested",
    "convergence_review.completed",
  ]);
  const completed = hasEvent(input.eventEntries, "convergence_review.completed");
  const requested = hasEvent(input.eventEntries, "convergence_review.requested");
  const convergence = input.summary?.underground.convergence;
  const trace = extractReasoningTraceFromModelCalls(input.modelCalls, "underground.convergence_judgment.v1");
  return note({
    input,
    noteId: "convergence-judge",
    agentId: "underground-convergence-judge",
    agentLabel: "Convergence Judge",
    stage: "convergence_review",
    status: completed ? "completed" : requested ? "running" : "pending",
    summary: convergence === undefined ? "等待候选池进入收束评审。" : `收束结果 ${convergence.outcome}，review ${convergence.reviewId}。`,
    detail:
      convergence === undefined
        ? "收束前不会把 rootlet output 直接交给 Plan。"
        : `accepted/merged/rejected/unknown = ${convergence.accepted}/${convergence.merged}/${convergence.rejected}/${convergence.unknown}。`,
    eventRefs,
    candidateRefs: input.candidateRefs,
    reasoningTrace: trace,
  });
}

function createHandoffStewardNote(input: NoteFactoryInput): AgentWorkNote {
  const eventRefs = eventRefsFor(input.eventEntries, [
    "convergence_review.completed",
    "direction_handoff.completed",
    "user_approval.requested",
  ]);
  const completed = hasEvent(input.eventEntries, "direction_handoff.completed") || hasEvent(input.eventEntries, "user_approval.requested");
  const convergenceReady = hasEvent(input.eventEntries, "convergence_review.completed");
  const pkg = input.summary?.directionPackage;
  const trace = extractReasoningTraceFromModelCalls(input.modelCalls, "underground.handoff_narrative.v1");
  return note({
    input,
    noteId: "handoff-steward",
    agentId: "underground-handoff-steward",
    agentLabel: "Plan Steward",
    stage: "direction_handoff",
    status: completed ? "completed" : convergenceReady ? "running" : "pending",
    summary: pkg === undefined ? "等待收束评审完成后整理结果材料。" : `方案材料 ${pkg.id} v${pkg.version}，状态 ${pkg.status}。`,
    detail: "Plan Steward 只组装已收束候选；本面板不进入 Aboveground、Fruits 或 Governance。",
    eventRefs,
    candidateRefs: input.candidateRefs,
    reasoningTrace: trace,
  });
}

type NoteFactoryInput = Omit<PanelWorkNotesInput, "desktopChatOnly"> & {
  readonly candidateRefs: readonly string[];
};

function note(input: {
  readonly input: NoteFactoryInput;
  readonly noteId: string;
  readonly agentId: string;
  readonly agentLabel: string;
  readonly stage: string;
  readonly status: AgentWorkNote["status"];
  readonly summary: string;
  readonly detail: string;
  readonly eventRefs: readonly string[];
  readonly evidenceRefs?: readonly string[];
  readonly candidateRefs?: readonly string[];
  readonly modelCallRefs?: readonly string[];
  readonly reasoningTrace?: AgentWorkNote["reasoningTrace"];
}): AgentWorkNote {
  return {
    noteId: `${input.input.runId}:${input.noteId}`,
    agentId: input.agentId,
    agentLabel: input.agentLabel,
    stage: input.stage,
    status: input.status,
    summary: input.summary,
    detail: input.detail,
    evidenceRefs: input.evidenceRefs ?? [],
    eventRefs: input.eventRefs,
    candidateRefs: input.candidateRefs ?? [],
    modelCallRefs: input.modelCallRefs ?? [],
    reasoningTrace: input.reasoningTrace,
    createdAt: lastRecordedAt(input.input.eventEntries, input.eventRefs) ?? input.input.createdAt,
  };
}

function candidateRefsFromObservation(observation: Pick<RunObservationSnapshot, "underground"> | undefined): string[] {
  return observation?.underground.candidatePool.candidates.map((candidate) => candidate.id) ?? [];
}

function rootletKindsFor(input: NoteFactoryInput): readonly RootletClusterKind[] {
  const fromSummary = input.summary?.underground.rootletKinds;
  if (fromSummary !== undefined && fromSummary.length > 0) {
    return fromSummary;
  }
  const fromCalls = unique(input.modelCalls.map((call) => call.rootletKind).filter(isRootletClusterKind));
  return fromCalls.length > 0 ? fromCalls : ROOTLET_CLUSTER_KINDS;
}

function isRootletClusterKind(value: string | undefined): value is RootletClusterKind {
  return (
    value === "option" ||
    value === "risk" ||
    value === "asset_fit" ||
    value === "evidence" ||
    value === "constraint" ||
    value === "counterfactual"
  );
}

function extractReasoningTraceFromModelCalls(
  modelCalls: readonly PanelTranscriptModelCall[],
  contractId: string,
): AgentWorkNote["reasoningTrace"] {
  const matchingCall = modelCalls.find((call) =>
    call.outputContractId === contractId || call.visibleOutput?.contractId === contractId
  );
  if (matchingCall === undefined) {
    return undefined;
  }
  const visibleOutput = matchingCall.visibleOutput;
  if (visibleOutput === undefined) {
    return {
      source: matchingCall.status === "completed" ? "ai" : "deterministic_fallback",
    };
  }
  const fields = visibleOutput.items?.[0]?.fields ?? [];
  const getField = (name: string): string | undefined =>
    fields.find((field) => field.name === name)?.value?.trim() || undefined;
  const decisionSummary = getField("decisionSummary");
  const uncertainty = getField("uncertainty");
  const confidenceStr = getField("confidence");
  const confidence = confidenceStr !== undefined ? parseFloat(confidenceStr) : undefined;
  return {
    decisionSummary,
    uncertainty,
    confidence: confidence !== undefined && Number.isFinite(confidence) ? confidence : undefined,
    source: matchingCall.status === "completed" ? "ai" : "deterministic_fallback",
  };
}
