import type { ArborMessageType } from "../domain/common.js";
import type { SanitizedInformationAccessConfig, SanitizedModelProviderConfig } from "../domain/config/index.js";
import type { ModelVisibleOutputProjection } from "../domain/intelligence/index.js";
import {
  createRunObservationEventViews,
  resolveRunObservationPosition,
  type RunObservationEventEntry,
  type RunObservationEventView,
  type RunObservationSnapshot,
} from "../domain/observation/index.js";
import { ROOTLET_CLUSTER_KINDS, type CandidatePoolCounts, type RootletClusterKind } from "../domain/underground/index.js";
import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";
import type { UndergroundAiMode } from "./intelligence-channel-factory.js";
import type { UndergroundDemoSummary } from "./underground-demo-summary.js";

export type PanelRunStatus = "pending" | "running" | "completed" | "failed";

export type PanelObservationReadModel = Pick<
  RunObservationSnapshot,
  "traceId" | "goalId" | "currentPhase" | "currentStage" | "eventCursor" | "events" | "underground" | "handoff" | "aboveground"
>;

export type PanelRunTraceReadModel = {
  readonly status: PanelRunStatus;
  readonly currentPhase: RunObservationSnapshot["currentPhase"];
  readonly currentStage: RunObservationSnapshot["currentStage"];
  readonly eventCursor: RunObservationSnapshot["eventCursor"];
  readonly waitingPoint: string;
  readonly events: readonly RunObservationEventView[];
};

export type PanelRunTrackingReadModel = {
  readonly run: {
    readonly status: PanelRunStatus;
    readonly phase: RunObservationSnapshot["currentPhase"];
    readonly stage: RunObservationSnapshot["currentStage"];
    readonly eventCount: number;
    readonly lastEventType?: string;
    readonly waitingPoint: string;
    readonly abovegroundStatus: RunObservationSnapshot["aboveground"]["status"];
  };
  readonly provider: {
    readonly requestedMode: UndergroundAiMode;
    readonly defaultAiMode: SanitizedModelProviderConfig["defaultAiMode"];
    readonly providerKind: SanitizedModelProviderConfig["providerKind"];
    readonly protocolKind: SanitizedModelProviderConfig["protocolKind"];
    readonly baseUrl: string;
    readonly model?: string;
    readonly secretConfigured: boolean;
    readonly status:
      | "network_disabled"
      | "fake_provider"
      | "ready"
      | "missing_model"
      | "missing_secret"
      | "missing_model_and_secret";
  };
  readonly informationSources: {
    readonly sourcePreference: SanitizedInformationAccessConfig["sourcePreference"];
    readonly web: {
      readonly provider: SanitizedInformationAccessConfig["web"]["provider"];
      readonly providerKind: "tavily";
      readonly maxResults: number;
      readonly secretConfigured: boolean;
      readonly status: "ready" | "no-provider" | "disabled";
    };
    readonly stubs: SanitizedInformationAccessConfig["stubs"];
  };
  readonly rootletsByKind: Readonly<Record<RootletClusterKind, PanelRootletTrackingReadModel>>;
  readonly modelTotals: {
    readonly requested: number;
    readonly completed: number;
    readonly failed: number;
  };
  readonly toolTotals: {
    readonly requested: number;
    readonly completed: number;
    readonly failed: number;
  };
  readonly candidates: {
    readonly total: CandidatePoolCounts;
    readonly byKind: Readonly<Record<RootletClusterKind, CandidatePoolCounts>>;
  };
  readonly aiCandidates: {
    readonly total: number;
    readonly fallbackTotal: number;
    readonly fallbackUsed: boolean;
  };
  readonly autonomy: {
    readonly enabled: boolean;
    readonly cycleCount: number;
    readonly latestAction?: string;
    readonly latestDecisionStatus?: "completed" | "failed";
    readonly spawnedRootletCount: number;
    readonly stopReason?: string;
    readonly sourceRefs: readonly string[];
    readonly modelCallRefs: readonly string[];
  };
  readonly convergence?: UndergroundDemoSummary["underground"]["convergence"];
  readonly package?: {
    readonly id: string;
    readonly version: number;
    readonly status: string;
    readonly validationPassed: boolean;
    readonly validationErrorCount: number;
    readonly validationWarningCount: number;
  };
};

export type PanelRootletTrackingReadModel = {
  readonly kind: RootletClusterKind;
  readonly clusterStatus: string;
  readonly invocationStatus?: string;
  readonly outputCount: number;
  readonly model: {
    readonly status: "not_requested" | "requested" | "completed" | "failed";
    readonly requested: number;
    readonly completed: number;
    readonly failed: number;
  };
  readonly candidates: CandidatePoolCounts;
  readonly aiCandidateCount: number;
  readonly fallbackCount: number;
  readonly aiFallbackUsed: boolean;
};

export type AgentWorkNote = {
  readonly noteId: string;
  readonly agentId: string;
  readonly agentLabel: string;
  readonly stage: string;
  readonly status: "pending" | "running" | "completed" | "failed" | "skipped";
  readonly summary: string;
  readonly detail: string;
  readonly evidenceRefs: readonly string[];
  readonly eventRefs: readonly string[];
  readonly candidateRefs: readonly string[];
  readonly modelCallRefs: readonly string[];
  readonly reasoningTrace?: {
    readonly decisionSummary?: string;
    readonly uncertainty?: string;
    readonly confidence?: number;
    readonly source: "ai" | "deterministic_fallback" | "unknown";
  };
  readonly createdAt: string;
};

export type PanelTranscriptModelCall = {
  readonly requestId: string;
  readonly responseId?: string;
  readonly status: "requested" | "completed" | "failed";
  readonly purpose?: string;
  readonly outputContractId?: string;
  readonly rootletKind?: RootletClusterKind;
  readonly providerKind?: string;
  readonly protocolKind?: string;
  readonly model?: string;
  readonly outputKind?: string;
  readonly validationStatus?: string;
  readonly visibleOutput?: ModelVisibleOutputProjection;
  readonly candidateRefs: readonly string[];
  readonly eventRefs: readonly string[];
};

export type PanelRunStreamEventType =
  | "run.started"
  | "agent.note.delta"
  | "agent.note.completed"
  | "model.output.delta"
  | "model.output.completed"
  | "tool.requested"
  | "tool.completed"
  | "tool.failed"
  | "final.result"
  | "run.failed";

export type PanelRunStreamEvent = {
  readonly eventId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: PanelRunStreamEventType;
  readonly createdAt: string;
  readonly agentLabel?: string;
  readonly summary?: string;
  readonly delta?: string;
  readonly status?: "pending" | "running" | "completed" | "failed";
  readonly toolName?: string;
  readonly sourceRefs: readonly string[];
  readonly modelCallRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
};

export type PanelRunStreamCursor = {
  readonly runId: string;
  readonly lastSequence: number;
};

export type PanelRunTranscript = {
  readonly runId: string;
  readonly status: PanelRunStatus;
  readonly updatedAt: string;
  readonly events: readonly PanelRunStreamEvent[];
  readonly workNotes: readonly AgentWorkNote[];
  readonly modelCalls: readonly PanelTranscriptModelCall[];
};

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
  readonly eventEntries: readonly EventLogEntry[];
}): PanelRunTraceReadModel {
  const events = createRunObservationEventViews(input.eventEntries);
  const lastEvent = input.eventEntries.at(-1);
  const position = resolveRunObservationPosition(input.eventEntries);
  return {
    status: input.status,
    currentPhase: position.currentPhase,
    currentStage: position.currentStage,
    eventCursor: {
      eventCount: events.length,
      lastSequence: lastEvent?.sequence ?? 0,
      lastEventType: lastEvent?.type,
    },
    waitingPoint: waitingPointFor(input.status, lastEvent?.type),
    events,
  };
}

export function createPanelRunTracking(input: {
  readonly status: PanelRunStatus;
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly requestedMode: UndergroundAiMode;
  readonly summary?: UndergroundDemoSummary;
  readonly observation?: PanelObservationReadModel;
  readonly eventEntries: readonly EventLogEntry[];
}): PanelRunTrackingReadModel {
  const trace = createPanelRunTrace({ status: input.status, eventEntries: input.eventEntries });
  const rootletsByKind = createRootletTracking(input);
  return {
    run: {
      status: input.status,
      phase: input.observation?.currentPhase ?? trace.currentPhase,
      stage: input.observation?.currentStage ?? trace.currentStage,
      eventCount: input.observation?.eventCursor.eventCount ?? trace.eventCursor.eventCount,
      lastEventType: input.observation?.eventCursor.lastEventType ?? trace.eventCursor.lastEventType,
      waitingPoint: trace.waitingPoint,
      abovegroundStatus: input.observation?.aboveground.status ?? "not_started",
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
    modelTotals: input.summary?.ai.eventCounts ?? countModelEvents(input.eventEntries),
    toolTotals: input.summary?.tools.eventCounts ?? countToolEvents(input.eventEntries),
    candidates: {
      total: input.summary?.underground.candidateCounts ?? zeroCandidateCounts(),
      byKind: ROOTLET_CLUSTER_KINDS.reduce((result, kind) => {
        result[kind] = rootletsByKind[kind].candidates;
        return result;
      }, {} as Record<RootletClusterKind, CandidatePoolCounts>),
    },
    aiCandidates: {
      total: input.summary?.ai.aiCandidateCount ?? 0,
      fallbackTotal: input.summary?.ai.fallbackCount ?? 0,
      fallbackUsed: input.summary?.ai.aiFallbackUsed ?? false,
    },
    autonomy: input.summary?.underground.autonomy ?? {
      enabled: input.observation?.underground.autonomy.enabled ?? false,
      cycleCount: input.observation?.underground.autonomy.cycles.length ?? 0,
      latestAction: input.observation?.underground.autonomy.latestDecision?.action,
      latestDecisionStatus: input.observation?.underground.autonomy.latestDecision?.status,
      spawnedRootletCount: input.observation?.underground.autonomy.latestDecision?.spawnedRootletCount ?? 0,
      stopReason: input.observation?.underground.autonomy.stopReason,
      sourceRefs: input.observation?.underground.autonomy.latestDecision?.sourceRefs ?? [],
      modelCallRefs: input.observation?.underground.autonomy.latestDecision?.modelCallRefs ?? [],
    },
    convergence: input.summary?.underground.convergence,
    package:
      input.summary === undefined
        ? undefined
        : {
            id: input.summary.directionPackage.id,
            version: input.summary.directionPackage.version,
            status: input.summary.directionPackage.status,
            validationPassed: input.summary.directionPackage.validation.passed,
            validationErrorCount: input.summary.directionPackage.validation.errors.length,
            validationWarningCount: input.summary.directionPackage.validation.warnings.length,
          },
  };
}

export function createPanelRunTranscript(input: {
  readonly runId: string;
  readonly status: PanelRunStatus;
  readonly eventEntries: readonly EventLogEntry[];
  readonly summary?: UndergroundDemoSummary;
  readonly observation?: PanelObservationReadModel;
  readonly createdAt: string;
  readonly updatedAt: string;
}): PanelRunTranscript {
  const modelCalls = createPanelTranscriptModelCalls(input.eventEntries, input.summary);
  const streamEvents = createPanelRunStreamEvents({
    runId: input.runId,
    status: input.status,
    eventEntries: input.eventEntries,
    summary: input.summary,
    observation: input.observation,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  });
  const candidateRefs = candidateRefsFromObservation(input.observation);
  const noteInput = { ...input, modelCalls, candidateRefs };
  return {
    runId: input.runId,
    status: input.status,
    updatedAt: input.updatedAt,
    events: streamEvents,
    workNotes: [
      createIntentCoreNote(noteInput),
      createGrowthGovernorNote(noteInput),
      createRootletAgentsNote(noteInput),
      createModelCallsNote(noteInput),
      createAutonomyCoreNote(noteInput),
      createConvergenceJudgeNote(noteInput),
      createHandoffStewardNote(noteInput),
    ],
    modelCalls,
  };
}

export function createPanelRunStreamEvents(input: {
  readonly runId: string;
  readonly status: PanelRunStatus;
  readonly eventEntries: readonly EventLogEntry[];
  readonly summary?: UndergroundDemoSummary | { readonly ai: UndergroundDemoSummary["ai"] };
  readonly observation?: PanelObservationReadModel;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly error?: { readonly code: string; readonly message: string };
}): readonly PanelRunStreamEvent[] {
  const events: PanelRunStreamEvent[] = [];
  const observationViews = createRunObservationEventViews(input.eventEntries);
  const viewBySequence = new Map(observationViews.map((view) => [view.sequence, view]));
  const push = (event: Omit<PanelRunStreamEvent, "sequence">): void => {
    events.push({ ...event, sequence: events.length + 1 });
  };

  push({
    eventId: `${input.runId}:run.started`,
    runId: input.runId,
    type: "run.started",
    createdAt: input.createdAt,
    agentLabel: "地下组织",
    summary: "目标已提交，地下组织准备开始工作。",
    status: input.status === "pending" ? "pending" : "running",
    sourceRefs: [],
    modelCallRefs: [],
    toolCallRefs: [],
  });

  for (const entry of input.eventEntries) {
    const view = viewBySequence.get(entry.sequence);
    appendStreamEventsForEvent({
      runId: input.runId,
      entry,
      view,
      push,
    });
  }

  if (input.status === "completed") {
    const finalSummary = finalResultSummary(input);
    push({
      eventId: `${input.runId}:final.result`,
      runId: input.runId,
      type: "final.result",
      createdAt: input.updatedAt,
      agentLabel: "地下组织",
      summary: finalSummary,
      status: "completed",
      sourceRefs: finalSourceRefs(input),
      modelCallRefs: [],
      toolCallRefs: [],
    });
  }

  if (input.status === "failed") {
    push({
      eventId: `${input.runId}:run.failed`,
      runId: input.runId,
      type: "run.failed",
      createdAt: input.updatedAt,
      agentLabel: "地下组织",
      summary: input.error?.message ?? "地下运行失败。",
      status: "failed",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: [],
    });
  }

  return events;
}

function appendStreamEventsForEvent(input: {
  readonly runId: string;
  readonly entry: EventLogEntry;
  readonly view?: RunObservationEventView;
  readonly push: (event: Omit<PanelRunStreamEvent, "sequence">) => void;
}): void {
  const payload = asRecord(input.entry.message.payload);
  const base = {
    runId: input.runId,
    createdAt: input.entry.recordedAt,
    sourceRefs: sourceRefsForView(input.view),
    modelCallRefs: modelCallRefsFor(input.entry, payload),
    toolCallRefs: toolCallRefsFor(input.entry, payload),
  };

  if (input.entry.type === "model.requested") {
    input.push({
      ...base,
      eventId: `${input.runId}:event:${input.entry.sequence}:agent.note.delta`,
      type: "agent.note.delta",
      agentLabel: "模型",
      summary: modelRequestedSummary(payload),
      status: "running",
    });
    return;
  }

  if (input.entry.type === "model.completed") {
    const text = visibleOutputText(payload.visibleOutput);
    const chunks = chunkText(text, 90);
    if (chunks.length === 0) {
      input.push({
        ...base,
        eventId: `${input.runId}:event:${input.entry.sequence}:model.output.completed`,
        type: "model.output.completed",
        agentLabel: "模型",
        summary: "模型调用完成；本次没有通过安全策略展示的可见输出。",
        status: "completed",
      });
      return;
    }
    chunks.forEach((chunk, index) => {
      input.push({
        ...base,
        eventId: `${input.runId}:event:${input.entry.sequence}:model.output.delta:${index + 1}`,
        type: "model.output.delta",
        agentLabel: "模型",
        delta: chunk,
        status: "running",
      });
    });
    input.push({
      ...base,
      eventId: `${input.runId}:event:${input.entry.sequence}:model.output.completed`,
      type: "model.output.completed",
      agentLabel: "模型",
      summary: modelCompletedSummary(payload, chunks.length),
      status: "completed",
    });
    return;
  }

  if (input.entry.type === "model.failed") {
    input.push({
      ...base,
      eventId: `${input.runId}:event:${input.entry.sequence}:agent.note.completed`,
      type: "agent.note.completed",
      agentLabel: "模型",
      summary: modelFailedSummary(payload),
      status: "failed",
    });
    return;
  }

  if (input.entry.type === "tool.requested" || input.entry.type === "tool.completed" || input.entry.type === "tool.failed") {
    input.push({
      ...base,
      eventId: `${input.runId}:event:${input.entry.sequence}:${input.entry.type}`,
      type: input.entry.type,
      agentLabel: "工具",
      toolName: stringOrUndefined(payload.toolName),
      summary: toolSummary(input.entry.type, payload),
      status: input.entry.type === "tool.requested" ? "running" : input.entry.type === "tool.completed" ? "completed" : "failed",
    });
    return;
  }

  const note = agentNoteForEvent(input.entry, payload);
  if (note !== undefined) {
    input.push({
      ...base,
      eventId: `${input.runId}:event:${input.entry.sequence}:agent.note.completed`,
      type: "agent.note.completed",
      agentLabel: note.agentLabel,
      summary: note.summary,
      status: note.status,
    });
  }
}

function sourceRefsForView(view: RunObservationEventView | undefined): readonly string[] {
  return (
    view?.refs
      .filter((ref) => ref.kind !== "model_call" && ref.kind !== "tool_call")
      .map((ref) => `${ref.kind}:${ref.id}`) ?? []
  );
}

function modelCallRefsFor(entry: EventLogEntry, payload: Readonly<Record<string, unknown>>): readonly string[] {
  if (entry.type !== "model.requested" && entry.type !== "model.completed" && entry.type !== "model.failed") {
    return [];
  }
  return unique([stringOrUndefined(payload.requestId), stringOrUndefined(payload.responseId)].filter(isString));
}

function toolCallRefsFor(entry: EventLogEntry, payload: Readonly<Record<string, unknown>>): readonly string[] {
  if (entry.type !== "tool.requested" && entry.type !== "tool.completed" && entry.type !== "tool.failed") {
    return [];
  }
  return stringOrUndefined(payload.callId) === undefined ? [] : [stringOrUndefined(payload.callId) as string];
}

function modelRequestedSummary(payload: Readonly<Record<string, unknown>>): string {
  const purpose = stringOrUndefined(payload.purpose) ?? "unknown";
  const model = stringOrUndefined(payload.model) ?? "unknown model";
  return `模型开始处理 ${purpose}，使用 ${model}。`;
}

function modelCompletedSummary(payload: Readonly<Record<string, unknown>>, chunkCount: number): string {
  const validation = stringOrUndefined(payload.validationStatus) ?? "unknown";
  const model = stringOrUndefined(payload.model) ?? "unknown model";
  return `模型输出完成，${chunkCount} 个可见增量已进入 transcript；校验 ${validation}，模型 ${model}。`;
}

function modelFailedSummary(payload: Readonly<Record<string, unknown>>): string {
  const failureKind = stringOrUndefined(payload.failureKind) ?? "model_failed";
  const retryable = payload.retryable === true ? "可重试" : "不可重试";
  return `模型调用失败：${failureKind}，${retryable}。`;
}

function toolSummary(type: "tool.requested" | "tool.completed" | "tool.failed", payload: Readonly<Record<string, unknown>>): string {
  const toolName = stringOrUndefined(payload.toolName) ?? "unknown";
  if (type === "tool.requested") {
    return `工具 ${toolName} 开始执行。`;
  }
  const duration = typeof payload.durationMs === "number" ? `，耗时 ${Math.round(payload.durationMs)}ms` : "";
  if (type === "tool.completed") {
    return `工具 ${toolName} 已完成${duration}；结果只展示安全摘要和引用。`;
  }
  return `工具 ${toolName} 调用失败${duration}；错误已脱敏。`;
}

function agentNoteForEvent(
  entry: EventLogEntry,
  payload: Readonly<Record<string, unknown>>
): { readonly agentLabel: string; readonly summary: string; readonly status: PanelRunStreamEvent["status"] } | undefined {
  switch (entry.type) {
    case "goal.received":
      return { agentLabel: "用户", summary: "目标已进入地下组织，原文不会在调试区外展开。", status: "completed" };
    case "underground.exploration_planned":
      return { agentLabel: "地下中枢", summary: "目标画像和探索计划已形成。", status: "completed" };
    case "rootlet_cluster.started":
      return { agentLabel: "Rootlet 集群", summary: "动态 rootlet 已启动，开始探索候选方向。", status: "running" };
    case "exploration_candidate.produced":
      return { agentLabel: "Rootlet 集群", summary: "Rootlet 已产出候选材料，等待进入候选池。", status: "completed" };
    case "candidate_pool.updated":
      return { agentLabel: "候选池", summary: "候选池已更新，正式事实边界仍由收束和方向交接校验掌握。", status: "completed" };
    case "autonomy_review.completed":
      return {
        agentLabel: "自治中枢",
        summary: autonomySummary(payload),
        status: "completed",
      };
    case "convergence_review.requested":
      return { agentLabel: "自治中枢", summary: "自治中枢请求进入收束评审。", status: "running" };
    case "convergence_review.completed":
      return { agentLabel: "收束判断", summary: "候选材料已由 Convergence Judge 完成正式收束。", status: "completed" };
    case "direction_handoff.requested":
      return { agentLabel: "方向交接", summary: "方向交接包开始组装。", status: "running" };
    case "direction_handoff.completed":
      return { agentLabel: "方向交接", summary: "方向交接包已通过现有校验链生成。", status: "completed" };
    case "direction_handoff.revision_requested":
      return { agentLabel: "方向交接", summary: "方向交接包需要修订或补充。", status: "running" };
    case "user_approval.requested":
      return { agentLabel: "用户确认", summary: "地下组织需要用户澄清后继续。", status: "running" };
    case "user_approval.received":
      return { agentLabel: "用户确认", summary: "用户澄清已收到，地下组织继续推进。", status: "completed" };
    default:
      return undefined;
  }
}

function autonomySummary(payload: Readonly<Record<string, unknown>>): string {
  const decision = asRecord(payload.autonomyDecision);
  const action = stringOrUndefined(decision.action) ?? stringOrUndefined(payload.action) ?? "unknown";
  return `自治评审完成，决策动作：${action}。`;
}

function visibleOutputText(value: unknown): string {
  const output = modelVisibleOutputOrUndefined(value);
  if (output === undefined) {
    return "";
  }
  const parts: string[] = [];
  for (const item of output.items) {
    for (const field of item.fields) {
      const valueText = field.value.trim();
      if (valueText.length > 0) {
        parts.push(`${field.name}: ${valueText}${field.truncated ? " (truncated)" : ""}`);
      }
    }
  }
  return parts.join("\n");
}

function chunkText(value: string, maxLength: number): readonly string[] {
  const text = value.trim();
  if (text.length === 0) {
    return [];
  }
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxLength) {
    chunks.push(text.slice(index, index + maxLength));
  }
  return chunks;
}

function finalResultSummary(input: {
  readonly summary?: UndergroundDemoSummary | { readonly ai: UndergroundDemoSummary["ai"] };
  readonly observation?: PanelObservationReadModel;
}): string {
  const summary = fullSummaryOrUndefined(input.summary);
  if (summary !== undefined) {
    return `地下运行完成，方向包 ${summary.directionPackage.id} v${summary.directionPackage.version}，状态 ${summary.directionPackage.status}。`;
  }
  const stage = input.observation?.currentStage;
  return stage === undefined ? "地下运行完成。" : `地下运行完成，当前阶段 ${stage}。`;
}

function finalSourceRefs(input: {
  readonly summary?: UndergroundDemoSummary | { readonly ai: UndergroundDemoSummary["ai"] };
  readonly observation?: PanelObservationReadModel;
}): readonly string[] {
  const summary = fullSummaryOrUndefined(input.summary);
  if (summary !== undefined) {
    return [
      `direction_package:${summary.directionPackage.id}`,
      `direction_handoff:${summary.directionPackage.directionId}`,
    ];
  }
  const handoff = input.observation?.handoff;
  return handoff === undefined || handoff.packageId.length === 0
    ? []
    : [`direction_package:${handoff.packageId}`, `direction_handoff:${handoff.directionId}`];
}

function fullSummaryOrUndefined(value: UndergroundDemoSummary | { readonly ai: UndergroundDemoSummary["ai"] } | undefined): UndergroundDemoSummary | undefined {
  return value !== undefined && "directionPackage" in value ? value : undefined;
}

function createRootletTracking(input: {
  readonly status: PanelRunStatus;
  readonly requestedMode: UndergroundAiMode;
  readonly summary?: UndergroundDemoSummary;
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

function createPanelTranscriptModelCalls(
  eventEntries: readonly EventLogEntry[],
  summary: UndergroundDemoSummary | undefined
): readonly PanelTranscriptModelCall[] {
  const calls = new Map<string, PanelTranscriptModelCall>();
  const summaryCalls = new Map(summary?.ai.modelCallRefs.map((call) => [call.requestId, call]) ?? []);

  for (const entry of eventEntries) {
    if (entry.type !== "model.requested" && entry.type !== "model.completed" && entry.type !== "model.failed") {
      continue;
    }
    const payload = asRecord(entry.message.payload);
    const requestId = stringOrUndefined(payload.requestId);
    if (requestId === undefined) {
      continue;
    }
    const existing = calls.get(requestId);
    const summaryCall = summaryCalls.get(requestId);
    const outputContract = asRecord(payload.outputContract);
    const next: PanelTranscriptModelCall = {
      requestId,
      responseId: stringOrUndefined(payload.responseId) ?? existing?.responseId ?? summaryCall?.responseId,
      status: entry.type === "model.failed" ? "failed" : entry.type === "model.completed" ? "completed" : existing?.status ?? "requested",
      purpose: stringOrUndefined(payload.purpose) ?? existing?.purpose,
      outputContractId:
        stringOrUndefined(outputContract.contractId) ??
        existing?.outputContractId ??
        summaryCall?.visibleOutput?.contractId,
      rootletKind:
        summaryCall?.rootletKind ??
        existing?.rootletKind ??
        rootletKindFromAdviceContractId(stringOrUndefined(outputContract.contractId)),
      providerKind: stringOrUndefined(payload.providerKind) ?? existing?.providerKind ?? summaryCall?.providerKind,
      protocolKind: stringOrUndefined(payload.protocolKind) ?? existing?.protocolKind ?? summaryCall?.protocolKind,
      model: stringOrUndefined(payload.model) ?? existing?.model ?? summaryCall?.model,
      outputKind: stringOrUndefined(payload.outputKind) ?? existing?.outputKind ?? summaryCall?.outputKind,
      validationStatus: stringOrUndefined(payload.validationStatus) ?? existing?.validationStatus ?? summaryCall?.validationStatus,
      visibleOutput:
        modelVisibleOutputOrUndefined(payload.visibleOutput) ?? existing?.visibleOutput ?? summaryCall?.visibleOutput,
      candidateRefs: summaryCall?.candidateRefs ?? existing?.candidateRefs ?? [],
      eventRefs: unique([...(existing?.eventRefs ?? []), entry.message.id]),
    };
    calls.set(requestId, next);
  }

  return [...calls.values()];
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
    summary: planned ? "目标画像已成形，地下探索计划已发布。" : received ? "目标已进入地下中枢，正在形成目标画像。" : "等待目标进入地下中枢。",
    detail: "工作笔记只记录目标接收和画像成形状态，不展示隐藏推理链或完整用户输入。",
    eventRefs,
    reasoningTrace: trace,
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
    detail: "该笔记只展示调度状态和 rootlet kind 计划，不写入 Growth Plan 或地上执行计划。",
    eventRefs,
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
        ? "自治核心只决定继续探索、请求收束、请求用户澄清或停止，不直接批准方向包。"
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
        ? "收束前不会把 rootlet output 直接交给方向包。"
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
    agentLabel: "Handoff Steward",
    stage: "direction_handoff",
    status: completed ? "completed" : convergenceReady ? "running" : "pending",
    summary: pkg === undefined ? "等待收束评审完成后组装方向交接包。" : `方向包 ${pkg.id} v${pkg.version}，状态 ${pkg.status}。`,
    detail: "Handoff Steward 只组装已收束候选；本面板不进入 Aboveground、Fruits 或 Governance。",
    eventRefs,
    candidateRefs: input.candidateRefs,
    reasoningTrace: trace,
  });
}

type NoteFactoryInput = {
  readonly runId: string;
  readonly status: PanelRunStatus;
  readonly eventEntries: readonly EventLogEntry[];
  readonly summary?: UndergroundDemoSummary;
  readonly observation?: PanelObservationReadModel;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly modelCalls: readonly PanelTranscriptModelCall[];
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

function providerStatus(
  config: SanitizedModelProviderConfig,
  requestedMode: UndergroundAiMode
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

function waitingPointFor(status: PanelRunStatus, lastEventType: ArborMessageType | undefined): string {
  if (status === "pending") {
    return "等待后台地下运行启动。";
  }
  if (status === "failed") {
    return "运行失败，查看错误摘要。";
  }
  if (status === "completed") {
    return "地下运行完成，方向交接包已形成或进入地下终态。";
  }
  switch (lastEventType) {
    case undefined:
      return "后台 job 已启动，等待目标进入 EventLog。";
    case "goal.received":
      return "Intent Core 正在形成目标画像和探索计划。";
    case "underground.exploration_planned":
      return "Growth Governor 正在启动 rootlet 集群。";
    case "rootlet_cluster.started":
      return "Rootlet Agents 正在产出候选；AI 模式下可能正在等待模型。";
    case "model.requested":
      return "已发出模型请求，等待 provider 返回脱敏结果引用。";
    case "model.completed":
    case "model.failed":
      return "模型调用已返回，Rootlet Agents 正在整理候选或 fallback。";
    case "tool.requested":
      return "已发出工具调用，等待工具返回脱敏结果引用。";
    case "tool.completed":
    case "tool.failed":
      return "工具调用已返回，模型将基于工具结果继续生成候选。";
    case "exploration_candidate.produced":
      return "候选已产出，等待候选池更新。";
    case "candidate_pool.updated":
      return "候选池已更新，等待 Autonomy Core 自治评审或 Convergence Judge 收束。";
    case "autonomy_review.completed":
      return "自治评审已完成，等待继续探索、请求收束或进入地下终态。";
    case "convergence_review.requested":
      return "自治核心已请求收束，等待 Convergence Judge 生成收束报告。";
    case "convergence_review.completed":
      return "收束评审已完成，等待 Handoff Steward 组装方向包。";
    default:
      return "地下运行正在推进。";
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

function eventRefsFor(eventEntries: readonly EventLogEntry[], types: readonly ArborMessageType[]): string[] {
  const typeSet = new Set(types);
  return eventEntries.filter((entry) => typeSet.has(entry.type)).map((entry) => entry.message.id);
}

function hasEvent(eventEntries: readonly EventLogEntry[], type: ArborMessageType): boolean {
  return eventEntries.some((entry) => entry.type === type);
}

function candidateRefsFromObservation(observation: PanelObservationReadModel | undefined): string[] {
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

function lastRecordedAt(eventEntries: readonly EventLogEntry[], eventRefs: readonly string[]): string | undefined {
  const refSet = new Set(eventRefs);
  return eventEntries.filter((entry) => refSet.has(entry.message.id)).at(-1)?.recordedAt;
}

function rootletKindFromAdviceContractId(contractId: string | undefined): RootletClusterKind | undefined {
  if (contractId === undefined) {
    return undefined;
  }
  const prefix = "underground.rootlet_candidate_advice.";
  if (!contractId.startsWith(prefix)) {
    return undefined;
  }
  const kind = contractId.slice(prefix.length).split(".")[0];
  return isRootletClusterKind(kind) ? kind : undefined;
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

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function modelVisibleOutputOrUndefined(value: unknown): ModelVisibleOutputProjection | undefined {
  const record = asRecord(value);
  if (
    typeof record.contractId !== "string" ||
    typeof record.outputKind !== "string" ||
    (record.source !== "structured_output" && record.source !== "text_output") ||
    record.validationStatus !== "passed" ||
    !Array.isArray(record.items)
  ) {
    return undefined;
  }
  return record as unknown as ModelVisibleOutputProjection;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
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
    fields.find((f) => f.name === name)?.value?.trim() || undefined;
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
