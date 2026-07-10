import type { ArborMessageType } from "../../../domain/common.js";
import type { SanitizedInformationAccessConfig, SanitizedModelProviderConfig } from "../../../domain/config/index.js";
import {
  createRunObservationEventViews,
  resolveRunObservationPosition,
  type RunObservationSnapshot,
} from "../../../domain/observation/index.js";
import { ROOTLET_CLUSTER_KINDS, type CandidatePoolCounts, type RootletClusterKind } from "../../../domain/underground/index.js";
import type { EventLogEntry } from "../../../kernel/events/in-memory-event-log.js";
import type { AgentRunTreeAttachment } from "../../run-read-model/agent-run-tree-attachment.js";
import type { ModelRuntimeMode } from "../../model-runtime/index.js";
import type { PanelRunSummary } from "../../panel-run-summary.js";
import { createSafeAgentRunTreeView, type SafeAgentRunTreeView } from "./panel-agent-run-tree-view.js";
import { rootletKindFromAdviceContractId } from "../transcript/panel-transcript-model-calls.js";
import { asRecord, numberOrUndefined, stringOrUndefined } from "../../run-read-model/value-utils.js";
import { hasEvent } from "./panel-run-event-utils.js";
import type { PanelRunStatus } from "./panel-run-status.js";
import type { PanelObservationReadModel, PanelRootletTrackingReadModel, PanelRunTraceReadModel, PanelRunTrackingReadModel } from "./panel-run-tracking-contracts.js";
export type { PanelObservationReadModel, PanelRootletTrackingReadModel, PanelRunTraceReadModel, PanelRunTrackingReadModel } from "./panel-run-tracking-contracts.js";

type PanelTraceRunMode = "agent" | "deep";
type PanelTraceProjection = "visible" | "runtime";

export function toPanelObservation(snapshot: RunObservationSnapshot): PanelObservationReadModel {
  return {
    traceId: snapshot.traceId,
    goalId: snapshot.goalId,
    currentPhase: snapshot.currentPhase,
    currentStage: snapshot.currentStage,
    eventCursor: snapshot.eventCursor,
    events: snapshot.events,
    underground: snapshot.underground,
    handoff: snapshot.handoff,
    aboveground: snapshot.aboveground,
  };
}

export function createPanelRunTrace(input: {
  readonly status: PanelRunStatus;
  readonly runMode: PanelTraceRunMode;
  readonly projection?: PanelTraceProjection;
  readonly eventEntries: readonly EventLogEntry[];
}): PanelRunTraceReadModel {
  const ordinaryVisibleProjection = input.runMode === "agent" && input.projection !== "runtime";
  const traceEventEntries = ordinaryVisibleProjection
    ? ordinaryAgentTraceEntries(input.eventEntries)
    : input.eventEntries;
  const events = createRunObservationEventViews(traceEventEntries);
  const lastEvent = traceEventEntries.at(-1);
  const position = resolveRunObservationPosition(traceEventEntries);
  return {
    status: input.status,
    currentPhase: ordinaryVisibleProjection
      ? ordinaryAgentPhaseFor(lastEvent?.type, input.status, position.currentPhase)
      : position.currentPhase,
    currentStage: position.currentStage,
    eventCursor: {
      eventCount: events.length,
      lastSequence: lastEvent?.sequence ?? 0,
      lastEventType: lastEvent?.type,
    },
    waitingPoint: waitingPointFor(input.status, lastEvent?.type, input.runMode),
    events,
  };
}

export function createPanelRunTracking(input: {
  readonly status: PanelRunStatus;
  readonly runMode: PanelTraceRunMode;
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly requestedMode: ModelRuntimeMode;
  readonly summary?: PanelRunSummary;
  readonly observation?: PanelObservationReadModel;
  readonly agentRunTree?: AgentRunTreeAttachment;
  readonly eventEntries: readonly EventLogEntry[];
}): PanelRunTrackingReadModel {
  const trace = createPanelRunTrace({ status: input.status, runMode: input.runMode, eventEntries: input.eventEntries });
  const deepSummary = input.runMode === "agent" ? undefined : input.summary;
  const deepObservation = input.runMode === "agent" ? undefined : input.observation;
  const deepAgentRunTree = input.runMode === "agent" ? undefined : input.agentRunTree;
  const deepEventEntries = input.runMode === "agent" ? [] : input.eventEntries;
  const rootletsByKind = createRootletTracking({
    ...input,
    summary: deepSummary,
    observation: deepObservation,
    eventEntries: deepEventEntries,
  });
  const observedCandidateCounts = countCandidateViews(deepObservation?.underground.candidatePool.candidates ?? []);
  return {
    run: {
      status: input.status,
      phase: deepObservation?.currentPhase ?? trace.currentPhase,
      stage: deepObservation?.currentStage ?? trace.currentStage,
      eventCount: deepObservation?.eventCursor.eventCount ?? trace.eventCursor.eventCount,
      lastEventType: deepObservation?.eventCursor.lastEventType ?? trace.eventCursor.lastEventType,
      waitingPoint: trace.waitingPoint,
      abovegroundStatus: deepObservation?.aboveground.status ?? "not_started",
    },
    provider: {
      requestedMode: input.requestedMode,
      defaultAiMode: input.config.defaultAiMode,
      providerKind: input.config.providerKind,
      protocolKind: input.config.protocolKind,
      baseUrl: input.config.baseUrl,
      model: input.config.model,
      secretConfigured: input.config.secretConfigured,
      status: providerStatus(input.config, input.requestedMode),
    },
    informationSources: {
      sourcePreference: input.informationAccess.sourcePreference,
      web: {
        provider: input.informationAccess.web.provider,
        providerKind: input.informationAccess.web.providerKind,
        maxResults: input.informationAccess.web.maxResults,
        secretConfigured: input.informationAccess.web.secretConfigured,
        status: input.informationAccess.web.status,
      },
      stubs: input.informationAccess.stubs,
    },
    rootletsByKind,
    modelTotals: deepSummary?.ai.eventCounts ?? countModelEvents(input.eventEntries),
    toolTotals: deepSummary?.tools.eventCounts ?? countToolEvents(input.eventEntries),
    context: {
      compaction: countContextCompactionEvents(input.eventEntries),
    },
    candidates: {
      total: deepSummary?.underground.candidateCounts ?? observedCandidateCounts,
      byKind: ROOTLET_CLUSTER_KINDS.reduce((result, kind) => {
        result[kind] = rootletsByKind[kind].candidates;
        return result;
      }, {} as Record<RootletClusterKind, CandidatePoolCounts>),
    },
    aiCandidates: {
      total: deepSummary?.ai.aiCandidateCount ?? 0,
      fallbackTotal: deepSummary?.ai.fallbackCount ?? 0,
      fallbackUsed: deepSummary?.ai.aiFallbackUsed ?? false,
    },
    autonomy: deepSummary?.underground.autonomy ?? {
      enabled: deepObservation?.underground.autonomy.enabled ?? false,
      cycleCount: deepObservation?.underground.autonomy.cycles.length ?? 0,
      latestAction: deepObservation?.underground.autonomy.latestDecision?.action,
      latestDecisionStatus: deepObservation?.underground.autonomy.latestDecision?.status,
      spawnedRootletCount: deepObservation?.underground.autonomy.latestDecision?.spawnedRootletCount ?? 0,
      stopReason: deepObservation?.underground.autonomy.stopReason,
      sourceRefs: deepObservation?.underground.autonomy.latestDecision?.sourceRefs ?? [],
      modelCallRefs: deepObservation?.underground.autonomy.latestDecision?.modelCallRefs ?? [],
    },
    agentRunTree: deepObservation?.underground.agentRunTree ?? agentRunTreeViewOrUndefined(deepAgentRunTree),
    convergence: deepSummary?.underground.convergence,
    package: packageTrackingFrom({
      summary: deepSummary,
      observation: deepObservation,
    }),
  };
}

function ordinaryAgentTraceEntries(eventEntries: readonly EventLogEntry[]): readonly EventLogEntry[] {
  return eventEntries.filter((entry) => entry.type === "goal.received" || isOrdinaryAgentRuntimeEvent(entry.type));
}

function ordinaryAgentPhaseFor(
  type: ArborMessageType | undefined,
  status: PanelRunStatus,
  fallback: RunObservationSnapshot["currentPhase"]
): RunObservationSnapshot["currentPhase"] {
  if (status === "completed") {
    return "completed";
  }
  if (status === "blocked" || status === "cancelled" || status === "failed") {
    return "verification";
  }
  if (type === undefined || type === "goal.received") {
    return "not_started";
  }
  if (isOrdinaryAgentRuntimeEvent(type)) {
    return "agent";
  }
  return fallback;
}

function isOrdinaryAgentRuntimeEvent(type: ArborMessageType): boolean {
  return type === "model.requested" ||
    type === "model.completed" ||
    type === "model.failed" ||
    type === "context.compaction.completed" ||
    type === "context.compaction.failed" ||
    type === "skill.triggered" ||
    type === "tool.requested" ||
    type === "tool.completed" ||
    type === "tool.failed" ||
    type === "user_approval.requested" ||
    type === "user_approval.received";
}

function packageTrackingFrom(input: {
  readonly summary?: PanelRunSummary;
  readonly observation?: PanelObservationReadModel;
}): PanelRunTrackingReadModel["package"] {
  if (input.summary !== undefined) {
    return {
      id: input.summary.directionPackage.id,
      version: input.summary.directionPackage.version,
      status: input.summary.directionPackage.status,
      validationPassed: input.summary.directionPackage.validation.passed,
      validationErrorCount: input.summary.directionPackage.validation.errors.length,
      validationWarningCount: input.summary.directionPackage.validation.warnings.length,
    };
  }
  const handoff = input.observation?.handoff;
  if (handoff === undefined || handoff.packageId.length === 0) {
    return undefined;
  }
  return {
    id: handoff.packageId,
    version: handoff.version,
    status: handoff.directionStatus,
    validationPassed: handoff.validationPassed,
    validationErrorCount: 0,
    validationWarningCount: 0,
  };
}

function agentRunTreeViewOrUndefined(tree: AgentRunTreeAttachment | undefined): SafeAgentRunTreeView | undefined {
  return tree === undefined ? undefined : createSafeAgentRunTreeView(tree);
}

function createRootletTracking(input: {
  readonly status: PanelRunStatus;
  readonly requestedMode: ModelRuntimeMode;
  readonly summary?: PanelRunSummary;
  readonly observation?: PanelObservationReadModel;
  readonly eventEntries: readonly EventLogEntry[];
}): Readonly<Record<RootletClusterKind, PanelRootletTrackingReadModel>> {
  const rootletAiByKind = new Map(input.summary?.ai.rootletKinds.map((item) => [item.kind, item]) ?? []);
  const clusterByKind = new Map(input.observation?.underground.rootletClusters.map((cluster) => [cluster.kind, cluster]) ?? []);
  const modelCountsByKind = countModelEventsByKind(input.eventEntries);
  const rootletsStarted = hasEvent(input.eventEntries, "rootlet_cluster.started");
  const candidatesProduced = hasEvent(input.eventEntries, "exploration_candidate.produced");

  return ROOTLET_CLUSTER_KINDS.reduce((result, kind) => {
    const ai = rootletAiByKind.get(kind);
    const cluster = clusterByKind.get(kind);
    const modelCounts = ai ?? modelCountsByKind.get(kind);
    result[kind] = {
      kind,
      clusterStatus: cluster?.status ?? (rootletsStarted ? "running" : "not_started"),
      invocationStatus: cluster?.invocationStatus ?? (rootletsStarted ? "running" : undefined),
      outputCount: cluster?.outputRefs.length ?? 0,
      model: {
        status: modelStatus(modelCounts),
        requested: modelCounts?.requested ?? 0,
        completed: modelCounts?.completed ?? 0,
        failed: modelCounts?.failed ?? 0,
      },
      candidates:
        input.observation === undefined
          ? zeroCandidateCounts()
          : countCandidateViews(input.observation.underground.candidatePool.candidatesByKind[kind]),
      aiCandidateCount: ai?.aiCandidateCount ?? 0,
      fallbackCount: ai?.fallbackCount ?? 0,
      aiFallbackUsed: ai?.aiFallbackUsed ?? false,
    };
    if (input.requestedMode === "none" && candidatesProduced && result[kind].model.status === "not_requested") {
      result[kind] = {
        ...result[kind],
        model: { ...result[kind].model, status: "not_requested" },
      };
    }
    return result;
  }, {} as Record<RootletClusterKind, PanelRootletTrackingReadModel>);
}

function providerStatus(
  config: SanitizedModelProviderConfig,
  requestedMode: ModelRuntimeMode
): PanelRunTrackingReadModel["provider"]["status"] {
  if (requestedMode === "none") {
    return "network_disabled";
  }
  if (requestedMode === "fake") {
    return "fake_provider";
  }
  const missingModel = config.model === undefined;
  const missingSecret = !config.secretConfigured;
  if (missingModel && missingSecret) {
    return "missing_model_and_secret";
  }
  if (missingModel) {
    return "missing_model";
  }
  if (missingSecret) {
    return "missing_secret";
  }
  return "ready";
}

function countCandidateViews(
  candidates: PanelObservationReadModel["underground"]["candidatePool"]["candidates"]
): CandidatePoolCounts {
  const counts: CandidatePoolCounts = {
    ...zeroCandidateCounts(),
    total: candidates.length,
  };
  for (const candidate of candidates) {
    if (
      candidate.status === "candidate" ||
      candidate.status === "accepted" ||
      candidate.status === "merged" ||
      candidate.status === "rejected" ||
      candidate.status === "unknown"
    ) {
      counts[candidate.status] += 1;
    }
  }
  return counts;
}

function countModelEvents(eventEntries: readonly EventLogEntry[]): PanelRunTrackingReadModel["modelTotals"] {
  return {
    requested: eventEntries.filter((entry) => entry.type === "model.requested").length,
    completed: eventEntries.filter((entry) => entry.type === "model.completed").length,
    failed: eventEntries.filter((entry) => entry.type === "model.failed").length,
  };
}

function countToolEvents(eventEntries: readonly EventLogEntry[]): PanelRunTrackingReadModel["toolTotals"] {
  return {
    requested: eventEntries.filter((entry) => entry.type === "tool.requested").length,
    completed: eventEntries.filter((entry) => entry.type === "tool.completed").length,
    failed: eventEntries.filter((entry) => entry.type === "tool.failed").length,
  };
}

function countContextCompactionEvents(
  eventEntries: readonly EventLogEntry[]
): PanelRunTrackingReadModel["context"]["compaction"] {
  const events = eventEntries.filter((entry) =>
    entry.type === "context.compaction.completed" || entry.type === "context.compaction.failed"
  );
  const latest = events.at(-1);
  const latestPayload = latest === undefined ? undefined : asRecord(latest.message.payload);
  return {
    completed: events.filter((entry) => entry.type === "context.compaction.completed").length,
    failed: events.filter((entry) => entry.type === "context.compaction.failed").length,
    latest: latest === undefined || latestPayload === undefined ? undefined : {
      status: latest.type === "context.compaction.completed" ? "completed" : "failed",
      tokenCount: numberOrUndefined(latestPayload.tokenCount),
      threshold: numberOrUndefined(latestPayload.threshold),
      coveredRefCount: numberOrUndefined(latestPayload.coveredRefCount),
      summary: stringOrUndefined(latestPayload.summary),
    },
  };
}

function countModelEventsByKind(
  eventEntries: readonly EventLogEntry[]
): ReadonlyMap<RootletClusterKind, { kind: RootletClusterKind; requested: number; completed: number; failed: number }> {
  const result = new Map<RootletClusterKind, { kind: RootletClusterKind; requested: number; completed: number; failed: number }>();
  const kindByRequestId = new Map<string, RootletClusterKind>();
  for (const entry of eventEntries) {
    const payload = asRecord(entry.message.payload);
    const requestId = stringOrUndefined(payload.requestId);
    if (requestId === undefined) {
      continue;
    }
    if (entry.type === "model.requested") {
      const outputContract = asRecord(payload.outputContract);
      const kind = rootletKindFromAdviceContractId(stringOrUndefined(outputContract.contractId));
      if (kind !== undefined) {
        kindByRequestId.set(requestId, kind);
      }
    }
    const kind = kindByRequestId.get(requestId);
    if (kind === undefined || (entry.type !== "model.requested" && entry.type !== "model.completed" && entry.type !== "model.failed")) {
      continue;
    }
    const current = result.get(kind) ?? { kind, requested: 0, completed: 0, failed: 0 };
    if (entry.type === "model.requested") {
      current.requested += 1;
    } else if (entry.type === "model.completed") {
      current.completed += 1;
    } else {
      current.failed += 1;
    }
    result.set(kind, current);
  }
  return result;
}

function modelStatus(
  counts:
    | {
        readonly requested: number;
        readonly completed: number;
        readonly failed: number;
      }
    | undefined
): PanelRootletTrackingReadModel["model"]["status"] {
  if (counts === undefined || counts.requested === 0) {
    return "not_requested";
  }
  if (counts.failed > 0) {
    return "failed";
  }
  if (counts.completed >= counts.requested) {
    return "completed";
  }
  return "requested";
}

function waitingPointFor(
  status: PanelRunStatus,
  lastEventType: ArborMessageType | undefined,
  runMode: PanelTraceRunMode
): string {
  if (runMode === "agent") {
    return "";
  }
  if (status === "pending") {
    return "等待后台运行启动。";
  }
  if (status === "approval_needed") {
    return "等待你判断后继续。";
  }
  if (status === "needs_input") {
    return "等待用户补充要求。";
  }
  if (status === "cancelled") {
    return "已取消。";
  }
  if (status === "blocked") {
    return "等待你判断或补充要求。";
  }
  if (status === "failed") {
    return "未完成，请查看错误摘要。";
  }
  if (status === "completed") {
    return "已完成，报告或终态摘要已形成。";
  }
  switch (lastEventType) {
    case undefined:
      return "后台 job 已启动，等待目标进入 EventLog。";
    case "goal.received":
      return "消息和上下文已形成，等待助手继续处理。";
    case "underground.exploration_planned":
      return "Growth Governor 正在启动 rootlet 集群。";
    case "rootlet_cluster.started":
      return "Rootlet Agents 正在产出候选；AI 模式下可能正在等待模型。";
    case "model.requested":
      return "已发出模型请求，等待返回结果引用。";
    case "model.completed":
    case "model.failed":
      return "模型调用已返回，Rootlet Agents 正在整理候选或 fallback。";
    case "context.compaction.completed":
      return "较早上下文已整理，助手将继续处理当前任务。";
    case "context.compaction.failed":
      return "上下文整理没有成功，已暂停等待继续处理。";
    case "tool.requested":
      return "已发出工具调用，等待工具返回结果引用。";
    case "tool.completed":
    case "tool.failed":
      return "工具调用已返回，模型将基于工具结果继续生成候选。";
    case "agent.delegation.planned":
      return "已形成分工计划，等待局部检查启动。";
    case "agent.child.started":
    case "agent.child.waiting":
      return "正在等待局部检查返回材料。";
    case "agent.child.completed":
      return "局部材料已返回，等待综合判断。";
    case "agent.parent_synthesis.completed":
      return "局部材料已综合，等待最终报告或下一步决策。";
    case "exploration_candidate.produced":
      return "候选已产出，等待候选池更新。";
    case "candidate_pool.updated":
      return "候选池已更新，等待 Autonomy Core 自治评审或 Convergence Judge 收束。";
    case "autonomy_review.completed":
      return "自治评审已完成，等待继续探索、请求收束或进入终态。";
    case "convergence_review.requested":
      return "自治核心已请求收束，等待 Convergence Judge 生成收束报告。";
    case "convergence_review.completed":
      return "收束评审已完成，等待整理结果材料。";
    default:
      return "运行正在推进。";
  }
}

function zeroCandidateCounts(): CandidatePoolCounts {
  return {
    total: 0,
    candidate: 0,
    accepted: 0,
    merged: 0,
    rejected: 0,
    unknown: 0,
  };
}
