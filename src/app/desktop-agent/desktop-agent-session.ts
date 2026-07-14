import type { TaskSoil } from "../../domain/soil/index.js";
import type { EventLogEntry } from "../../kernel/events/in-memory-event-log.js";
import { createId, nowIso } from "../../kernel/id.js";
import type { AgentTurnRuntime, AgentTurnRuntimeResult } from "../../kernel/intelligence/index.js";
import type { BasicAgentRuntimeContext } from "../basic-agent-runtime/runtime-context.js";
import { createOrdinaryAgentRuntime } from "./ordinary-agent-runtime.js";
import { ordinaryModelContextFromTurn } from "../basic-agent-runtime/index.js";
import type { DesktopAgentModelInput } from "./desktop-agent-model-input.js";
import { DESKTOP_ROOT_AGENT } from "../agent-prompts/desktop-root-agent.js";
import { attachDesktopFileInputsToModelMessages } from "../task-soil/desktop-agent-model-input-files.js";
import { prepareDesktopAgentLoop } from "./desktop-agent-loop-preparation.js";
import { createTaskSoilFromDesktopInput } from "../task-soil/task-soil-workspace.js";
import type {
  DesktopAgentConversationMessage,
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
  evidenceRefsFromToolCalls,
  parseAnswer,
  pendingConfirmationFrom,
  refsFromResponse,
  refsFromToolCalls,
} from "./desktop-agent-session-projection.js";
import {
  constraintRefsFromTaskSoil,
  createIntelligenceChannelFromOptions,
  resolveDesktopAgentAiMode,
} from "./desktop-agent-session-runtime.js";
import { asRecord, stringOrUndefined } from "../run-read-model/value-utils.js";

export type {
  DesktopAgentAnswer,
  DesktopAgentConversationMessage,
  DesktopAgentPendingApprovalContinuation,
  DesktopAgentPendingConfirmation,
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
  const runtime = options.runtime ?? createOrdinaryAgentRuntime();
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
    };
  }

  const channel = intelligenceChannel(runtime);
  const skillRoutingHistory = options.skillRoutingHistory ?? [];
  const skillContexts = options.resolveSkillContexts === undefined
    ? options.skillContexts ?? []
    : await options.resolveSkillContexts({
        runtime,
        traceId,
        goalId,
        goal,
        conversationHistory: skillRoutingHistory,
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
    priorModelContext: options.priorModelContext,
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
  const modelMessages = await attachDesktopFileInputsToModelMessages({
    messages: loop.modelInput.messages,
    taskSoil,
    modelCapabilities: loop.modelCapabilities,
    workspaceRoot: options.workspaceRoot,
  });
  const turn = await loop.turnRuntime.execute({
    policy: loop.turnPolicy,
    requestId: createId("model-request"),
    callerRef: { kind: "goal", id: goalId, label: "desktop_agent" },
    inputRefs: loop.modelInput.inputRefs,
    sanitizedMessages: modelMessages,
    constraintRefs: constraintRefsFromTaskSoil(taskSoil),
    toolChoice: "auto",
    requestedAt: nowIso(),
    abortSignal: options.abortSignal,
  }, FINAL_OUTPUT_ONLY_TURN);

  return desktopAgentResultFromTurn({
    runId: options.runId ?? traceId,
    goal,
    runtime,
    traceId,
    goalId,
    taskSoil,
    modelInput: loop.modelInput,
    agentId: agentDefinition.agentId,
    turnRuntime: loop.turnRuntime,
    turn,
    capabilityResolution: loop.capabilityResolution,
  });
}

function desktopAgentResultFromTurn(input: {
  readonly runId: string;
  readonly goal: string;
  readonly runtime: BasicAgentRuntimeContext;
  readonly traceId: string;
  readonly goalId: string;
  readonly taskSoil: TaskSoil;
  readonly modelInput: DesktopAgentModelInput;
  readonly agentId: string;
  readonly turnRuntime: AgentTurnRuntime;
  readonly turn: AgentTurnRuntimeResult;
  readonly capabilityResolution: DesktopAgentSessionResult["capabilityResolution"];
}): DesktopAgentSessionResult {
  const modelCallRefs = refsFromResponse(input.turn.finalOutput, input.turn.modelRequestId, input.turn.modelResponseId);
  const toolCallRefs = refsFromToolCalls(input.turn.toolCalls);
  const modelContext = ordinaryModelContextFromTurn({
    runId: input.runId,
    contextMessages: input.turn.contextMessages,
    finalOutput: input.turn.finalOutput,
    completed: input.turn.status === "completed" && input.turn.finalOutput?.status === "completed",
  });
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
      modelContext,
      failureMessage: input.turn.stoppedReason === "context_overflow"
        ? "上下文整理没有成功，任务没有完成。你可以继续发送消息，我会接着处理。"
        : "任务没有完成。你可以补充要求或重新发起，我会接着处理。",
      modelCallRefs,
      toolCallRefs,
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
      modelContext,
      modelCallRefs,
      toolCallRefs,
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
      modelContext,
      failureMessage: input.turn.finalOutput?.failure?.message ?? "任务没有完成。",
      modelCallRefs,
      toolCallRefs,
    };
  }

  const answer = parseAnswer(input.turn.finalOutput);
  if (answer === undefined) {
    return {
      status: "failed",
      runtime: input.runtime,
      traceId: input.traceId,
      goalId: input.goalId,
      taskSoil: input.taskSoil,
      capabilityResolution: input.capabilityResolution,
      modelContext,
      failureMessage: "Desktop Agent model stopped without a visible answer.",
      modelCallRefs,
      toolCallRefs,
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
    },
    pendingConfirmation,
    modelContext,
    modelCallRefs,
    toolCallRefs,
    pendingApproval: pendingApprovalContinuation(input, pendingConfirmation),
  };
}

function pendingApprovalContinuation(
  input: {
    readonly runId: string;
    readonly goal: string;
    readonly runtime: BasicAgentRuntimeContext;
    readonly traceId: string;
    readonly goalId: string;
    readonly taskSoil: TaskSoil;
    readonly modelInput: DesktopAgentModelInput;
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
      const resumed = await input.turnRuntime.resume({
        pendingApproval,
        approvedConfirmationIds: resumeInput.approvedConfirmationIds,
        abortSignal: resumeInput.abortSignal,
      }, FINAL_OUTPUT_ONLY_TURN);
      return desktopAgentResultFromTurn({
        ...input,
        turn: resumed,
      });
    },
    resumeWithDecision: async (resumeInput) => {
      const resumed = await input.turnRuntime.resumeWithConfirmationDecision({
        pendingApproval,
        decision: {
          confirmationId: pendingApproval.confirmationId,
          decision: resumeInput.decision,
          guidance: resumeInput.guidance,
        },
        abortSignal: resumeInput.abortSignal,
      }, FINAL_OUTPUT_ONLY_TURN);
      return desktopAgentResultFromTurn({
        ...input,
        turn: resumed,
      });
    },
  };
}

const FINAL_OUTPUT_ONLY_TURN = {
  blockedToolNames: [],
  exposeNonFinalOutput: false,
} as const;

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
