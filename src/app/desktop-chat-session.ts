import type { IntelligenceChannel, ModelOutputContract, ModelOutputDelta, ModelResponse } from "../domain/intelligence/index.js";
import type { ObservationRef } from "../domain/observation/index.js";
import type { TaskSoil } from "../domain/soil/index.js";
import type { ToolCallRequest, ToolDefinition } from "../domain/tools/index.js";
import { createId, nowIso } from "../kernel/id.js";
import { createMessage } from "../kernel/messages/create-message.js";
import {
  createUndergroundAiDisabledConfigurationError,
  createUndergroundAiRuntimeConfig,
  type UndergroundAiEnvironment,
  type UndergroundAiMode,
  type UndergroundAiProviderFetch,
} from "./intelligence-channel-factory.js";
import type { MinimalRuntime } from "./runtime.js";
import { createMinimalRuntime } from "./runtime.js";
import { createTaskSoilFromDesktopInput, type DesktopTaskSoilInput } from "./task-soil-workspace.js";

export type DesktopChatSessionStatus = "answered" | "upgrade_requested" | "stopped" | "failed";

export type DesktopChatAnswer = {
  readonly answer: string;
  readonly modelCallRefs: readonly string[];
};

export type DesktopChatUpgradeRequest = {
  readonly goal: string;
  readonly reason: string;
  readonly modelCallRefs: readonly string[];
};

export type DesktopChatSessionResult = {
  readonly status: DesktopChatSessionStatus;
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly taskSoil: TaskSoil;
  readonly answer?: DesktopChatAnswer;
  readonly upgradeRequest?: DesktopChatUpgradeRequest;
  readonly failureMessage?: string;
  readonly modelCallRefs: readonly string[];
  readonly eventTypes: readonly string[];
};

export type DesktopChatSessionRuntimeContext = {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
};

export type RunDesktopChatSessionOptions = {
  readonly aiMode?: UndergroundAiMode;
  readonly aiEnvironment?: UndergroundAiEnvironment;
  readonly providerFetch?: UndergroundAiProviderFetch;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly runtime?: MinimalRuntime;
  readonly createIntelligenceChannel?: (runtime: MinimalRuntime) => IntelligenceChannel;
  readonly onRuntimeReady?: (context: DesktopChatSessionRuntimeContext) => void;
  readonly onModelOutputDelta?: (delta: ModelOutputDelta) => void;
};

const DESKTOP_ASSISTANT_ID = "desktop-chat-session";
const START_WORK_SESSION_TOOL = "start_work_session";

export async function runDesktopChatSession(
  goal: string,
  options: RunDesktopChatSessionOptions = {}
): Promise<DesktopChatSessionResult> {
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
      failureMessage: "AI runtime is not configured; Desktop Chat Session stopped before answering.",
      modelCallRefs: [],
      eventTypes: runtime.eventLog.types(),
    };
  }

  const channel = intelligenceChannel(runtime);
  const response = await channel.request({
    requestId: createId("model-request"),
    traceId,
    callerRef: { kind: "goal", id: goalId, label: "desktop_chat" },
    purpose: "desktop_chat",
    inputRefs: baseInputRefs(traceId, goalId),
    sanitizedMessages: desktopChatMessages({ goal, taskSoil }),
    tools: [startWorkSessionToolDefinition()],
    toolChoice: "auto",
    outputContract: desktopChatOutputContract(),
    constraintRefs: [],
    budget: {
      maxOutputTokens: 900,
      maxLatencyMs: 30_000,
    },
    sensitivity: "internal",
    requestedAt: nowIso(),
  });

  const modelCallRefs = refsFromResponse(response);
  if (response.status !== "completed") {
    return {
      status: "failed",
      runtime,
      traceId,
      goalId,
      taskSoil,
      failureMessage: response.failure?.message ?? "Desktop assistant model call failed.",
      modelCallRefs,
      eventTypes: runtime.eventLog.types(),
    };
  }

  const upgrade = upgradeRequestFrom(response.toolCalls, goal);
  if (upgrade !== undefined) {
    return {
      status: "upgrade_requested",
      runtime,
      traceId,
      goalId,
      taskSoil,
      upgradeRequest: {
        ...upgrade,
        modelCallRefs,
      },
      modelCallRefs,
      eventTypes: runtime.eventLog.types(),
    };
  }

  const answer = parseAnswer(response);
  return {
    status: "answered",
    runtime,
    traceId,
    goalId,
    taskSoil,
    answer: {
      answer,
      modelCallRefs,
    },
    modelCallRefs,
    eventTypes: runtime.eventLog.types(),
  };
}

function createIntelligenceChannelFromOptions(
  aiMode: UndergroundAiMode,
  options: RunDesktopChatSessionOptions
): ((runtime: MinimalRuntime) => IntelligenceChannel) | undefined {
  if (aiMode === "none") {
    return undefined;
  }
  const config = createUndergroundAiRuntimeConfig({
    mode: aiMode,
    env: options.aiEnvironment,
    fetch: options.providerFetch,
    onModelOutputDelta: options.onModelOutputDelta,
  });
  if (!config.enabled) {
    throw createUndergroundAiDisabledConfigurationError(config.summaryInput);
  }
  return config.createIntelligenceChannel;
}

function desktopChatMessages(input: {
  readonly goal: string;
  readonly taskSoil: TaskSoil;
}): readonly { readonly role: "system" | "user"; readonly content: string; readonly ref?: string }[] {
  return [
    {
      role: "system",
      content: [
        "You are AgentArbor, a desktop assistant. First behave like a normal helpful assistant, not like an internal workflow.",
        "Answer ordinary questions directly in the user's language.",
        `If the request needs workspace reading, tools, child agents, multi-step analysis, report generation, file changes, or a reviewable artifact, call the ${START_WORK_SESSION_TOOL} tool instead of pretending to have completed the work.`,
        "Do not expose raw prompts, hidden reasoning, provider internals, or internal architecture terms unless the user asks for developer diagnostics.",
      ].join("\n"),
      ref: "prompt:desktop.chat_response.v1",
    },
    {
      role: "user",
      content: [
        `User message: ${safeText(input.goal, 1200)}`,
        `Context refs: ${input.taskSoil.contextRefs.map((ref) => `${ref.kind}:${ref.ref}`).join("; ") || "none"}`,
        `Permission refs: ${input.taskSoil.permissionBoundaryRefs.join("; ") || "none"}`,
      ].join("\n"),
      ref: `goal:${input.taskSoil.goalId}`,
    },
  ];
}

function desktopChatOutputContract(): ModelOutputContract {
  return {
    contractId: "desktop.chat_response.v1",
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

function startWorkSessionToolDefinition(): ToolDefinition {
  return {
    name: START_WORK_SESSION_TOOL,
    description:
      "Request an upgrade from ordinary desktop chat into a multi-step work session for workspace reading, tools, child agents, reports, or artifacts.",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string" },
        goal: { type: "string" },
      },
      required: ["reason"],
    },
  };
}

function upgradeRequestFrom(
  toolCalls: readonly ToolCallRequest[] | undefined,
  fallbackGoal: string
): Omit<DesktopChatUpgradeRequest, "modelCallRefs"> | undefined {
  const call = toolCalls?.find((item) => item.toolName === START_WORK_SESSION_TOOL);
  if (call === undefined) {
    return undefined;
  }
  const input = asRecord(call.input);
  return {
    goal: safeText(stringOrUndefined(input.goal) ?? fallbackGoal, 1200),
    reason: safeText(stringOrUndefined(input.reason) ?? "需要进入工作会话处理。", 600),
  };
}

function parseAnswer(response: ModelResponse): string {
  const text =
    typeof response.textOutput === "string" && response.textOutput.trim().length > 0
      ? response.textOutput.trim()
      : typeof response.structuredOutput === "string" && response.structuredOutput.trim().length > 0
        ? response.structuredOutput.trim()
        : undefined;
  if (text === undefined) {
    return "我现在没有形成可展示的回答。";
  }
  return safeText(text, 12000);
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
      intent: "start_desktop_chat_session",
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

function baseInputRefs(traceId: string, goalId: string): readonly ObservationRef[] {
  return [
    { kind: "trace", id: traceId },
    { kind: "goal", id: goalId },
  ];
}

function refsFromResponse(response: ModelResponse): readonly string[] {
  return [response.requestId, response.responseId].filter((value): value is string => typeof value === "string");
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

function safeText(value: string, maxLength: number): string {
  const text = value.trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}
