import type { ModelOutputContract, IntelligenceChannel, ModelMessage } from "../../domain/intelligence/index.js";
import type { ModelCapabilities } from "../../domain/config/index.js";
import { createId, nowIso } from "../../kernel/id.js";
import { sanitizeConversationHistoryText } from "../visible-text-safety.js";
import type { DesktopAgentConversationMessage } from "../desktop-agent-session.js";
import { createOpenAITokenCounter, type BasicAgentTokenCounter } from "./token-counter.js";

export type BasicAgentConversationSummary = {
  readonly summaryId: string;
  readonly summary: string;
  readonly coveredRefs: readonly string[];
  readonly modelRequestId: string;
  readonly modelResponseId?: string;
};

export type BasicAgentConversationCompactionResult = {
  readonly conversationHistory: readonly DesktopAgentConversationMessage[];
  readonly conversationSummary?: BasicAgentConversationSummary;
  readonly compacted: boolean;
  readonly failed?: {
    readonly message: string;
    readonly requestId?: string;
    readonly responseId?: string;
  };
};

export type CompactBasicAgentConversationInput = {
  readonly goal: string;
  readonly traceId: string;
  readonly goalId: string;
  readonly conversationHistory: readonly DesktopAgentConversationMessage[];
  readonly intelligenceChannel: IntelligenceChannel;
  readonly modelCapabilities?: ModelCapabilities;
  readonly tokenCounter?: BasicAgentTokenCounter;
  readonly thresholdRatio?: number;
  readonly recentPairs?: number;
};

const DEFAULT_RECENT_PAIRS = 4;
const DEFAULT_THRESHOLD_RATIO = 0.7;
const DEFAULT_INPUT_TOKEN_BUDGET = 4_500;
const DEFAULT_MAX_OUTPUT_TOKENS = 1_200;

export async function compactBasicAgentConversationIfNeeded(
  input: CompactBasicAgentConversationInput
): Promise<BasicAgentConversationCompactionResult> {
  const recentMessageCount = Math.max(1, Math.floor(input.recentPairs ?? DEFAULT_RECENT_PAIRS)) * 2;
  if (input.conversationHistory.length <= recentMessageCount) {
    return { conversationHistory: input.conversationHistory, compacted: false };
  }

  const tokenCounter = input.tokenCounter ?? createOpenAITokenCounter();
  const safeHistory = input.conversationHistory
    .map((message, index) => ({
      message,
      index,
      safeContent: sanitizeConversationHistoryText(message.content),
    }))
    .filter((entry) => entry.safeContent.trim().length > 0);
  const historyTokens = tokenCounter.countMessages(
    safeHistory.map((entry) => ({ role: entry.message.role, content: entry.safeContent }))
  );
  const inputTokenBudget = inputTokenBudgetFor(input.modelCapabilities);
  const threshold = Math.max(1_000, Math.floor(inputTokenBudget * clampRatio(input.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO)));
  if (historyTokens < threshold) {
    return { conversationHistory: input.conversationHistory, compacted: false };
  }

  const earlier = safeHistory.slice(0, Math.max(0, safeHistory.length - recentMessageCount));
  const recent = safeHistory.slice(Math.max(0, safeHistory.length - recentMessageCount));
  if (earlier.length === 0) {
    return { conversationHistory: recent.map((entry) => entry.message), compacted: false };
  }

  const requestId = createId("model-request");
  const response = await input.intelligenceChannel.request({
    requestId,
    traceId: input.traceId,
    callerRef: { kind: "goal", id: input.goalId, label: "desktop_context_compaction" },
    purpose: "desktop_context_compaction",
    inputRefs: earlier.map((entry) => ({ kind: "event" as const, id: entry.message.ref ?? `conversation:history:${entry.index}` })),
    sanitizedMessages: compactionMessages({ goal: input.goal, earlier }),
    outputContract: conversationCompactionOutputContract(),
    constraintRefs: [],
    budget: {
      maxOutputTokens: Math.min(input.modelCapabilities?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS),
      maxLatencyMs: 60_000,
    },
    sensitivity: "internal",
    requestedAt: nowIso(),
  });

  if (response.status !== "completed") {
    return {
      conversationHistory: input.conversationHistory,
      compacted: false,
      failed: {
        message: response.failure?.message ?? "Conversation compaction model call failed.",
        requestId,
        responseId: response.responseId,
      },
    };
  }

  const summaryText = sanitizeConversationHistoryText(
    typeof response.textOutput === "string" && response.textOutput.trim().length > 0
      ? response.textOutput
      : typeof response.structuredOutput === "string"
        ? response.structuredOutput
        : ""
  ).trim();
  if (summaryText.length === 0) {
    return {
      conversationHistory: input.conversationHistory,
      compacted: false,
      failed: {
        message: "Conversation compaction returned an empty summary.",
        requestId,
        responseId: response.responseId,
      },
    };
  }

  return {
    conversationHistory: recent.map((entry) => entry.message),
    conversationSummary: {
      summaryId: createId("conversation-summary"),
      summary: summaryText,
      coveredRefs: earlier.map((entry) => entry.message.ref ?? `conversation:history:${entry.index}`),
      modelRequestId: requestId,
      modelResponseId: response.responseId,
    },
    compacted: true,
  };
}

function compactionMessages(input: {
  readonly goal: string;
  readonly earlier: readonly {
    readonly message: DesktopAgentConversationMessage;
    readonly index: number;
    readonly safeContent: string;
  }[];
}): readonly ModelMessage[] {
  return [
    {
      role: "system",
      content: [
        "You compact earlier conversation history for AgentArbor's ordinary desktop agent.",
        "Preserve user goals, durable decisions, constraints, unresolved tasks, evidence refs, and useful continuity.",
        "Remove raw prompts, raw provider responses, raw tool output, stdout/stderr, secrets, tokens, hidden reasoning, and internal loop details.",
        "Do not decide whether the task is complete. Do not instruct the agent to stop. Return concise plain text only.",
      ].join("\n"),
      ref: "prompt:desktop.context_compaction.v1",
    },
    {
      role: "user",
      content: [
        `Current user message: ${sanitizeConversationHistoryText(input.goal)}`,
        "Earlier conversation to compact:",
        ...input.earlier.map((entry) => {
          const role = entry.message.role === "assistant" ? "assistant" : "user";
          const ref = entry.message.ref ?? `conversation:history:${entry.index}`;
          return `- [${ref}] ${role}: ${entry.safeContent}`;
        }),
      ].join("\n"),
      ref: "context:conversation-compaction:input",
    },
  ];
}

function conversationCompactionOutputContract(): ModelOutputContract {
  return {
    contractId: "desktop.context_compaction.v1",
    outputKind: "explanation",
    format: "text",
    minTextLength: 1,
    maxTextLength: 6000,
    visibleOutput: {
      fields: ["text"],
      maxFieldLength: 1200,
    },
  };
}

function inputTokenBudgetFor(capabilities: ModelCapabilities | undefined): number {
  if (capabilities === undefined) {
    return DEFAULT_INPUT_TOKEN_BUDGET;
  }
  const reservedOutputTokens = Math.max(512, Math.min(capabilities.maxOutputTokens, Math.floor(capabilities.contextWindowTokens * 0.25)));
  const safetyMargin = Math.max(512, Math.floor(capabilities.contextWindowTokens * 0.05));
  return Math.max(1_000, capabilities.contextWindowTokens - reservedOutputTokens - safetyMargin);
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_THRESHOLD_RATIO;
  }
  return Math.min(0.95, Math.max(0.1, value));
}
