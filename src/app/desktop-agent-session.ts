import type { TaskSoil } from "../domain/soil/index.js";
import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";
import { createId, nowIso } from "../kernel/id.js";
import type { AgentTurnRuntime, AgentTurnRuntimeResult } from "../kernel/intelligence/index.js";
import type { MinimalRuntime } from "./runtime.js";
import { createMinimalRuntime } from "./runtime.js";
import type { BasicAgentContextPack } from "./basic-agent-runtime/index.js";
import { DESKTOP_ROOT_AGENT } from "./agent-prompts/desktop-root-agent.js";
import { prepareDesktopAgentLoop } from "./desktop-agent-loop-preparation.js";
import { createTaskSoilFromDesktopInput } from "./task-soil-workspace.js";
import type {
  DesktopAgentPendingConfirmation,
  DesktopAgentPendingApprovalContinuation,
  DesktopAgentSessionResult,
  RunDesktopAgentSessionOptions,
} from "./desktop-agent-session-contracts.js";
import {
  publishConfirmationRequested,
  publishGoalReceived,
  publishTriggeredSkills,
} from "./desktop-agent-session-events.js";
import {
  activityFromEventEntries,
  evidenceRefsFromToolCalls,
  parseAnswer,
  pendingConfirmationFrom,
  refsFromResponse,
  refsFromToolCalls,
  resultBlocksFrom,
  safeDesktopAgentContextPack,
} from "./desktop-agent-session-projection.js";
import {
  constraintRefsFromTaskSoil,
  createIntelligenceChannelFromOptions,
  resolveDesktopAgentAiMode,
} from "./desktop-agent-session-runtime.js";
import { asRecord, stringOrUndefined } from "./panel-read-model-utils.js";

export type {
  DesktopAgentActivity,
  DesktopAgentAnswer,
  DesktopAgentConversationMessage,
  DesktopAgentPendingApprovalContinuation,
  DesktopAgentPendingConfirmation,
  DesktopAgentResultBlock,
  DesktopAgentSessionResult,
  DesktopAgentSessionRuntimeContext,
  DesktopAgentSessionStatus,
  RunDesktopAgentSessionOptions,
} from "./desktop-agent-session-contracts.js";

/**
 * Ordinary desktop agent turn/session executor. Runtime orchestration should
 * reach this only through the already-created run execution adapter path
 * (`BasicAgentRunExecutor -> executeBasicPanelRun -> executeOrdinaryDesktopRunForPanel`).
 * It does not create runs or freeze run birth facts by itself.
 */
export async function runDesktopAgentSession(
  goal: string,
  options: RunDesktopAgentSessionOptions = {}
): Promise<DesktopAgentSessionResult> {
  const agentDefinition = options.agentDefinition ?? DESKTOP_ROOT_AGENT;
  assertOrdinaryDesktopAgentDefinition(agentDefinition);
  const aiMode = resolveDesktopAgentAiMode(options);
  const runtime = options.runtime ?? createMinimalRuntime();
  const traceId = createId("trace");
  const goalId = createId("goal");
  const createdAt = nowIso();
  const taskSoil = createTaskSoilFromDesktopInput({
    goal,
    goalId,
    traceId,
    aiMode,
    constraints: runtime.constraints,
    soilStore: runtime.soilStore,
    taskSoilInput: options.taskSoilInput,
    createdAt,
  });

  publishGoalReceived({ runtime, traceId, goalId, goal, taskSoil });
  options.onRuntimeReady?.({ runtime, traceId, goalId });

  const intelligenceChannel =
    options.createIntelligenceChannel ?? createIntelligenceChannelFromOptions(aiMode, options);
  if (aiMode === "none" || intelligenceChannel === undefined) {
    return {
      status: "stopped",
      runtime,
      traceId,
      goalId,
      taskSoil,
      failureMessage: "AI runtime is not configured; Desktop Agent stopped before working.",
      modelCallRefs: [],
      toolCallRefs: [],
      activity: activityFromEventEntries(runtime.eventLog.list(), "stopped"),
      eventTypes: runtime.eventLog.types(),
    };
  }

  const channel = intelligenceChannel(runtime);
  const skillContexts = options.resolveSkillContexts === undefined
    ? options.skillContexts ?? []
    : await options.resolveSkillContexts({
        runtime,
        traceId,
        goalId,
        goal,
        conversationHistory: options.conversationHistory ?? [],
        intelligenceChannel: channel,
        abortSignal: options.abortSignal,
      });
  publishTriggeredSkills({
    runtime,
    agentId: agentDefinition.agentId,
    traceId,
    goalId,
    skills: skillContexts,
  });
  const loopOptions: RunDesktopAgentSessionOptions = {
    ...options,
    skillContexts,
  };
  const loop = prepareDesktopAgentLoop({
    runtime,
    agentDefinition,
    goal,
    taskSoil,
    channel,
    traceId,
    goalId,
    aiMode,
    options: loopOptions,
  });
  const turn = await loop.turnRuntime.executeAutonomous({
    policy: loop.turnPolicy,
    requestId: createId("model-request"),
    callerRef: { kind: "goal", id: goalId, label: "desktop_agent" },
    inputRefs: loop.contextPack.inputRefs,
    sanitizedMessages: loop.contextPack.messages,
    constraintRefs: constraintRefsFromTaskSoil(taskSoil),
    toolChoice: "auto",
    requestedAt: nowIso(),
    abortSignal: options.abortSignal,
  });

  return desktopAgentResultFromTurn({
    goal,
    runtime,
    traceId,
    goalId,
    taskSoil,
    contextPack: loop.contextPack,
    agentId: agentDefinition.agentId,
    turnRuntime: loop.turnRuntime,
    turn,
    capabilityResolution: loop.capabilityResolution,
  });
}

function desktopAgentResultFromTurn(input: {
  readonly goal: string;
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly taskSoil: TaskSoil;
  readonly contextPack: BasicAgentContextPack;
  readonly agentId: string;
  readonly turnRuntime: AgentTurnRuntime;
  readonly turn: AgentTurnRuntimeResult;
  readonly capabilityResolution: DesktopAgentSessionResult["capabilityResolution"];
}): DesktopAgentSessionResult {
  const modelCallRefs = refsFromResponse(input.turn.finalOutput, input.turn.modelRequestId, input.turn.modelResponseId);
  const toolCallRefs = refsFromToolCalls(input.turn.toolCalls);
  const waitingForApproval = input.turn.status === "approval_required" && input.turn.pendingApproval !== undefined;
  if (input.turn.status === "paused" && (input.turn.stoppedReason === "out_of_fuel" || input.turn.stoppedReason === "context_overflow")) {
    return {
      status: "paused",
      stopReason: input.turn.stoppedReason,
      runtime: input.runtime,
      traceId: input.traceId,
      goalId: input.goalId,
      taskSoil: input.taskSoil,
      capabilityResolution: input.capabilityResolution,
      contextPack: safeDesktopAgentContextPack(input.contextPack),
      failureMessage: input.turn.stoppedReason === "context_overflow"
        ? "上下文整理没有成功，任务没有完成。你可以继续发送消息，我会接着处理。"
        : "任务没有完成。你可以补充要求或重新发起，我会接着处理。",
      modelCallRefs,
      toolCallRefs,
      activity: activityFromEventEntries(input.runtime.eventLog.list(), "paused"),
      eventTypes: input.runtime.eventLog.types(),
    };
  }
  if (waitingForApproval) {
    const pendingConfirmation = pendingConfirmationFrom({
      goal: input.goal,
      taskSoil: input.taskSoil,
      toolCalls: input.turn.toolCalls,
      traceId: input.traceId,
      goalId: input.goalId,
      modelCallRefs,
      toolCallRefs,
    });
    if (pendingConfirmation !== undefined && !hasConfirmationRequested(input.runtime.eventLog.list(), pendingConfirmation.confirmationId)) {
        publishConfirmationRequested({
          runtime: input.runtime,
          agentId: input.agentId,
          traceId: input.traceId,
          goalId: input.goalId,
          pendingConfirmation,
        });
      }
    return {
      status: "confirmation_needed",
      runtime: input.runtime,
      traceId: input.traceId,
      goalId: input.goalId,
      taskSoil: input.taskSoil,
      capabilityResolution: input.capabilityResolution,
      pendingConfirmation,
      contextPack: safeDesktopAgentContextPack(input.contextPack),
      modelCallRefs,
      toolCallRefs,
      activity: activityFromEventEntries(input.runtime.eventLog.list(), "confirmation_needed"),
      eventTypes: input.runtime.eventLog.types(),
      pendingApproval: pendingApprovalContinuation(input, pendingConfirmation),
    };
  }
  if (
    input.turn.status !== "completed" ||
    input.turn.finalOutput === undefined ||
    input.turn.finalOutput.status !== "completed"
  ) {
    return {
      status: "failed",
      runtime: input.runtime,
      traceId: input.traceId,
      goalId: input.goalId,
      taskSoil: input.taskSoil,
      capabilityResolution: input.capabilityResolution,
      contextPack: safeDesktopAgentContextPack(input.contextPack),
      failureMessage: input.turn.finalOutput?.failure?.message ?? "任务没有完成。",
      modelCallRefs,
      toolCallRefs,
      activity: activityFromEventEntries(input.runtime.eventLog.list(), "failed"),
      eventTypes: input.runtime.eventLog.types(),
    };
  }

  const answer = parseAnswer(input.turn.finalOutput, input.turn.toolCalls);
  if (answer === undefined) {
    return {
      status: "failed",
      runtime: input.runtime,
      traceId: input.traceId,
      goalId: input.goalId,
      taskSoil: input.taskSoil,
      capabilityResolution: input.capabilityResolution,
      contextPack: safeDesktopAgentContextPack(input.contextPack),
      failureMessage: "Desktop Agent model stopped without a visible answer.",
      modelCallRefs,
      toolCallRefs,
      activity: activityFromEventEntries(input.runtime.eventLog.list(), "failed"),
      eventTypes: input.runtime.eventLog.types(),
    };
  }
  const evidenceRefs = evidenceRefsFromToolCalls(input.turn.toolCalls);
  const pendingConfirmation = pendingConfirmationFrom({
    goal: input.goal,
    taskSoil: input.taskSoil,
    toolCalls: input.turn.toolCalls,
    traceId: input.traceId,
    goalId: input.goalId,
    modelCallRefs,
    toolCallRefs,
  });
  if (pendingConfirmation !== undefined && !hasConfirmationRequested(input.runtime.eventLog.list(), pendingConfirmation.confirmationId)) {
    publishConfirmationRequested({
      runtime: input.runtime,
      agentId: input.agentId,
      traceId: input.traceId,
      goalId: input.goalId,
      pendingConfirmation,
    });
  }
  const resultBlocks = resultBlocksFrom({
    answer,
    toolCalls: input.turn.toolCalls,
    evidenceRefs,
    pendingConfirmation,
  });
  const status = pendingConfirmation === undefined ? "completed" : "confirmation_needed";
  return {
    status,
    runtime: input.runtime,
    traceId: input.traceId,
    goalId: input.goalId,
    taskSoil: input.taskSoil,
    capabilityResolution: input.capabilityResolution,
    answer: {
      answer,
      modelCallRefs,
      toolCallRefs,
      evidenceRefs,
      resultBlocks,
    },
    pendingConfirmation,
    contextPack: safeDesktopAgentContextPack(input.contextPack),
    modelCallRefs,
    toolCallRefs,
    activity: activityFromEventEntries(input.runtime.eventLog.list(), status),
    eventTypes: input.runtime.eventLog.types(),
    pendingApproval: pendingApprovalContinuation(input, pendingConfirmation),
  };
}

function pendingApprovalContinuation(
  input: {
    readonly goal: string;
    readonly runtime: MinimalRuntime;
    readonly traceId: string;
    readonly goalId: string;
    readonly taskSoil: TaskSoil;
    readonly contextPack: BasicAgentContextPack;
    readonly agentId: string;
    readonly turnRuntime: AgentTurnRuntime;
    readonly turn: AgentTurnRuntimeResult;
    readonly capabilityResolution: DesktopAgentSessionResult["capabilityResolution"];
  },
  pendingConfirmation: DesktopAgentPendingConfirmation | undefined
): DesktopAgentPendingApprovalContinuation | undefined {
  if (pendingConfirmation === undefined || input.turn.pendingApproval === undefined) {
    return undefined;
  }
  const pendingApproval = input.turn.pendingApproval;
  return {
    confirmationId: pendingApproval.confirmationId,
    resume: async (resumeInput) => {
      const resumed = await input.turnRuntime.resumeAutonomous({
        pendingApproval,
        approvedConfirmationIds: resumeInput.approvedConfirmationIds,
        abortSignal: resumeInput.abortSignal,
      });
      return desktopAgentResultFromTurn({
        ...input,
        turn: resumed,
      });
    },
    resumeWithDecision: async (resumeInput) => {
      const resumed = await input.turnRuntime.resumeAutonomousWithConfirmationDecision({
        pendingApproval,
        decision: {
          confirmationId: pendingApproval.confirmationId,
          decision: resumeInput.decision,
          guidance: resumeInput.guidance,
        },
        abortSignal: resumeInput.abortSignal,
      });
      return desktopAgentResultFromTurn({
        ...input,
        turn: resumed,
      });
    },
  };
}

function hasConfirmationRequested(entries: readonly EventLogEntry[], confirmationId: string): boolean {
  return entries.some((entry) => {
    if (entry.type !== "user_approval.requested") {
      return false;
    }
    const payload = asRecord(entry.message.payload);
    return stringOrUndefined(payload.confirmationId) === confirmationId;
  });
}

function assertOrdinaryDesktopAgentDefinition(
  definition: NonNullable<RunDesktopAgentSessionOptions["agentDefinition"]>
): void {
  if (definition.toolVisibilityProfile.runMode !== "agent") {
    throw new Error(
      `Desktop Agent requires an ordinary AgentDefinition; ${definition.agentId} declares ${definition.toolVisibilityProfile.runMode}.`
    );
  }
  if (definition.turnPolicy.purpose !== "desktop_agent") {
    throw new Error(
      `Desktop Agent requires desktop_agent purpose; ${definition.agentId} declares ${definition.turnPolicy.purpose}.`
    );
  }
}
