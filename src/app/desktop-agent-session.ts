import type { TaskSoil } from "../domain/soil/index.js";
import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";
import { createId, nowIso } from "../kernel/id.js";
import type { AgentTurnRuntime, AgentTurnRuntimeResult } from "../kernel/intelligence/index.js";
import type { MinimalRuntime } from "./runtime.js";
import { createMinimalRuntime } from "./runtime.js";
import {
  buildBasicAgentContextPack,
  createOpenAITokenCounter,
  type BasicAgentContextPack,
} from "./basic-agent-runtime/index.js";
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
  DESKTOP_AGENT_DEFAULT_MAX_OUTPUT_TOKENS,
  DESKTOP_AGENT_ID,
} from "./desktop-agent-session-ids.js";
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
  allowedToolsForRun,
  constraintRefsFromTaskSoil,
  createDesktopAgentOutputContract,
  createDesktopAgentTurnRuntime,
  createIntelligenceChannelFromOptions,
  resolveActiveModelName,
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
 * Ordinary desktop agent runtime: a single conversational/tool-assisted turn
 * that shares infrastructure with deep mode but never starts Underground
 * orchestration by itself.
 */
export async function runDesktopAgentSession(
  goal: string,
  options: RunDesktopAgentSessionOptions = {}
): Promise<DesktopAgentSessionResult> {
  const aiMode = options.aiMode ?? "openai-responses";
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
  publishTriggeredSkills({ runtime, traceId, goalId, skills: options.skillContexts ?? [] });
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
  const createdToolCenter = options.createToolCenter?.(runtime);
  const toolCenter =
    aiMode === "fake" || options.modelCapabilities?.supportsToolCalling !== false
      ? createdToolCenter
      : undefined;
  toolCenter?.resetCallCount();
  const tokenCounter = createOpenAITokenCounter(resolveActiveModelName(options));
  const contextPack = buildBasicAgentContextPack({
    goal,
    taskSoil,
    conversationHistory: options.conversationHistory ?? [],
    skillContexts: options.skillContexts ?? [],
    modelCapabilities: options.modelCapabilities,
    tokenCounter,
  });
  const turnRuntime = createDesktopAgentTurnRuntime({
    runtime,
    channel,
    goal,
    traceId,
    goalId,
    options,
    toolCenter,
  });
  const allowedTools = toolCenter === undefined
    ? []
    : options.allowedTools ?? allowedToolsForRun({
        toolCenter,
        snapshot: options.capabilitySnapshot,
        goal,
        taskSoil,
        platform: options.platform,
      });
  const turn = await turnRuntime.executeAutonomous({
    policy: {
      allowModel: true,
      allowedTools,
      fallback: "disabled",
      callerAgentId: DESKTOP_AGENT_ID,
      traceId,
      goalId,
      purpose: "desktop_agent",
      outputContract: createDesktopAgentOutputContract(),
      sensitivity: "internal",
      budget: {
        maxOutputTokens: options.modelCapabilities?.maxOutputTokens ?? DESKTOP_AGENT_DEFAULT_MAX_OUTPUT_TOKENS,
      },
    },
    requestId: createId("model-request"),
    callerRef: { kind: "goal", id: goalId, label: "desktop_agent" },
    inputRefs: contextPack.inputRefs,
    sanitizedMessages: contextPack.messages,
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
    contextPack,
    turnRuntime,
    turn,
  });
}

function desktopAgentResultFromTurn(input: {
  readonly goal: string;
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly taskSoil: TaskSoil;
  readonly contextPack: BasicAgentContextPack;
  readonly turnRuntime: AgentTurnRuntime;
  readonly turn: AgentTurnRuntimeResult;
}): DesktopAgentSessionResult {
  const modelCallRefs = refsFromResponse(input.turn.finalOutput, input.turn.modelRequestId, input.turn.modelResponseId);
  const toolCallRefs = refsFromToolCalls(input.turn.toolCalls);
  const waitingForApproval = input.turn.status === "approval_required" && input.turn.pendingApproval !== undefined;
  if (input.turn.status === "paused" && (input.turn.stoppedReason === "out_of_fuel" || input.turn.stoppedReason === "context_overflow")) {
    return {
      status: "paused",
      runtime: input.runtime,
      traceId: input.traceId,
      goalId: input.goalId,
      taskSoil: input.taskSoil,
      contextPack: safeDesktopAgentContextPack(input.contextPack),
      failureMessage: input.turn.stoppedReason === "context_overflow"
        ? "上下文压缩没有成功，任务没有完成。你可以继续发送消息，我会在保留现有上下文的基础上接着处理。"
        : "运行被异常保护中断，任务没有完成。你可以补充要求或重新发起，我会继续按模型判断处理。",
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
      contextPack: safeDesktopAgentContextPack(input.contextPack),
      failureMessage: input.turn.finalOutput?.failure?.message ?? "Desktop Agent model/tool turn failed.",
      modelCallRefs,
      toolCallRefs,
      activity: activityFromEventEntries(input.runtime.eventLog.list(), "failed"),
      eventTypes: input.runtime.eventLog.types(),
    };
  }

  const answer = parseAnswer(input.turn.finalOutput, input.turn.toolCalls);
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
    readonly turnRuntime: AgentTurnRuntime;
    readonly turn: AgentTurnRuntimeResult;
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
