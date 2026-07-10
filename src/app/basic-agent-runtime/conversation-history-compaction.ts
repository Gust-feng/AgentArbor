import type { ModelMessage } from "../../domain/intelligence/index.js";
import { createId, nowIso } from "../../kernel/id.js";
import type { DesktopAgentConversationMessage } from "../desktop-agent/desktop-agent-contracts.js";
import { normalizeModelFacingText } from "../visible-text-safety.js";
import {
  clampRatio,
  compactionAgentDisplayName,
  conversationCompactionOutputContract,
  DEFAULT_THRESHOLD_RATIO,
  inputTokenBudgetFor,
} from "./conversation-compaction-common.js";
import type {
  BasicAgentConversationCompactionResult,
  CompactBasicAgentConversationInput,
} from "./conversation-compaction-contracts.js";
import { createOpenAITokenCounter } from "./token-counter.js";

const DEFAULT_RECENT_PAIRS = 4;
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
      // Model-facing: preserve internal whitespace/indentation so code, stdout,
      // and JSON in earlier turns keep their structure when fed to the compaction model.
      safeContent: normalizeModelFacingText(message.content),
    }))
    .filter((entry) => entry.safeContent.trim().length > 0);
  const historyTokens = tokenCounter.countMessages(
    safeHistory.map((entry) => ({ role: entry.message.role, content: entry.safeContent }))
  );
  const inputTokenBudget = inputTokenBudgetFor(input.modelCapabilities);
  const threshold = Math.max(1_000, Math.floor(inputTokenBudget * clampRatio(input.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO)));
  if (historyTokens < threshold) {
    return {
      conversationHistory: input.conversationHistory,
      compacted: false,
      tokenCount: historyTokens,
      threshold,
    };
  }

  const earlier = safeHistory.slice(0, Math.max(0, safeHistory.length - recentMessageCount));
  const recent = safeHistory.slice(Math.max(0, safeHistory.length - recentMessageCount));
  if (earlier.length === 0) {
    return {
      conversationHistory: recent.map((entry) => entry.message),
      compacted: false,
      tokenCount: historyTokens,
      threshold,
    };
  }

  const requestId = createId("model-request");
  const response = await input.intelligenceChannel.request({
    requestId,
    traceId: input.traceId,
    callerRef: { kind: "goal", id: input.goalId, label: "desktop_context_compaction" },
    purpose: "desktop_context_compaction",
    inputRefs: earlier.map((entry) => ({ kind: "event" as const, id: entry.message.ref ?? `conversation:history:${entry.index}` })),
    sanitizedMessages: compactionMessages({
      goal: input.goal,
      agentDisplayName: compactionAgentDisplayName(input.agentIdentity),
      earlier,
    }),
    outputContract: conversationCompactionOutputContract(),
    constraintRefs: [],
    budget: {
      maxOutputTokens: Math.min(input.modelCapabilities?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS),
    },
    sensitivity: "internal",
    requestedAt: nowIso(),
  });

  if (response.status !== "completed") {
    return {
      conversationHistory: input.conversationHistory,
      compacted: false,
      tokenCount: historyTokens,
      threshold,
      failed: {
        message: response.failure?.message ?? "Conversation compaction model call failed.",
        requestId,
        responseId: response.responseId,
      },
    };
  }

  const summaryText = normalizeModelFacingText(
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
      tokenCount: historyTokens,
      threshold,
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
    tokenCount: historyTokens,
    threshold,
  };
}

function compactionMessages(input: {
  readonly goal: string;
  readonly agentDisplayName: string;
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
        `You compact earlier conversation history for ${input.agentDisplayName}, the ordinary desktop agent for this run.`,
        "Preserve user goals, durable decisions, constraints, unresolved tasks, evidence refs, and useful continuity.",
        "Preserve concrete conversation facts, tool results, errors, stdout/stderr, file paths, and development context that may be needed to continue.",
        "Do not decide whether the task is complete. Do not instruct the agent to stop. Return concise plain text only.",
      ].join("\n"),
      ref: "prompt:desktop.context_compaction.v1",
    },
    {
      role: "user",
      content: [
        `Current user message: ${normalizeModelFacingText(input.goal)}`,
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
