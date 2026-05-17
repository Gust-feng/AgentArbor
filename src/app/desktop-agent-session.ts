import type { IntelligenceChannel, ModelOutputContract, ModelOutputDelta, ModelResponse } from "../domain/intelligence/index.js";
import type { BasicAgentCapabilitySnapshot, ModelCapabilities } from "../domain/config/index.js";
import type { ConstraintRef } from "../domain/constraints.js";
import type { ObservationRef } from "../domain/observation/index.js";
import type { TaskSoil } from "../domain/soil/index.js";
import type { ToolCallResult, ToolExecutionBroker } from "../domain/tools/index.js";
import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";
import { createId, nowIso } from "../kernel/id.js";
import { AgentTurnRuntime, type AgentTurnRuntimeResult } from "../kernel/intelligence/index.js";
import { createMessage } from "../kernel/messages/create-message.js";
import {
  createModelRuntimeConfig,
  createModelRuntimeDisabledConfigurationError,
  type ModelRuntimeEnvironment,
  type ModelRuntimeMode,
  type ModelRuntimeProviderFetch,
} from "./model-runtime/index.js";
import type { MinimalRuntime } from "./runtime.js";
import { createMinimalRuntime } from "./runtime.js";
import {
  buildBasicAgentContextPack,
  compactBasicAgentLoopContextIfNeeded,
  createOpenAITokenCounter,
  type BasicAgentContextPack,
} from "./basic-agent-runtime/index.js";
import { resolveRunCapabilities } from "./capability-policy.js";
import type { DesktopAgentSkillContext } from "./desktop-agent-prompts.js";
import { createTaskSoilFromDesktopInput, type DesktopTaskSoilInput } from "./task-soil-workspace.js";
import { sanitizeAssistantVisibleText } from "./visible-text-safety.js";

export type DesktopAgentSessionStatus = "completed" | "confirmation_needed" | "stopped" | "failed" | "paused";

export type DesktopAgentActivity = {
  readonly activityId: string;
  readonly type:
    | "task_received"
    | "model_requested"
    | "model_completed"
    | "model_failed"
    | "tool_requested"
    | "tool_completed"
    | "tool_failed"
    | "confirmation_needed"
    | "completed"
    | "stopped"
    | "failed";
  readonly title: string;
  readonly summary: string;
  readonly status: "pending" | "running" | "completed" | "failed";
  readonly createdAt: string;
  readonly action?: string;
  readonly path?: string;
  readonly truncated?: boolean;
  readonly error?: string;
  readonly toolName?: string;
  readonly sourceRefs: readonly string[];
  readonly modelCallRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
};

export type DesktopAgentResultBlock = {
  readonly blockId: string;
  readonly kind: "answer" | "tool_summary" | "pending_confirmation" | "failure";
  readonly title: string;
  readonly summary: string;
  readonly evidenceRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
};

export type DesktopAgentPendingConfirmation = {
  readonly confirmationId: string;
  readonly title: string;
  readonly question: string;
  readonly consequence: string;
  readonly riskLevel: "low" | "medium" | "high";
  readonly requestedAt: string;
  readonly modelCallRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
  readonly sourceRefs: readonly string[];
};

export type DesktopAgentAnswer = {
  readonly answer: string;
  readonly modelCallRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly resultBlocks: readonly DesktopAgentResultBlock[];
};

export type DesktopAgentSessionResult = {
  readonly status: DesktopAgentSessionStatus;
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly taskSoil: TaskSoil;
  readonly answer?: DesktopAgentAnswer;
  readonly pendingConfirmation?: DesktopAgentPendingConfirmation;
  readonly contextPack?: Pick<BasicAgentContextPack, "usageSummary" | "items" | "budget" | "truncationReport" | "truncated">;
  readonly failureMessage?: string;
  readonly modelCallRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
  readonly activity: readonly DesktopAgentActivity[];
  readonly eventTypes: readonly string[];
  readonly pendingApproval?: DesktopAgentPendingApprovalContinuation;
};

export type DesktopAgentPendingApprovalContinuation = {
  readonly confirmationId: string;
  resume(input: {
    readonly approvedConfirmationIds: readonly string[];
    readonly abortSignal?: AbortSignal;
  }): Promise<DesktopAgentSessionResult>;
};

export type DesktopAgentSessionRuntimeContext = {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
};

export type RunDesktopAgentSessionOptions = {
  readonly aiMode?: ModelRuntimeMode;
  readonly aiEnvironment?: ModelRuntimeEnvironment;
  readonly providerFetch?: ModelRuntimeProviderFetch;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly conversationHistory?: readonly DesktopAgentConversationMessage[];
  readonly skillContexts?: readonly DesktopAgentSkillContext[];
  readonly modelCapabilities?: ModelCapabilities;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly allowedTools?: readonly string[];
  readonly platform?: NodeJS.Platform;
  readonly abortSignal?: AbortSignal;
  readonly runtime?: MinimalRuntime;
  readonly createIntelligenceChannel?: (runtime: MinimalRuntime) => IntelligenceChannel;
  readonly createToolCenter?: (runtime: MinimalRuntime) => ToolExecutionBroker;
  readonly onRuntimeReady?: (context: DesktopAgentSessionRuntimeContext) => void;
  readonly onModelOutputDelta?: (delta: ModelOutputDelta) => void;
  /**
   * Legacy compatibility only. Ordinary Desktop Agent no longer requests a
   * work-session upgrade; explicit deep mode owns Underground organization.
   */
  readonly allowWorkSessionUpgrade?: boolean;
};

export type DesktopAgentConversationMessage = {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly ref?: string;
};

const DESKTOP_AGENT_ID = "desktop-agent-session";

/**
 * Ordinary desktop agent runtime: a single conversational/tool-assisted turn
 * that shares infrastructure with deep mode but never starts Underground
 * orchestration by itself.
 */
export async function runDesktopAgentSession(
  goal: string,
  options: RunDesktopAgentSessionOptions = {}
): Promise<DesktopAgentSessionResult> {
  const aiMode = options.aiMode ?? "openai-compatible";
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
  const turnRuntime = new AgentTurnRuntime({
    intelligenceChannel: channel,
    toolCenter,
    publishToolEvent: (message) => runtime.bus.publish(message),
    maintainContext: async (input) => {
      const result = await compactBasicAgentLoopContextIfNeeded({
        goal,
        traceId,
        goalId,
        messages: input.messages,
        tools: input.tools,
        intelligenceChannel: channel,
        modelCapabilities: options.modelCapabilities,
        tokenCounter,
      });
      if (result.status === "failed") {
        return {
          status: "failed",
          message: result.message,
          requestId: result.requestId,
          responseId: result.responseId,
          retryable: true,
        };
      }
      if (result.status === "compacted") {
        return { status: "compacted", messages: result.messages };
      }
      return { status: "unchanged" };
    },
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
      outputContract: desktopAgentOutputContract(),
      sensitivity: "internal",
      budget: {
        maxOutputTokens: Math.min(options.modelCapabilities?.maxOutputTokens ?? 3200, 16_000),
        maxLatencyMs: 60_000,
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

function resolveActiveModelName(options: RunDesktopAgentSessionOptions): string | undefined {
  return options.aiEnvironment?.AGENTARBOR_MODEL_NAME ?? process.env.AGENTARBOR_MODEL_NAME;
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
  const recoverableBudgetStop = isRecoverableBudgetStop(input.turn);
  const waitingForApproval = input.turn.status === "approval_required" && input.turn.pendingApproval !== undefined;
  if (input.turn.status === "paused" && (input.turn.stoppedReason === "out_of_fuel" || input.turn.stoppedReason === "context_overflow")) {
    return {
      status: "paused",
      runtime: input.runtime,
      traceId: input.traceId,
      goalId: input.goalId,
      taskSoil: input.taskSoil,
      contextPack: safeContextPack(input.contextPack),
      failureMessage: input.turn.stoppedReason === "context_overflow"
        ? "上下文压缩没有成功，任务没有完成。你可以继续发送消息，我会在保留现有安全历史的基础上接着处理。"
        : "运行被异常保护中断，任务没有完成。你可以补充要求或重新发起，我会继续按模型判断处理。",
      modelCallRefs,
      toolCallRefs,
      activity: activityFromEventEntries(input.runtime.eventLog.list(), "paused"),
      eventTypes: input.runtime.eventLog.types(),
    };
  }
  if (waitingForApproval) {
    const answer = "这个操作需要你确认后才能继续。批准后我会执行对应工具，并把安全结果交回模型继续处理。";
    const pendingConfirmation = pendingConfirmationFrom({
      goal: input.goal,
      taskSoil: input.taskSoil,
      answer,
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
    const evidenceRefs = unique(evidenceRefsFromToolCalls(input.turn.toolCalls)).slice(0, 12);
    const resultBlocks = resultBlocksFrom({
      answer,
      toolCalls: input.turn.toolCalls,
      evidenceRefs,
      pendingConfirmation,
    });
    return {
      status: "confirmation_needed",
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
      contextPack: safeContextPack(input.contextPack),
      modelCallRefs,
      toolCallRefs,
      activity: activityFromEventEntries(input.runtime.eventLog.list(), "confirmation_needed"),
      eventTypes: input.runtime.eventLog.types(),
      pendingApproval:
        pendingConfirmation === undefined || input.turn.pendingApproval === undefined
          ? undefined
          : {
              confirmationId: input.turn.pendingApproval.confirmationId,
              resume: async (resumeInput) => {
                const resumed = await input.turnRuntime.resumeAutonomous({
                  pendingApproval: input.turn.pendingApproval!,
                  approvedConfirmationIds: resumeInput.approvedConfirmationIds,
                  abortSignal: resumeInput.abortSignal,
                });
                return desktopAgentResultFromTurn({
                  ...input,
                  turn: resumed,
                });
              },
            },
    };
  }
  if (
    (input.turn.status !== "completed" && !recoverableBudgetStop) ||
    input.turn.finalOutput === undefined ||
    input.turn.finalOutput.status !== "completed"
  ) {
    return {
      status: "failed",
      runtime: input.runtime,
      traceId: input.traceId,
      goalId: input.goalId,
      taskSoil: input.taskSoil,
      contextPack: safeContextPack(input.contextPack),
      failureMessage: input.turn.finalOutput?.failure?.message ?? "Desktop Agent model/tool turn failed.",
      modelCallRefs,
      toolCallRefs,
      activity: activityFromEventEntries(input.runtime.eventLog.list(), "failed"),
      eventTypes: input.runtime.eventLog.types(),
    };
  }

  const answer = parseAnswer(input.turn.finalOutput, input.turn.toolCalls);
  const evidenceRefs = unique(evidenceRefsFromToolCalls(input.turn.toolCalls)).slice(0, 12);
  const pendingConfirmation = pendingConfirmationFrom({
    goal: input.goal,
    taskSoil: input.taskSoil,
    answer,
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
    contextPack: safeContextPack(input.contextPack),
    modelCallRefs,
    toolCallRefs,
    activity: activityFromEventEntries(input.runtime.eventLog.list(), status),
    eventTypes: input.runtime.eventLog.types(),
    pendingApproval:
      pendingConfirmation === undefined || input.turn.pendingApproval === undefined
        ? undefined
        : {
            confirmationId: input.turn.pendingApproval.confirmationId,
            resume: async (resumeInput) => {
              const resumed = await input.turnRuntime.resumeAutonomous({
                pendingApproval: input.turn.pendingApproval!,
                approvedConfirmationIds: resumeInput.approvedConfirmationIds,
                abortSignal: resumeInput.abortSignal,
              });
              return desktopAgentResultFromTurn({
                ...input,
                turn: resumed,
              });
            },
          },
  };
}

function safeContextPack(
  pack: BasicAgentContextPack
): NonNullable<DesktopAgentSessionResult["contextPack"]> {
  return {
    usageSummary: pack.usageSummary,
    items: pack.items.map((item) => ({
      ...item,
      summary: safeText(item.sourceKind === "system" ? "桌面基础 Agent 系统边界。" : item.summary, 320),
    })),
    budget: pack.budget,
    truncationReport: pack.truncationReport,
    truncated: pack.truncated,
  };
}

function createIntelligenceChannelFromOptions(
  aiMode: ModelRuntimeMode,
  options: RunDesktopAgentSessionOptions
): ((runtime: MinimalRuntime) => IntelligenceChannel) | undefined {
  if (aiMode === "none") {
    return undefined;
  }
  const config = createModelRuntimeConfig({
    mode: aiMode,
    env: options.aiEnvironment,
    fetch: options.providerFetch,
    onModelOutputDelta: options.onModelOutputDelta,
  });
  if (!config.enabled) {
    throw createModelRuntimeDisabledConfigurationError(config.summaryInput);
  }
  return config.createIntelligenceChannel;
}

function desktopAgentOutputContract(): ModelOutputContract {
  return {
    contractId: "desktop.agent_response.v1",
    outputKind: "explanation",
    format: "text",
    minTextLength: 1,
    maxTextLength: 12000,
    visibleOutput: {
      fields: ["text"],
      maxFieldLength: 1200,
    },
  };
}

function isRecoverableBudgetStop(_turn: Awaited<ReturnType<AgentTurnRuntime["execute"]>>): boolean {
  return false;
}

function visibleAnswerText(response: ModelResponse): string {
  return typeof response.textOutput === "string" && response.textOutput.trim().length > 0
    ? response.textOutput.trim()
    : typeof response.structuredOutput === "string" && response.structuredOutput.trim().length > 0
      ? response.structuredOutput.trim()
      : "";
}

function parseAnswer(
  response: ModelResponse,
  toolCalls: readonly ToolCallResult[]
): string {
  const text =
    typeof response.textOutput === "string" && response.textOutput.trim().length > 0
      ? response.textOutput.trim()
      : typeof response.structuredOutput === "string" && response.structuredOutput.trim().length > 0
        ? response.structuredOutput.trim()
      : undefined;
  if (text === undefined) {
    if (toolCalls.length > 0) {
      return "我已经调用了可用工具，但这轮没有形成可展示正文。你可以补充目标或打开详情查看工具调用状态。";
    }
    return "我现在没有形成可展示的回答。";
  }
  const visible = sanitizeVisibleAssistantAnswer(text);
  return visible.length > 0
    ? safeText(visible, 12000)
    : "我识别到这条消息需要更多上下文或授权，但当前回合没有形成可展示正文。";
}

function sanitizeVisibleAssistantAnswer(value: string): string {
  return sanitizeAssistantVisibleText(value);
}

function publishGoalReceived(input: {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly goal: string;
  readonly taskSoil: TaskSoil;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: "desktop-shell", role: "user" },
      to: { group: "desktop-shell" },
      type: "goal.received",
      intent: "start_desktop_agent_session",
      payload: {
        goalId: input.goalId,
        taskSoilId: input.taskSoil.taskSoilId,
        goalSummary: safeText(input.goal, 300),
        contextRefCount: input.taskSoil.contextRefs.length,
        permissionBoundaryRefs: input.taskSoil.permissionBoundaryRefs,
      },
    })
  );
}

function publishConfirmationRequested(input: {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly pendingConfirmation: DesktopAgentPendingConfirmation;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: DESKTOP_AGENT_ID, role: "agent" },
      to: { group: "desktop-shell" },
      type: "user_approval.requested",
      intent: "request_user_confirmation",
      payload: {
        confirmationId: input.pendingConfirmation.confirmationId,
        goalId: input.goalId,
        title: input.pendingConfirmation.title,
        question: input.pendingConfirmation.question,
        consequence: input.pendingConfirmation.consequence,
        riskLevel: input.pendingConfirmation.riskLevel,
        sourceRefs: input.pendingConfirmation.sourceRefs,
      },
    })
  );
}

function publishTriggeredSkills(input: {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly skills: readonly DesktopAgentSkillContext[];
}): void {
  for (const context of input.skills) {
    input.runtime.bus.publish(
      createMessage({
        traceId: input.traceId,
        from: { id: DESKTOP_AGENT_ID, role: "agent" },
        to: { group: "desktop-shell" },
        type: "skill.triggered",
        intent: "inject_desktop_agent_skill",
        payload: {
          goalId: input.goalId,
          skillId: context.skill.id,
          name: context.skill.name,
          triggerReason: safeText(context.triggerReason, 240),
          sourceRef: `skill:${context.skill.id}`,
        },
      })
    );
  }
}

function allowedToolsForDesktopAgent(toolCenter: ToolExecutionBroker): readonly string[] {
  // Ordinary desktop mode keeps Underground tools behind the explicit deep-mode boundary.
  return toolCenter.list().map((tool) => tool.name).filter((name) => !name.startsWith("underground_"));
}

function allowedToolsForRun(input: {
  readonly toolCenter: ToolExecutionBroker;
  readonly snapshot?: BasicAgentCapabilitySnapshot;
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly platform?: NodeJS.Platform;
}): readonly string[] {
  if (input.snapshot === undefined) {
    return allowedToolsForDesktopAgent(input.toolCenter);
  }
  return resolveRunCapabilities({
    snapshot: input.snapshot,
    goal: input.goal,
    runMode: "agent",
    taskSoil: input.taskSoil,
    platform: input.platform,
  }).allowedTools;
}

function refsFromResponse(
  response: ModelResponse | undefined,
  requestId: string | undefined,
  responseId: string | undefined,
): readonly string[] {
  return [
    requestId,
    response?.requestId,
    responseId,
    response?.responseId,
  ].filter((value, index, values): value is string => typeof value === "string" && values.indexOf(value) === index);
}

function refsFromToolCalls(toolCalls: readonly ToolCallResult[]): readonly string[] {
  return toolCalls.map((call) => call.callId);
}

function pendingConfirmationFrom(input: {
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly answer: string;
  readonly toolCalls: readonly ToolCallResult[];
  readonly traceId: string;
  readonly goalId: string;
  readonly modelCallRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
}): DesktopAgentPendingConfirmation | undefined {
  const approvalRequired = input.toolCalls.find((call) => call.status === "approval_required" && call.confirmationRequest !== undefined);
  if (approvalRequired?.confirmationRequest !== undefined) {
    const confirmation = approvalRequired.confirmationRequest;
    return {
      confirmationId: confirmation.confirmationId,
      title: confirmation.title,
      question: confirmation.actionSummary,
      consequence: "批准后只允许继续本次对应工具操作；拒绝则不会执行该动作。",
      riskLevel: confirmation.riskLevel,
      requestedAt: confirmation.requestedAt,
      modelCallRefs: input.modelCallRefs,
      toolCallRefs: [approvalRequired.callId],
      sourceRefs: confirmation.sourceRefs,
    };
  }
  return undefined;
}

function resultBlocksFrom(input: {
  readonly answer: string;
  readonly toolCalls: readonly ToolCallResult[];
  readonly evidenceRefs: readonly string[];
  readonly pendingConfirmation?: DesktopAgentPendingConfirmation;
}): readonly DesktopAgentResultBlock[] {
  const blocks: DesktopAgentResultBlock[] = [
    {
      blockId: createId("result-block"),
      kind: "answer",
      title: "结果",
      summary: safeText(input.answer, 1200),
      evidenceRefs: input.evidenceRefs.slice(0, 8),
      toolCallRefs: input.toolCalls.map((call) => call.callId),
    },
  ];
  if (input.toolCalls.length > 0) {
    const completed = input.toolCalls.filter((call) => call.status === "completed").length;
    const failed = input.toolCalls.filter((call) => call.status === "failed").length;
    const approvalRequired = input.toolCalls.filter((call) => call.status === "approval_required").length;
    blocks.push({
      blockId: createId("result-block"),
      kind: failed > 0 ? "failure" : "tool_summary",
      title: "工具摘要",
      summary: toolSummaryText(input.toolCalls, completed, failed, approvalRequired),
      evidenceRefs: input.evidenceRefs.slice(0, 8),
      toolCallRefs: input.toolCalls.map((call) => call.callId),
    });
  }
  if (input.pendingConfirmation !== undefined) {
    blocks.push({
      blockId: createId("result-block"),
      kind: "pending_confirmation",
      title: input.pendingConfirmation.title,
      summary: `${input.pendingConfirmation.question} ${input.pendingConfirmation.consequence}`,
      evidenceRefs: input.pendingConfirmation.sourceRefs,
      toolCallRefs: input.pendingConfirmation.toolCallRefs,
    });
  }
  return blocks;
}

function toolSummaryText(toolCalls: readonly ToolCallResult[], completed: number, failed: number, approvalRequired: number): string {
  const localSummaries = toolCalls
    .map((call) => {
      const output = asRecord(call.output);
      const action = stringOrUndefined(output.action);
      const summary = stringOrUndefined(output.summary);
      return action !== undefined && summary !== undefined ? `${action}: ${summary}` : undefined;
    })
    .filter((value): value is string => value !== undefined)
    .slice(0, 4);
  const base = `本轮工具调用 ${toolCalls.length} 次；完成 ${completed} 次，失败 ${failed} 次，需要确认 ${approvalRequired} 次。工具输出只作为安全摘要和引用进入回答。`;
  return localSummaries.length === 0 ? base : `${base}\n${localSummaries.join("\n")}`;
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

function evidenceRefsFromToolCalls(toolCalls: readonly ToolCallResult[]): readonly string[] {
  const refs: string[] = [];
  for (const call of toolCalls) {
    if (call.status !== "completed") {
      continue;
    }
    refs.push(`tool:${call.callId}`);
    const output = asRecord(call.output);
    const outputRef = stringOrUndefined(output.refId);
    if (outputRef !== undefined) {
      refs.push(safeText(outputRef, 180));
    }
    const results = Array.isArray(output.results) ? output.results : [];
    for (const result of results) {
      const item = asRecord(result);
      const ref = stringOrUndefined(item.refId) ?? stringOrUndefined(item.uri) ?? stringOrUndefined(item.title);
      if (ref !== undefined) {
        refs.push(safeText(ref, 180));
      }
    }
  }
  return unique(refs).slice(0, 12);
}

function activityFromEventEntries(
  entries: readonly EventLogEntry[],
  terminalStatus: DesktopAgentSessionStatus
): readonly DesktopAgentActivity[] {
  const activities = entries.flatMap(activityFromEventEntry);
  const terminal = terminalActivity(entries.at(-1), terminalStatus);
  return terminal === undefined ? activities : [...activities, terminal];
}

function activityFromEventEntry(entry: EventLogEntry): readonly DesktopAgentActivity[] {
  const payload = asRecord(entry.message.payload);
  const sourceRefs = [`event:${entry.message.id}`];
  switch (entry.type) {
    case "goal.received":
      return [activity(entry, "task_received", "任务已接收", "已形成本轮任务和授权上下文边界。", "completed", sourceRefs)];
    case "model.requested":
      return [
        activity(
          entry,
          "model_requested",
          "正在判断",
          "桌面 Agent 正在判断直接回答、读取材料或请求确认。",
          "running",
          sourceRefs,
          refsFromPayload(payload),
        ),
      ];
    case "model.completed":
      return [
        activity(
          entry,
          "model_completed",
          "内容已形成",
          "模型输出已通过安全可见投影进入本轮结果。",
          "completed",
          sourceRefs,
          refsFromPayload(payload),
        ),
      ];
    case "model.failed":
      return [
        activity(
          entry,
          "model_failed",
          "模型调用失败",
          "模型服务没有返回可用结果；错误已脱敏。",
          "failed",
          sourceRefs,
          refsFromPayload(payload),
        ),
      ];
    case "tool.requested":
    case "tool.completed":
    case "tool.failed": {
      const toolName = stringOrUndefined(payload.toolName) ?? "tool";
      const output = asRecord(payload.output);
      const input = asRecord(payload.input);
      const result = asRecord(output.result);
      const type =
        entry.type === "tool.requested"
          ? "tool_requested"
          : entry.type === "tool.completed"
            ? "tool_completed"
            : "tool_failed";
      return [
        activity(
          entry,
          type,
          entry.type === "tool.requested" ? toolActivityTitle(toolName, "start") : entry.type === "tool.completed" ? toolActivityTitle(toolName, "completed") : toolActivityTitle(toolName, "failed"),
          entry.type === "tool.completed"
            ? completedToolActivitySummary(toolName, payload)
            : entry.type === "tool.failed"
              ? `工具 ${toolName} 失败，错误已脱敏。`
              : `工具 ${toolName} 开始执行。`,
          entry.type === "tool.requested" ? "running" : entry.type === "tool.completed" ? "completed" : "failed",
          sourceRefs,
          [],
          stringOrUndefined(payload.callId) === undefined ? [] : [stringOrUndefined(payload.callId) as string],
          toolName,
          {
            action: stringOrUndefined(output.action) ?? toolName,
            path: stringOrUndefined(result.path) ?? stringOrUndefined(input.path),
            truncated: output.truncated === true,
            error: stringOrUndefined(payload.error),
          },
        ),
      ];
    }
    case "user_approval.requested":
      return [
        activity(
          entry,
          "confirmation_needed",
          "需要确认",
          stringOrUndefined(payload.question) ?? "继续前需要你补充授权或澄清。",
          "running",
          sourceRefs,
        ),
      ];
    default:
      return [];
  }
}

function toolActivityTitle(toolName: string, phase: "start" | "completed" | "failed"): string {
  if (toolName === "read_file") return phase === "start" ? "正在读取文件" : phase === "completed" ? "文件已读取" : "文件读取失败";
  if (toolName === "list_dir") return phase === "start" ? "正在列出目录" : phase === "completed" ? "目录已列出" : "目录列出失败";
  if (toolName === "grep_files") return phase === "start" ? "正在搜索文件" : phase === "completed" ? "搜索已完成" : "搜索失败";
  if (toolName === "write_file") return phase === "start" ? "正在写入文件" : phase === "completed" ? "文件已写入" : "文件写入失败";
  if (toolName === "create_file") return phase === "start" ? "正在创建文件" : phase === "completed" ? "文件已创建" : "文件创建失败";
  if (toolName === "edit_file") return phase === "start" ? "正在编辑文件" : phase === "completed" ? "文件已编辑" : "文件编辑失败";
  if (toolName === "delete_file") return phase === "start" ? "正在删除文件" : phase === "completed" ? "文件已删除" : "文件删除失败";
  if (toolName === "run_command") return phase === "start" ? "正在执行命令" : phase === "completed" ? "命令已执行" : "命令执行失败";
  if (toolName === "shell_command") return phase === "start" ? "正在执行 Shell" : phase === "completed" ? "Shell 已执行" : "Shell 执行失败";
  if (toolName === "browser_snapshot") return phase === "start" ? "正在浏览网页" : phase === "completed" ? "网页已浏览" : "网页浏览失败";
  if (toolName === "search") return phase === "start" ? "正在搜索材料" : phase === "completed" ? "搜索已完成" : "搜索失败";
  if (toolName === "read") return phase === "start" ? "正在读取材料" : phase === "completed" ? "材料已读取" : "材料读取失败";
  return phase === "start" ? "正在执行工具" : phase === "completed" ? "工具已完成" : "工具执行失败";
}

function completedToolActivitySummary(toolName: string, payload: Readonly<Record<string, unknown>>): string {
  const output = asRecord(payload.output);
  const summary = stringOrUndefined(output.summary);
  if (summary !== undefined) {
    return summary;
  }
  return `工具 ${toolName} 已返回安全摘要。`;
}

function terminalActivity(
  lastEntry: EventLogEntry | undefined,
  status: DesktopAgentSessionStatus
): DesktopAgentActivity | undefined {
  const createdAt = lastEntry?.recordedAt ?? nowIso();
  const activityId = lastEntry === undefined ? createId("activity") : `${lastEntry.message.id}:terminal:${status}`;
  if (status === "completed") {
    return {
      activityId,
      type: "completed",
      title: "运行完成",
      summary: "本轮桌面 Agent 结果已形成。",
      status: "completed",
      createdAt,
      sourceRefs: lastEntry === undefined ? [] : [`event:${lastEntry.message.id}`],
      modelCallRefs: [],
      toolCallRefs: [],
    };
  }
  if (status === "confirmation_needed") {
    return {
      activityId,
      type: "confirmation_needed",
      title: "等待确认",
      summary: "需要用户补充授权或具体材料后再继续。",
      status: "running",
      createdAt,
      sourceRefs: lastEntry === undefined ? [] : [`event:${lastEntry.message.id}`],
      modelCallRefs: [],
      toolCallRefs: [],
    };
  }
  if (status === "stopped") {
    return {
      activityId,
      type: "stopped",
      title: "运行已停止",
      summary: "AI 运行时未配置，本轮没有开始模型工作。",
      status: "failed",
      createdAt,
      sourceRefs: lastEntry === undefined ? [] : [`event:${lastEntry.message.id}`],
      modelCallRefs: [],
      toolCallRefs: [],
    };
  }
  if (status === "paused") {
    return {
      activityId,
      type: "stopped",
      title: "运行中断",
      summary: "运行被异常保护中断，尚未形成最终回答。",
      status: "pending",
      createdAt,
      sourceRefs: lastEntry === undefined ? [] : [`event:${lastEntry.message.id}`],
      modelCallRefs: [],
      toolCallRefs: [],
    };
  }
  return {
    activityId,
    type: "failed",
    title: "运行失败",
    summary: "本轮没有形成可展示结果。",
    status: "failed",
    createdAt,
    sourceRefs: lastEntry === undefined ? [] : [`event:${lastEntry.message.id}`],
    modelCallRefs: [],
    toolCallRefs: [],
  };
}

function activity(
  entry: EventLogEntry,
  type: DesktopAgentActivity["type"],
  title: string,
  summary: string,
  status: DesktopAgentActivity["status"],
  sourceRefs: readonly string[],
  modelCallRefs: readonly string[] = [],
  toolCallRefs: readonly string[] = [],
  toolName?: string,
  toolDetail: Pick<DesktopAgentActivity, "action" | "path" | "truncated" | "error"> = {}
): DesktopAgentActivity {
  return {
    activityId: `${entry.message.id}:${type}`,
    type,
    title,
    summary,
    status,
    createdAt: entry.recordedAt,
    action: toolDetail.action,
    path: toolDetail.path,
    truncated: toolDetail.truncated,
    error: toolDetail.error,
    toolName,
    sourceRefs,
    modelCallRefs,
    toolCallRefs,
  };
}

function refsFromPayload(payload: Readonly<Record<string, unknown>>): readonly string[] {
  return unique([stringOrUndefined(payload.requestId), stringOrUndefined(payload.responseId)].filter(isString));
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

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function constraintRefsFromTaskSoil(taskSoil: TaskSoil): readonly ConstraintRef[] {
  const constraintRefs = taskSoil.constraints.map((constraint): ConstraintRef => ({
    constraintId: constraint.id,
    requiredLevel: constraint.level,
    enforcementGate: constraint.enforcementGate,
  }));
  const permissionRefs = taskSoil.permissionBoundaryRefs.map((permission): ConstraintRef => ({
    constraintId: permission,
    requiredLevel: "hard",
    enforcementGate: "tool_execution",
  }));
  return [...constraintRefs, ...permissionRefs];
}

function safeText(value: string, maxLength: number): string {
  const text = value.trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}
