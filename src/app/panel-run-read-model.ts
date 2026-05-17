import type { ArborMessageType } from "../domain/common.js";
import type { SanitizedInformationAccessConfig, SanitizedModelProviderConfig } from "../domain/config/index.js";
import type { ModelVisibleOutputProjection } from "../domain/intelligence/index.js";
import type { ToolDisplayProjection, ToolResultEnvelope } from "../domain/tools/index.js";
import { toolDisplayName } from "../domain/tools/index.js";
import type { AgentRunTree } from "../domain/underground/index.js";
import {
  createRunObservationEventViews,
  resolveRunObservationPosition,
  type RunObservationEventEntry,
  type RunObservationEventView,
  type RunObservationSnapshot,
} from "../domain/observation/index.js";
import { ROOTLET_CLUSTER_KINDS, type CandidatePoolCounts, type RootletClusterKind } from "../domain/underground/index.js";
import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";
import { redactSensitiveText } from "../kernel/redaction.js";
import type { UndergroundAiMode } from "./intelligence-channel-factory.js";
import { explainDesktopIntentDecision, type DesktopIntentDecision } from "./desktop-intent-router.js";
import { createSafeAgentRunTreeView, type SafeAgentRunTreeView } from "./panel-canvas-read-model.js";
import { safeCommandToolPreview, safeReadFileToolPreview } from "./safe-tool-preview.js";
import type { UndergroundDemoSummary } from "./underground-demo-summary.js";
import { friendlyUserFacingFailureText } from "./visible-text-safety.js";

export type PanelRunStatus =
  | "pending"
  | "running"
  | "approval_needed"
  | "needs_input"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

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
  readonly context: {
    readonly compaction: {
      readonly completed: number;
      readonly failed: number;
      readonly latest?: {
        readonly status: "completed" | "failed";
        readonly tokenCount?: number;
        readonly threshold?: number;
        readonly coveredRefCount?: number;
        readonly summary?: string;
      };
    };
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
  readonly agentRunTree?: NonNullable<PanelObservationReadModel["underground"]["agentRunTree"]>;
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
  readonly failureKind?: string;
  readonly retryable?: boolean;
  readonly sanitizedErrorRef?: string;
  readonly visibleOutput?: ModelVisibleOutputProjection;
  readonly candidateRefs: readonly string[];
  readonly eventRefs: readonly string[];
};

export type PanelRunStreamEventType =
  | "run.started"
  | "run.cancelled"
  | "run.blocked"
  | "run.resumed"
  | "agent.note.delta"
  | "agent.note.completed"
  | "model.output.delta"
  | "model.output.completed"
  | "context.compaction.completed"
  | "context.compaction.failed"
  | "tool.requested"
  | "tool.completed"
  | "tool.failed"
  | "confirmation.needed"
  | "user_approval.received"
  | "user.guidance"
  | "agent.delegation.planned"
  | "agent.child.started"
  | "agent.child.completed"
  | "agent.child.waiting"
  | "agent.parent_synthesis.completed"
  | "final.result"
  | "run.failed";

export type PanelRunStreamEventDetail = {
  readonly kind: "thinking" | "tool" | "confirmation" | "work";
  readonly action?: string;
  readonly path?: string;
  readonly query?: string;
  readonly command?: string;
  readonly exitCode?: number;
  readonly preview?: string;
  readonly display?: ToolDisplayProjection;
  readonly envelope?: ToolResultEnvelope;
  readonly truncated?: boolean;
  readonly error?: string;
};

export type PanelRunStepToolItem = {
  readonly toolName?: string;
  readonly title: string;
  readonly target?: string;
  readonly preview?: string;
  readonly display?: ToolDisplayProjection;
  readonly exitCode?: number;
  readonly truncated?: boolean;
  readonly error?: string;
  readonly status: "running" | "completed" | "failed";
};

export type PanelRunStep = {
  readonly stepId: string;
  readonly stepNumber: number;
  readonly toolCalls: readonly PanelRunStepToolItem[];
  readonly status: "running" | "completed" | "failed";
};

export type PanelRunStreamEvent = {
  readonly eventId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: PanelRunStreamEventType;
  readonly createdAt: string;
  readonly agentLabel?: string;
  readonly summary?: string;
  readonly delta?: string;
  readonly status?: "pending" | "running" | "approval_needed" | "needs_input" | "completed" | "failed" | "cancelled" | "blocked";
  readonly toolName?: string;
  readonly detail?: PanelRunStreamEventDetail;
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
  readonly steps: readonly PanelRunStep[];
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
  readonly agentRunTree?: AgentRunTree;
  readonly eventEntries: readonly EventLogEntry[];
}): PanelRunTrackingReadModel {
  const trace = createPanelRunTrace({ status: input.status, eventEntries: input.eventEntries });
  const rootletsByKind = createRootletTracking(input);
  const observedCandidateCounts = countCandidateViews(input.observation?.underground.candidatePool.candidates ?? []);
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
    context: {
      compaction: countContextCompactionEvents(input.eventEntries),
    },
    candidates: {
      total: input.summary?.underground.candidateCounts ?? observedCandidateCounts,
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
    agentRunTree: input.observation?.underground.agentRunTree ?? agentRunTreeViewOrUndefined(input.agentRunTree),
    convergence: input.summary?.underground.convergence,
    package: packageTrackingFrom(input),
  };
}

function packageTrackingFrom(input: {
  readonly summary?: UndergroundDemoSummary;
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

export function deriveRunSteps(
  streamEvents: readonly PanelRunStreamEvent[]
): readonly PanelRunStep[] {
  const steps: PanelRunStep[] = [];
  let currentToolCalls: PanelRunStepToolItem[] = [];
  let stepNumber = 0;

  for (const event of streamEvents) {
    if (
      event.type === "agent.note.delta" ||
      event.type === "agent.note.completed" ||
      event.type === "agent.child.started" ||
      event.type === "agent.delegation.planned"
    ) {
      if (currentToolCalls.length > 0) {
        stepNumber += 1;
        steps.push({
          stepId: `${event.runId}:step:${stepNumber}`,
          stepNumber,
          toolCalls: currentToolCalls,
          status: currentToolCalls.some((tc) => tc.status === "failed") ? "failed" : "completed",
        });
        currentToolCalls = [];
      }
    }

    if (
      event.type === "tool.requested" ||
      event.type === "tool.completed" ||
      event.type === "tool.failed"
    ) {
      const status: "running" | "completed" | "failed" =
        event.type === "tool.failed" ? "failed" :
        event.type === "tool.completed" ? "completed" :
        "running";

      const target = event.detail?.path ?? event.detail?.query ?? event.detail?.command;

      currentToolCalls.push({
        toolName: event.toolName,
        title: event.summary ?? (event.toolName === undefined ? "工具调用" : toolDisplayName(event.toolName)),
        target,
        preview: event.detail?.preview,
        display: event.detail?.display,
        exitCode: event.detail?.exitCode,
        truncated: event.detail?.truncated,
        error: event.detail?.error,
        status,
      });
    }
  }

  if (currentToolCalls.length > 0) {
    stepNumber += 1;
    steps.push({
      stepId: `${streamEvents[0]?.runId ?? "unknown"}:step:${stepNumber}`,
      stepNumber,
      toolCalls: currentToolCalls,
      status: currentToolCalls.some((tc) => tc.status === "failed") ? "failed" : "completed",
    });
  }

  return steps;
}

export function createPanelRunTranscript(input: {
  readonly runId: string;
  readonly status: PanelRunStatus;
  readonly eventEntries: readonly EventLogEntry[];
  readonly summary?: UndergroundDemoSummary;
  readonly observation?: PanelObservationReadModel;
  readonly agentRunTree?: AgentRunTree;
  readonly routeDecision?: DesktopIntentDecision;
  readonly desktopMode?: "agent" | "deep";
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
    routeDecision: input.routeDecision,
    desktopMode: input.desktopMode,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  });
  const candidateRefs = candidateRefsFromObservation(input.observation);
  const isDesktopChatOnly =
    input.summary === undefined &&
    input.observation === undefined &&
    input.agentRunTree === undefined &&
    modelCalls.length > 0 &&
    modelCalls.every((call) =>
      call.outputContractId === "desktop.agent_response.v1" ||
      call.outputContractId === "desktop.chat_response.v1" ||
      call.outputContractId === "desktop.intent_gate.v1" ||
      call.purpose === "desktop_agent" ||
      call.purpose === "desktop_chat" ||
      call.purpose === "desktop_intent_gate"
    );
  const noteInput = {
    ...input,
    modelCalls,
    candidateRefs,
    agentRunTree: agentRunTreeViewOrUndefined(input.agentRunTree),
  };
  const workNotes =
    input.summary === undefined && input.observation === undefined
      ? isDesktopChatOnly
        ? [
            createDesktopChatNote(noteInput),
            createModelCallsNote(noteInput),
          ]
        : input.agentRunTree !== undefined
        ? [
            createWorkSessionManagerNote(noteInput),
            createAgentRunTreeNote(noteInput),
            createModelCallsNote(noteInput),
          ]
        : [
            createIntentCoreNote(noteInput),
            createGrowthGovernorNote(noteInput),
            createAgentRunTreeNote(noteInput),
            createRootletAgentsNote(noteInput),
            createModelCallsNote(noteInput),
            createAutonomyCoreNote(noteInput),
            createConvergenceJudgeNote(noteInput),
            createHandoffStewardNote(noteInput),
          ]
      : [
          createIntentCoreNote(noteInput),
          createGrowthGovernorNote(noteInput),
          createAgentRunTreeNote(noteInput),
          createRootletAgentsNote(noteInput),
          createModelCallsNote(noteInput),
          createAutonomyCoreNote(noteInput),
          createConvergenceJudgeNote(noteInput),
          createHandoffStewardNote(noteInput),
        ];
  const steps = deriveRunSteps(streamEvents);
  return {
    runId: input.runId,
    status: input.status,
    updatedAt: input.updatedAt,
    events: streamEvents,
    steps,
    workNotes,
    modelCalls,
  };
}

export function createPanelRunStreamEvents(input: {
  readonly runId: string;
  readonly status: PanelRunStatus;
  readonly eventEntries: readonly EventLogEntry[];
  readonly summary?: UndergroundDemoSummary | { readonly ai: UndergroundDemoSummary["ai"] };
  readonly observation?: PanelObservationReadModel;
  readonly routeDecision?: DesktopIntentDecision;
  readonly desktopMode?: "agent" | "deep";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly error?: { readonly code: string; readonly message: string };
}): readonly PanelRunStreamEvent[] {
  const events: PanelRunStreamEvent[] = [];
  const observationViews = createRunObservationEventViews(input.eventEntries);
  const viewBySequence = new Map(observationViews.map((view) => [view.sequence, view]));
  const suppressOrdinaryChatProgress =
    (input.desktopMode === "agent" || isOrdinaryChatRoute(input.routeDecision)) &&
    !hasUserVisibleWorkActivity(input.eventEntries);
  const push = (event: Omit<PanelRunStreamEvent, "sequence">): void => {
    events.push({ ...event, sequence: events.length + 1 });
  };

  push({
    eventId: `${input.runId}:run.started`,
    runId: input.runId,
    type: "run.started",
    createdAt: input.createdAt,
    agentLabel: "AgentArbor",
    summary: runStartedSummary(input.routeDecision, input.desktopMode),
    status: input.status === "pending" ? "pending" : "running",
    sourceRefs: [],
    modelCallRefs: [],
    toolCallRefs: [],
  });

  if (input.status === "cancelled") {
    push({
      eventId: `${input.runId}:run.cancelled`,
      runId: input.runId,
      type: "run.cancelled",
      createdAt: input.updatedAt,
      agentLabel: "AgentArbor",
      summary: "运行已取消。",
      status: "cancelled",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: [],
    });
    return events;
  }

  if (input.status === "blocked") {
    push({
      eventId: `${input.runId}:run.blocked`,
      runId: input.runId,
      type: "run.blocked",
      createdAt: input.updatedAt,
      agentLabel: "AgentArbor",
      summary: blockedRunSummary(input.error),
      status: "blocked",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: [],
    });
  }

  for (const entry of input.eventEntries) {
    if (shouldSuppressOrdinaryGoalEvent(entry.type, input.desktopMode, input.routeDecision)) {
      continue;
    }
    if (suppressOrdinaryChatProgress && shouldSuppressOrdinaryChatEvent(entry.type)) {
      continue;
    }
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
      agentLabel: "AgentArbor",
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
      agentLabel: "AgentArbor",
      summary: friendlyUserFacingFailureText(input.error?.message),
      status: "failed",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: [],
    });
  }

  return events;
}

function blockedRunSummary(error: { readonly code: string; readonly message: string } | undefined): string {
  if (error?.code === "out_of_fuel") {
    return "运行被异常保护中断，任务没有完成。你可以补充要求或重新发起，我会继续按模型判断处理。";
  }
  return friendlyUserFacingFailureText(error?.message ?? "运行中断，等待用户确认或补充指导。");
}

function runStartedSummary(
  routeDecision: DesktopIntentDecision | undefined,
  desktopMode: "agent" | "deep" | undefined
): string {
  if (routeDecision === undefined) {
    return desktopMode === "deep"
      ? "已进入深度模式，会运行地下组织做多路探索、父层综合和方向收束。"
      : "桌面助手已接手，会判断直接回答、读取授权上下文或请求确认。";
  }
  return explainDesktopIntentDecision(routeDecision).summary;
}

function isOrdinaryChatRoute(routeDecision: DesktopIntentDecision | undefined): boolean {
  return routeDecision !== undefined && routeDecision.route !== "task_work_session";
}

function shouldSuppressOrdinaryGoalEvent(
  type: ArborMessageType,
  desktopMode: "agent" | "deep" | undefined,
  routeDecision: DesktopIntentDecision | undefined
): boolean {
  return type === "goal.received" && (desktopMode === "agent" || isOrdinaryChatRoute(routeDecision));
}

function hasUserVisibleWorkActivity(eventEntries: readonly EventLogEntry[]): boolean {
  return eventEntries.some((entry) => {
    if (entry.type === "tool.requested" || entry.type === "tool.completed" || entry.type === "tool.failed") {
      return true;
    }
    if (entry.type === "user_approval.requested" || entry.type === "user_approval.received") {
      return true;
    }
    return isAgentFabricStreamType(entry.type);
  });
}

function shouldSuppressOrdinaryChatEvent(type: ArborMessageType): boolean {
  return type === "goal.received" || type === "model.requested" || type === "model.completed";
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
    if (stringOrUndefined(payload.finishReason) === "tool_call") {
      input.push({
        ...base,
        eventId: `${input.runId}:event:${input.entry.sequence}:agent.note.completed`,
        type: "agent.note.completed",
        agentLabel: "助手",
        summary: "助手已选择使用工具，工具结果会作为安全摘要进入后续处理。",
        status: "completed",
      });
      return;
    }
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
      detail: toolStreamDetail(input.entry.type, payload),
    });
    return;
  }

  if (input.entry.type === "context.compaction.completed" || input.entry.type === "context.compaction.failed") {
    input.push({
      ...base,
      eventId: `${input.runId}:event:${input.entry.sequence}:${input.entry.type}`,
      type: input.entry.type,
      agentLabel: "上下文",
      summary: contextCompactionStreamSummary(input.entry.type, payload),
      status: input.entry.type === "context.compaction.completed" ? "completed" : "failed",
      detail: {
        kind: "thinking",
        action: input.entry.type === "context.compaction.completed" ? "压缩上下文" : "上下文压缩失败",
        preview: contextCompactionPreview(payload),
        truncated: false,
      },
    });
    return;
  }

  if (input.entry.type === "user_approval.requested") {
    input.push({
      ...base,
      eventId: `${input.runId}:event:${input.entry.sequence}:confirmation.needed`,
      type: "confirmation.needed",
      agentLabel: "待确认",
      summary: confirmationSummary(payload),
      status: "running",
    });
    return;
  }

  if (input.entry.type === "user_approval.received") {
    input.push({
      ...base,
      eventId: `${input.runId}:event:${input.entry.sequence}:user.guidance`,
      type: "user.guidance",
      agentLabel: "用户指导",
      summary: userGuidanceSummary(payload),
      status: "completed",
    });
    return;
  }

  if (isAgentFabricStreamType(input.entry.type)) {
    input.push({
      ...base,
      eventId: `${input.runId}:event:${input.entry.sequence}:${input.entry.type}`,
      type: input.entry.type,
      agentLabel: agentFabricLabel(input.entry.type),
      summary: agentFabricSummary(input.entry.type, payload),
      status: input.entry.type === "agent.child.started" || input.entry.type === "agent.child.waiting" ? "running" : "completed",
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

function isAgentFabricStreamType(type: ArborMessageType): type is Extract<
  PanelRunStreamEventType,
  "agent.delegation.planned" | "agent.child.started" | "agent.child.completed" | "agent.child.waiting" | "agent.parent_synthesis.completed"
> {
  return (
    type === "agent.delegation.planned" ||
    type === "agent.child.started" ||
    type === "agent.child.completed" ||
    type === "agent.child.waiting" ||
    type === "agent.parent_synthesis.completed"
  );
}

function agentFabricLabel(type: PanelRunStreamEventType): string {
  switch (type) {
    case "agent.delegation.planned":
      return "中枢调度";
    case "agent.child.started":
    case "agent.child.completed":
    case "agent.child.waiting":
      return "并行检查";
    case "agent.parent_synthesis.completed":
      return "父层综合";
    default:
      return "工作更新";
  }
}

function agentFabricSummary(type: PanelRunStreamEventType, payload: Readonly<Record<string, unknown>>): string {
  if (type === "agent.delegation.planned") {
    const decision = asRecord(payload.delegationDecision);
    const childSpecIds = Array.isArray(payload.childSpecIds) ? payload.childSpecIds.filter(isString) : [];
    return `已形成分工计划，准备 ${childSpecIds.length} 路局部检查。`;
  }
  if (type === "agent.child.started") {
    const childRun = asRecord(payload.childRun);
    const spec = asRecord(payload.agentSpec);
    return `局部检查 ${stringOrUndefined(spec.displayName) ?? "一路检查"} 已启动。`;
  }
  if (type === "agent.child.completed") {
    const childRun = asRecord(payload.childRun);
    const outputRefs = Array.isArray(payload.outputRefs) ? payload.outputRefs.filter(isString) : [];
    return `一路局部检查已完成，产出 ${outputRefs.length} 个材料引用。`;
  }
  if (type === "agent.child.waiting") {
    const childRunIds = Array.isArray(payload.childRunIds) ? payload.childRunIds.filter(isString) : [];
    return `正在等待 ${childRunIds.length} 路局部材料返回。`;
  }
  if (type === "agent.parent_synthesis.completed") {
    const synthesis = asRecord(payload.parentSynthesis);
    return `综合判断完成：${stringOrUndefined(synthesis.decisionSummary) ?? "局部材料已合并"}。`;
  }
  return "工作状态已更新。";
}

function sourceRefsForView(view: RunObservationEventView | undefined): readonly string[] {
  return (
    view?.refs
      .filter((ref) => ref.kind !== "model_call" && ref.kind !== "tool_call")
      .map((ref) => `${ref.kind}:${ref.id}`) ?? []
  );
}

function modelCallRefsFor(entry: EventLogEntry, payload: Readonly<Record<string, unknown>>): readonly string[] {
  if (
    entry.type !== "model.requested" &&
    entry.type !== "model.completed" &&
    entry.type !== "model.failed" &&
    entry.type !== "context.compaction.completed" &&
    entry.type !== "context.compaction.failed"
  ) {
    return [];
  }
  return unique([stringOrUndefined(payload.requestId), stringOrUndefined(payload.responseId)].filter(isString));
}

function toolCallRefsFor(entry: EventLogEntry, payload: Readonly<Record<string, unknown>>): readonly string[] {
  if (
    entry.type !== "tool.requested" &&
    entry.type !== "tool.completed" &&
    entry.type !== "tool.failed" &&
    entry.type !== "user_approval.requested"
  ) {
    return [];
  }
  return stringOrUndefined(payload.callId) === undefined ? [] : [stringOrUndefined(payload.callId) as string];
}

function modelRequestedSummary(payload: Readonly<Record<string, unknown>>): string {
  const purpose = stringOrUndefined(payload.purpose) ?? "unknown";
  return purposeProgressLabel(purpose);
}

function modelCompletedSummary(payload: Readonly<Record<string, unknown>>, chunkCount: number): string {
  const validation = stringOrUndefined(payload.validationStatus) ?? "unknown";
  return validation === "passed" ? "内容已整理，并已进入报告或详情。" : `内容已整理，校验 ${validation}。`;
}

function purposeProgressLabel(purpose: string): string {
  switch (purpose) {
    case "desktop_intent_gate":
      return "等待模型路由结果。";
    case "work_session_decision":
      return "正在判断下一步。";
    case "work_session_child_material":
      return "正在整理局部材料。";
    case "work_session_synthesis":
      return "正在综合证据和冲突。";
    case "work_session_direct_answer":
      return "正在组织直接回答。";
    case "desktop_chat":
    case "desktop_agent":
      return "等待模型输出。";
    default:
      return "正在生成安全摘要。";
  }
}

function modelFailedSummary(payload: Readonly<Record<string, unknown>>): string {
  const failureKind = stringOrUndefined(payload.failureKind) ?? "model_failed";
  return friendlyUserFacingFailureText(failureKind);
}

function contextCompactionStreamSummary(
  type: "context.compaction.completed" | "context.compaction.failed",
  payload: Readonly<Record<string, unknown>>
): string {
  const summary = stringOrUndefined(payload.summary);
  if (summary !== undefined) {
    return summary;
  }
  const tokenCount = numberOrUndefined(payload.tokenCount);
  const threshold = numberOrUndefined(payload.threshold);
  const tokenText = tokenCount === undefined || threshold === undefined ? "" : `（${tokenCount}/${threshold} tokens）`;
  return type === "context.compaction.completed"
    ? `较早上下文已压缩${tokenText}。`
    : `上下文压缩没有成功${tokenText}。`;
}

function contextCompactionPreview(payload: Readonly<Record<string, unknown>>): string | undefined {
  const covered = numberOrUndefined(payload.coveredRefCount);
  const messageCountAfter = numberOrUndefined(payload.messageCountAfter);
  const parts = [
    covered === undefined ? undefined : `覆盖较早上下文 ${covered} 条`,
    messageCountAfter === undefined ? undefined : `压缩后消息 ${messageCountAfter} 条`,
    stringOrUndefined(payload.error),
  ].filter(isString);
  return parts.length === 0 ? undefined : parts.join("；");
}

function toolSummary(type: "tool.requested" | "tool.completed" | "tool.failed", payload: Readonly<Record<string, unknown>>): string {
  const toolName = stringOrUndefined(payload.toolName) ?? "unknown";
  const displayName = stringOrUndefined(payload.toolDisplayName) ?? localToolLabel(toolName);
  const input = asRecord(payload.input);
  const output = asRecord(payload.output);
  const result = asRecord(output.result);
  const label = displayName;
  const target = toolTargetText(toolName, input, result);
  const targetText = target === undefined ? "" : `：${target}`;
  if (type === "tool.requested") {
    return `正在${label}${targetText}。`;
  }
  const duration = typeof payload.durationMs === "number" ? `，耗时 ${Math.round(payload.durationMs)}ms` : "";
  const summary = stringOrUndefined(output.summary);
  if (type === "tool.completed") {
    return summary === undefined
      ? `${label}完成${targetText}${duration}。`
      : `${label}完成${targetText}${duration}：${summary}`;
  }
  return `${label}失败${targetText}${duration}。`;
}

function toolStreamDetail(
  type: "tool.requested" | "tool.completed" | "tool.failed",
  payload: Readonly<Record<string, unknown>>
): PanelRunStreamEventDetail {
  const toolName = stringOrUndefined(payload.toolName) ?? "tool";
  const input = asRecord(payload.input);
  const output = asRecord(payload.output);
  const result = asRecord(output.result);
  const display = toolDisplayOrUndefined(output.display);
  const envelope = toolResultEnvelopeOrUndefined(output.envelope);
  const command = stringOrUndefined(result.command) ?? stringOrUndefined(input.command);
  const args = stringArray(result.args).length > 0 ? stringArray(result.args) : stringArray(input.args);
  return {
    kind: "tool",
    action: displayActionLabel(stringOrUndefined(output.action) ?? localToolLabel(toolName)),
    path: stringOrUndefined(result.path) ?? stringOrUndefined(input.path),
    query: stringOrUndefined(result.query) ?? stringOrUndefined(input.query),
    command: command === undefined ? undefined : [command, ...args].join(" ").trim(),
    exitCode: typeof result.exitCode === "number" ? result.exitCode : undefined,
    preview: type === "tool.requested" ? toolRequestPreview(toolName, input) : toolResultPreview(toolName, output, result, payload),
    display,
    envelope,
    truncated: output.truncated === true,
    error: type === "tool.failed" ? stringOrUndefined(payload.error) : undefined,
  };
}

function toolDisplayOrUndefined(value: unknown): ToolDisplayProjection | undefined {
  const record = asRecord(value);
  const kind = stringOrUndefined(record.kind);
  if (
    kind === "search_results" ||
    kind === "browser_snapshot" ||
    kind === "file_change_summary" ||
    kind === "file_diff_preview" ||
    kind === "command_summary" ||
    kind === "generic_tool_summary"
  ) {
    return normalizeToolDisplayForReadModel(value as ToolDisplayProjection);
  }
  return undefined;
}

function normalizeToolDisplayForReadModel(display: ToolDisplayProjection): ToolDisplayProjection {
  if (display.kind !== "generic_tool_summary") {
    return display;
  }
  const action = display.action;
  return {
    ...display,
    action: action === undefined ? undefined : displayActionLabel(action),
  };
}

function displayActionLabel(value: string): string {
  return /^[a-z][a-z0-9_:-]*$/i.test(value) ? toolDisplayName(value) : value;
}

function toolResultEnvelopeOrUndefined(value: unknown): ToolResultEnvelope | undefined {
  const record = asRecord(value);
  const agentSummary = stringOrUndefined(record.agentSummary);
  const rawRetention = stringOrUndefined(record.rawRetention);
  if (agentSummary === undefined || (rawRetention !== "none" && rawRetention !== "diagnostic_ref_only")) {
    return undefined;
  }
  return {
    agentSummary: redactAndCompact(agentSummary, 1_800),
    evidenceRefs: stringArray(record.evidenceRefs).map((ref) => redactAndCompact(ref, 220)).slice(0, 12),
    uiDisplay: toolDisplayOrUndefined(record.uiDisplay),
    tokenEstimate: typeof record.tokenEstimate === "number" && Number.isFinite(record.tokenEstimate)
      ? Math.max(1, Math.floor(record.tokenEstimate))
      : Math.max(1, Math.ceil(agentSummary.length / 4)),
    truncated: record.truncated === true,
    redacted: record.redacted !== false,
    diagnosticRef: stringOrUndefined(record.diagnosticRef),
    rawRetention,
  };
}

function toolRequestPreview(toolName: string, input: Readonly<Record<string, unknown>>): string | undefined {
  if (toolName === "read_file" || toolName === "list_dir") {
    const path = stringOrUndefined(input.path);
    return path === undefined ? undefined : `目标：${path}`;
  }
  if (toolName === "grep_files") {
    const query = stringOrUndefined(input.query);
    const path = stringOrUndefined(input.path);
    return query === undefined ? undefined : `搜索：${query}${path === undefined ? "" : ` · ${path}`}`;
  }
  if (toolName === "write_file" || toolName === "create_file" || toolName === "edit_file" || toolName === "delete_file") {
    const path = stringOrUndefined(input.path);
    return path === undefined ? "准备修改文件。" : `目标文件：${path}`;
  }
  if (toolName === "run_command" || toolName === "shell_command") {
    const command = stringOrUndefined(input.command);
    const args = stringArray(input.args);
    return command === undefined ? undefined : `命令：${[command, ...args].join(" ").trim()}`;
  }
  if (toolName === "browser_snapshot") {
    const url = stringOrUndefined(input.url);
    return url === undefined ? undefined : `页面：${url}`;
  }
  return undefined;
}

function safeFileChangePreview(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  output: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>
): string | undefined {
  const path = stringOrUndefined(result.path) ?? stringOrUndefined(input.path);
  const summary = stringOrUndefined(output.summary);
  if (toolName === "edit_file") {
    const replacements = typeof result.replacements === "number" ? `替换：${result.replacements} 处` : undefined;
    const lengthChange =
      typeof result.previousLength === "number" && typeof result.nextLength === "number"
        ? `长度：${result.previousLength} -> ${result.nextLength} chars`
        : undefined;
    const diffPreview = ["变更预览", replacements, lengthChange]
      .filter((item): item is string => item !== undefined && item.length > 0)
      .join("\n");
    return [summary, path === undefined ? undefined : `文件：${path}`, diffPreview].filter((item): item is string => item !== undefined && item.length > 0).join("\n");
  }
  const bytes = typeof result.bytes === "number" ? `${result.bytes} bytes` : undefined;
  return [summary, path === undefined ? undefined : `文件：${path}`, bytes === undefined ? undefined : `写入大小：${bytes}`].filter((item): item is string => item !== undefined && item.length > 0).join("\n");
}

function toolResultPreview(
  toolName: string,
  output: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>
): string | undefined {
  const error = stringOrUndefined(payload.error);
  if (error !== undefined) {
    return compactStreamDetailText(error, 800);
  }
  if (toolName === "read_file") {
    return safeReadFilePreview(output, result);
  }
  if (toolName === "list_dir") {
    const entries = Array.isArray(result.entries) ? result.entries : [];
    const lines = entries.slice(0, 12).map((entry) => {
      const record = asRecord(entry);
      const name = stringOrUndefined(record.name) ?? "unknown";
      const kind = stringOrUndefined(record.kind) ?? "entry";
      const bytes = typeof record.bytes === "number" ? ` · ${record.bytes} bytes` : "";
      return `${kind} ${name}${bytes}`;
    });
    return lines.length === 0 ? stringOrUndefined(output.summary) : lines.join("\n");
  }
  if (toolName === "grep_files") {
    const matches = Array.isArray(result.matches) ? result.matches : [];
    const lines = matches.slice(0, 12).map((match) => {
      const record = asRecord(match);
      const path = stringOrUndefined(record.path) ?? "unknown";
      const line = typeof record.line === "number" ? record.line : "?";
      const preview = stringOrUndefined(record.preview) ?? "";
      return `${path}:${line} ${preview}`;
    });
    return lines.length === 0 ? stringOrUndefined(output.summary) : lines.join("\n");
  }
  if (toolName === "write_file" || toolName === "create_file" || toolName === "edit_file" || toolName === "delete_file") {
    return safeFileChangePreview(toolName, asRecord(payload.input), output, result);
  }
  if (toolName === "run_command" || toolName === "shell_command") {
    return safeCommandPreview(output, result);
  }
  if (toolName === "browser_snapshot") {
    const title = stringOrUndefined(result.title);
    const url = stringOrUndefined(result.url);
    const text = stringOrUndefined(result.text);
    const headline = [title, url].filter((item): item is string => item !== undefined).join(" · ");
    return compactStreamDetailText([headline, text].filter((item) => item !== undefined && item.length > 0).join("\n"), 900);
  }
  return compactStreamDetailText(stringOrUndefined(output.summary), 900);
}

function safeReadFilePreview(
  output: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>
): string | undefined {
  return safeReadFileToolPreview({
    summary: stringOrUndefined(output.summary),
    path: stringOrUndefined(result.path),
    bytes: typeof result.bytes === "number" ? result.bytes : undefined,
  });
}

function safeCommandPreview(
  output: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>
): string | undefined {
  return safeCommandToolPreview({
    summary: stringOrUndefined(output.summary),
    command: stringOrUndefined(result.command),
    exitCode: typeof result.exitCode === "number" ? result.exitCode : undefined,
  });
}

function compactStreamDetailText(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const text = value.trim();
  if (text.length === 0) {
    return undefined;
  }
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function redactAndCompact(value: string, maxLength: number): string {
  const redacted = redactSensitiveText(value).replace(/\s+/g, " ").trim();
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, Math.max(0, maxLength - 1))}…`;
}

function localToolLabel(toolName: string): string {
  return toolDisplayName(toolName);
}

function toolTargetText(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>
): string | undefined {
  const path = stringOrUndefined(result.path) ?? stringOrUndefined(input.path);
  if (path !== undefined) {
    return path;
  }
  const query = stringOrUndefined(result.query) ?? stringOrUndefined(input.query);
  if (query !== undefined) {
    return query;
  }
  const url = stringOrUndefined(result.url) ?? stringOrUndefined(input.url);
  if (url !== undefined) {
    return url;
  }
  if (toolName === "run_command" || toolName === "shell_command") {
    const command = stringOrUndefined(result.command) ?? stringOrUndefined(input.command);
    const args = stringArray(result.args).length > 0 ? stringArray(result.args) : stringArray(input.args);
    return command === undefined ? undefined : [command, ...args].join(" ").trim();
  }
  return undefined;
}

function confirmationSummary(payload: Readonly<Record<string, unknown>>): string {
  const question = stringOrUndefined(payload.question);
  const consequence = stringOrUndefined(payload.consequence);
  if (question !== undefined && consequence !== undefined) {
    return `${question} ${consequence}`;
  }
  return question ?? "继续前需要用户补充授权或澄清。";
}

function userGuidanceSummary(payload: Readonly<Record<string, unknown>>): string {
  const decision = stringOrUndefined(payload.decision) ?? stringOrUndefined(payload.status);
  const note = stringOrUndefined(payload.note) ?? stringOrUndefined(payload.guidance);
  if (decision !== undefined && note !== undefined) {
    return `用户已${decision}：${note}`;
  }
  return note ?? "用户已补充指导，工作可以继续。";
}

function agentNoteForEvent(
  entry: EventLogEntry,
  payload: Readonly<Record<string, unknown>>
): { readonly agentLabel: string; readonly summary: string; readonly status: PanelRunStreamEvent["status"] } | undefined {
  switch (entry.type) {
    case "goal.received":
      return { agentLabel: "用户", summary: "消息已收到，原文不会在调试区外展开。", status: "completed" };
    case "underground.exploration_planned":
      return { agentLabel: "地下认知运行时", summary: "目标画像和探索计划已形成。", status: "completed" };
    case "rootlet_cluster.started":
      return { agentLabel: "Rootlet 集群", summary: "动态 rootlet 已启动，开始探索候选方向。", status: "running" };
    case "exploration_candidate.produced":
      return { agentLabel: "Rootlet 集群", summary: "Rootlet 已产出候选材料，等待进入候选池。", status: "completed" };
    case "candidate_pool.updated":
      return { agentLabel: "候选池", summary: "候选池已更新，正式事实边界仍由父层收束和校验掌握。", status: "completed" };
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
      return { agentLabel: "结果整理", summary: "已收束的方案开始整理为可交付材料。", status: "running" };
    case "direction_handoff.completed":
      return { agentLabel: "结果整理", summary: "可交付材料已通过现有校验链生成。", status: "completed" };
    case "direction_handoff.revision_requested":
      return { agentLabel: "结果整理", summary: "结果材料需要修订或补充。", status: "running" };
    case "user_approval.requested":
      return { agentLabel: "用户确认", summary: "继续前需要用户澄清。", status: "running" };
    case "user_approval.received":
      return { agentLabel: "用户确认", summary: "用户澄清已收到，工作继续推进。", status: "completed" };
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
  readonly eventEntries: readonly EventLogEntry[];
}): string {
  const summary = fullSummaryOrUndefined(input.summary);
  if (summary !== undefined) {
    return `兼容运行完成，已形成可执行方案，状态 ${summary.directionPackage.status}。`;
  }
  const artifact = latestArtifactProducedPayload(input.eventEntries);
  if (artifact !== undefined) {
    return `任务运行完成，已生成报告：${artifact.summary ?? artifact.artifactId ?? "artifact"}。`;
  }
  const directAnswer = latestDirectAnswerPayload(input.eventEntries);
  if (directAnswer !== undefined) {
    return `已回答：${directAnswer.answer}`;
  }
  if (input.observation?.aboveground.status === "completed") {
    const handoff = input.observation.handoff;
    return handoff.packageId.length === 0
      ? "任务运行完成，已产出结果。"
      : `任务运行完成，方案 ${handoff.packageId} v${handoff.version} 已产出结果。`;
  }
  const stage = input.observation?.currentStage;
  return stage === undefined ? "运行完成。" : `运行完成，当前阶段 ${stage}。`;
}

function finalSourceRefs(input: {
  readonly summary?: UndergroundDemoSummary | { readonly ai: UndergroundDemoSummary["ai"] };
  readonly observation?: PanelObservationReadModel;
  readonly eventEntries: readonly EventLogEntry[];
}): readonly string[] {
  const summary = fullSummaryOrUndefined(input.summary);
  if (summary !== undefined) {
    return [
      `direction_package:${summary.directionPackage.id}`,
      `direction_handoff:${summary.directionPackage.directionId}`,
    ];
  }
  const handoff = input.observation?.handoff;
  if (handoff !== undefined && handoff.packageId.length > 0) {
    return [`direction_package:${handoff.packageId}`, `direction_handoff:${handoff.directionId}`];
  }
  const artifact = latestArtifactProducedPayload(input.eventEntries);
  if (artifact?.artifactId !== undefined) {
    return [`artifact:${artifact.artifactId}`];
  }
  const directAnswer = latestDirectAnswerPayload(input.eventEntries);
  return directAnswer?.requestId === undefined ? [] : [`model_call:${directAnswer.requestId}`];
}

function latestArtifactProducedPayload(eventEntries: readonly EventLogEntry[]): { readonly artifactId?: string; readonly summary?: string } | undefined {
  const artifactEvent = [...eventEntries].reverse().find((entry) => entry.type === "artifact.produced");
  if (artifactEvent === undefined) {
    return undefined;
  }
  const payload = asRecord(artifactEvent.message.payload);
  return {
    artifactId: stringOrUndefined(payload.artifactId),
    summary: stringOrUndefined(payload.summary),
  };
}

function latestDirectAnswerPayload(eventEntries: readonly EventLogEntry[]): { readonly requestId?: string; readonly answer: string } | undefined {
  for (const entry of [...eventEntries].reverse()) {
    if (entry.type !== "model.completed") {
      continue;
    }
    const payload = asRecord(entry.message.payload);
    const visibleOutput = modelVisibleOutputOrUndefined(payload.visibleOutput);
    if (
      visibleOutput?.contractId !== "work_session.direct_answer.v1" &&
      visibleOutput?.contractId !== "desktop.agent_response.v1" &&
      visibleOutput?.contractId !== "desktop.agent.answer.v1" &&
      visibleOutput?.contractId !== "desktop.chat_response.v1" &&
      visibleOutput?.contractId !== "desktop.chat.answer.v1"
    ) {
      continue;
    }
    const answer = visibleOutput.items
      .flatMap((item) => item.fields)
      .find((field) => field.name === "text" || field.name === "answer")
      ?.value
      .trim();
    if (answer !== undefined && answer.length > 0) {
      return {
        requestId: stringOrUndefined(payload.requestId),
        answer,
      };
    }
  }
  return undefined;
}

function fullSummaryOrUndefined(value: UndergroundDemoSummary | { readonly ai: UndergroundDemoSummary["ai"] } | undefined): UndergroundDemoSummary | undefined {
  return value !== undefined && "directionPackage" in value ? value : undefined;
}

function agentRunTreeViewOrUndefined(tree: AgentRunTree | undefined): SafeAgentRunTreeView | undefined {
  return tree === undefined ? undefined : createSafeAgentRunTreeView(tree);
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
      failureKind: stringOrUndefined(payload.failureKind) ?? existing?.failureKind,
      retryable: typeof payload.retryable === "boolean" ? payload.retryable : existing?.retryable,
      sanitizedErrorRef: stringOrUndefined(payload.sanitizedErrorRef) ?? existing?.sanitizedErrorRef,
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

type NoteFactoryInput = {
  readonly runId: string;
  readonly status: PanelRunStatus;
  readonly eventEntries: readonly EventLogEntry[];
  readonly summary?: UndergroundDemoSummary;
  readonly observation?: PanelObservationReadModel;
  readonly agentRunTree?: SafeAgentRunTreeView;
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

function waitingPointFor(status: PanelRunStatus, lastEventType: ArborMessageType | undefined): string {
  if (status === "pending") {
    return "等待后台运行启动。";
  }
  if (status === "approval_needed") {
    return "等待用户确认后继续。";
  }
  if (status === "needs_input") {
    return "等待用户补充指导。";
  }
  if (status === "cancelled") {
    return "运行已取消。";
  }
  if (status === "blocked") {
    return "运行中断，等待用户确认或补充指导。";
  }
  if (status === "failed") {
    return "运行失败，查看错误摘要。";
  }
  if (status === "completed") {
    return "运行完成，报告或终态摘要已形成。";
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
      return "已发出模型请求，等待返回脱敏结果引用。";
    case "model.completed":
    case "model.failed":
      return "模型调用已返回，Rootlet Agents 正在整理候选或 fallback。";
    case "context.compaction.completed":
      return "较早上下文已压缩，助手将继续处理当前任务。";
    case "context.compaction.failed":
      return "上下文压缩没有成功，运行已暂停等待继续处理。";
    case "tool.requested":
      return "已发出工具调用，等待工具返回脱敏结果引用。";
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

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
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
