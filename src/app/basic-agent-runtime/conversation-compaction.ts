import type { ModelOutputContract, IntelligenceChannel, ModelMessage } from "../../domain/intelligence/index.js";
import type { ModelCapabilities } from "../../domain/config/index.js";
import type { ToolDefinition } from "../../domain/tools/index.js";
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

export type BasicAgentLoopContextCompactionResult =
  | {
      readonly status: "unchanged";
      readonly tokenCount: number;
      readonly threshold: number;
    }
  | {
      readonly status: "compacted";
      readonly tokenCount: number;
      readonly threshold: number;
      readonly messages: readonly ModelMessage[];
      readonly conversationSummary: BasicAgentConversationSummary;
    }
  | {
      readonly status: "failed";
      readonly tokenCount: number;
      readonly threshold: number;
      readonly message: string;
      readonly requestId?: string;
      readonly responseId?: string;
    };

export type CompactBasicAgentLoopContextInput = {
  readonly goal: string;
  readonly traceId: string;
  readonly goalId: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolDefinition[];
  readonly intelligenceChannel: IntelligenceChannel;
  readonly modelCapabilities?: ModelCapabilities;
  readonly tokenCounter?: BasicAgentTokenCounter;
  readonly thresholdRatio?: number;
  readonly preserveRecentMessages?: number;
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
const DEFAULT_THRESHOLD_RATIO = 0.8;
const DEFAULT_INPUT_TOKEN_BUDGET = 4_500;
const DEFAULT_MAX_OUTPUT_TOKENS = 1_200;
const DEFAULT_PRESERVE_RECENT_MESSAGES = 10;
const MAX_COMPACTION_OUTPUT_TOKENS = 2_000;

export async function compactBasicAgentLoopContextIfNeeded(
  input: CompactBasicAgentLoopContextInput
): Promise<BasicAgentLoopContextCompactionResult> {
  const tokenCounter = input.tokenCounter ?? createOpenAITokenCounter();
  const tokenCount = loopContextTokenCount(tokenCounter, input.messages, input.tools);
  const threshold = loopContextThreshold(input.modelCapabilities, input.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO);
  if (tokenCount < threshold) {
    return { status: "unchanged", tokenCount, threshold };
  }

  const split = splitLoopMessagesForCompaction(input.messages, input.preserveRecentMessages ?? DEFAULT_PRESERVE_RECENT_MESSAGES);
  if (split.compactible.length === 0) {
    return { status: "unchanged", tokenCount, threshold };
  }

  const requestId = createId("model-request");
  const response = await input.intelligenceChannel.request({
    requestId,
    traceId: input.traceId,
    callerRef: { kind: "goal", id: input.goalId, label: "desktop_context_compaction" },
    purpose: "desktop_context_compaction",
    inputRefs: split.compactible.map((entry) => ({ kind: "event" as const, id: entry.message.ref ?? `loop-context:${entry.index}` })),
    sanitizedMessages: loopCompactionMessages({ goal: input.goal, compactible: split.compactible }),
    outputContract: conversationCompactionOutputContract(),
    constraintRefs: [],
    budget: {
      maxOutputTokens: Math.min(input.modelCapabilities?.maxOutputTokens ?? MAX_COMPACTION_OUTPUT_TOKENS, MAX_COMPACTION_OUTPUT_TOKENS),
      maxLatencyMs: 60_000,
    },
    sensitivity: "internal",
    requestedAt: nowIso(),
    toolChoice: "none",
    tools: [],
  });

  if (response.status !== "completed") {
    return {
      status: "failed",
      tokenCount,
      threshold,
      message: response.failure?.message ?? "Context compaction model call failed.",
      requestId,
      responseId: response.responseId,
    };
  }

  const promptText = sanitizeConversationHistoryText(
    typeof response.textOutput === "string" && response.textOutput.trim().length > 0
      ? response.textOutput
      : typeof response.structuredOutput === "string"
        ? response.structuredOutput
        : ""
  ).trim();
  if (promptText.length === 0) {
    return {
      status: "failed",
      tokenCount,
      threshold,
      message: "Context compaction returned an empty continuation prompt.",
      requestId,
      responseId: response.responseId,
    };
  }

  const summary: BasicAgentConversationSummary = {
    summaryId: createId("conversation-summary"),
    summary: promptText,
    coveredRefs: split.compactible.map((entry) => entry.message.ref ?? `loop-context:${entry.index}`),
    modelRequestId: requestId,
    modelResponseId: response.responseId,
  };
  return {
    status: "compacted",
    tokenCount,
    threshold,
    conversationSummary: summary,
    messages: assembleCompactedLoopMessages(input.messages, split.preservedIndexes, summary),
  };
}

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

function loopCompactionMessages(input: {
  readonly goal: string;
  readonly compactible: readonly {
    readonly message: ModelMessage;
    readonly index: number;
  }[];
}): readonly ModelMessage[] {
  return [
    {
      role: "system",
      content: [
        "You compact earlier safe context for AgentArbor's ordinary desktop agent.",
        "Return exactly one Markdown continuation prompt. Do not return JSON.",
        "Preserve still-relevant goals, user constraints, progress, decisions, next actions, errors, evidence refs, and file paths.",
        "Remove raw prompts, raw provider responses, raw tool output, stdout/stderr, secrets, tokens, hidden reasoning, and internal loop details.",
        "Do not decide whether the task is complete. Do not instruct the agent to stop.",
        "",
        "Use this section order:",
        "## Goal",
        "## Constraints & Preferences",
        "## Progress",
        "### Done",
        "### In Progress",
        "### Blocked",
        "## Key Decisions",
        "## Next Steps",
        "## Critical Context",
        "## Relevant Files",
      ].join("\n"),
      ref: "prompt:desktop.context_compaction.v1",
    },
    {
      role: "user",
      content: [
        `Current user request: ${sanitizeConversationHistoryText(input.goal)}`,
        "Context to compact:",
        ...input.compactible.map((entry) => serializeLoopMessageForCompaction(entry.message, entry.index)),
        "",
        "Write the continuation prompt so the main agent can continue the same task from the preserved recent messages.",
      ].join("\n"),
      ref: "context:loop-compaction:input",
    },
  ];
}

function splitLoopMessagesForCompaction(
  messages: readonly ModelMessage[],
  preserveRecentMessages: number
): {
  readonly compactible: readonly { readonly message: ModelMessage; readonly index: number }[];
  readonly preservedIndexes: ReadonlySet<number>;
} {
  const preserved = new Set<number>();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== "system") {
      break;
    }
    preserved.add(index);
  }
  const currentUserIndex = findCurrentUserMessageIndex(messages);
  if (currentUserIndex !== undefined) {
    preserved.add(currentUserIndex);
  }
  const recentCount = Math.max(2, Math.floor(preserveRecentMessages));
  for (let index = Math.max(0, messages.length - recentCount); index < messages.length; index += 1) {
    preserved.add(index);
  }
  preserveUnclosedToolPairs(messages, preserved);
  const compactible = messages
    .map((message, index) => ({ message, index }))
    .filter((entry) => !preserved.has(entry.index));
  return { compactible, preservedIndexes: preserved };
}

function findCurrentUserMessageIndex(messages: readonly ModelMessage[]): number | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && (message.ref?.startsWith("context:goal:") === true || message.content.includes("Current user message:"))) {
      return index;
    }
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }
  return undefined;
}

function preserveUnclosedToolPairs(messages: readonly ModelMessage[], preserved: Set<number>): void {
  const toolResultIndexes = new Map<string, number[]>();
  messages.forEach((message, index) => {
    if (message.role === "tool" && message.toolCallId !== undefined) {
      toolResultIndexes.set(message.toolCallId, [...(toolResultIndexes.get(message.toolCallId) ?? []), index]);
    }
  });
  messages.forEach((message, index) => {
    const calls = message.toolCalls ?? [];
    if (message.role !== "assistant" || calls.length === 0) {
      return;
    }
    const hasUnclosed = calls.some((call) => (toolResultIndexes.get(call.callId) ?? []).length === 0);
    if (!hasUnclosed) {
      return;
    }
    preserved.add(index);
    calls.forEach((call) => {
      for (const resultIndex of toolResultIndexes.get(call.callId) ?? []) {
        preserved.add(resultIndex);
      }
    });
  });
}

function assembleCompactedLoopMessages(
  messages: readonly ModelMessage[],
  preservedIndexes: ReadonlySet<number>,
  summary: BasicAgentConversationSummary
): readonly ModelMessage[] {
  const compactedMessage: ModelMessage = {
    role: "system",
    content: [
      "# Compacted Context",
      "",
      summary.summary,
      "",
      "Continue the original task from this context. This summary is background only and is not a completion signal.",
    ].join("\n"),
    ref: summary.summaryId,
  };
  const output: ModelMessage[] = [];
  let inserted = false;
  messages.forEach((message, index) => {
    if (preservedIndexes.has(index)) {
      output.push(cloneLoopMessage(message));
      return;
    }
    if (!inserted) {
      output.push(compactedMessage);
      inserted = true;
    }
  });
  if (!inserted) {
    output.unshift(compactedMessage);
  }
  return output;
}

function serializeLoopMessageForCompaction(message: ModelMessage, index: number): string {
  const ref = message.ref ?? `loop-context:${index}`;
  const toolCalls = message.toolCalls?.length
    ? `\n  toolCalls: ${message.toolCalls.map((call) => `${call.toolName}#${call.callId}`).join(", ")}`
    : "";
  const toolResult = message.toolCallId === undefined ? "" : `\n  toolResultFor: ${message.toolName ?? "tool"}#${message.toolCallId}`;
  return [
    `- [${ref}] ${message.role}:${toolCalls}${toolResult}`,
    indentBlock(sanitizeConversationHistoryText(message.content)),
  ].join("\n");
}

function loopContextTokenCount(
  counter: BasicAgentTokenCounter,
  messages: readonly ModelMessage[],
  tools: readonly ToolDefinition[]
): number {
  return counter.countMessages(messages.map((message) => ({ role: message.role, content: message.content }))) +
    counter.countText(serializeToolsForTokenBudget(tools));
}

function loopContextThreshold(capabilities: ModelCapabilities | undefined, ratio: number): number {
  const windowTokens = capabilities?.contextWindowTokens ?? DEFAULT_INPUT_TOKEN_BUDGET;
  return Math.max(1_000, Math.floor(windowTokens * clampRatio(ratio)));
}

function serializeToolsForTokenBudget(tools: readonly ToolDefinition[]): string {
  if (tools.length === 0) {
    return "";
  }
  return JSON.stringify(tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })));
}

function cloneLoopMessage(message: ModelMessage): ModelMessage {
  return {
    ...message,
    toolCalls: message.toolCalls?.map((toolCall) => ({
      callId: toolCall.callId,
      toolName: toolCall.toolName,
      input: globalThis.structuredClone(toolCall.input),
    })),
    protocolExtensions:
      message.protocolExtensions === undefined ? undefined : globalThis.structuredClone(message.protocolExtensions),
  };
}

function indentBlock(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => `  ${line}`)
    .join("\n");
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
