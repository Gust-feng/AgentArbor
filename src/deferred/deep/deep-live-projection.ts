import type { ParentSynthesisResult } from "../../domain/underground/agent-fabric.js";
import type {
  DeepDelegationDecision,
  DeepLivePhase,
  DeepLiveProjection,
  DeepRun,
  DeepRunStatus,
  DeepTaskBoardPhase,
  DeepTaskBoardSnapshot,
  SynthesizedConclusion,
} from "./contracts.js";
import type { DeepRunProgressEvent } from "./deep-run-executor.js";
import { mapTaskToLiveChild } from "./deep-live-child-projection.js";

export {
  withChildDetailFromRun,
  withChildParentOperation,
} from "./deep-live-child-projection.js";

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
