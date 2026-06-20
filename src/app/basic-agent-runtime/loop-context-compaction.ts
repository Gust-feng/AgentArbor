import type { ModelMessage } from "../../domain/intelligence/index.js";
import type { ToolDefinition } from "../../domain/tools/index.js";
import { createId, nowIso } from "../../kernel/id.js";
import { normalizeModelFacingText } from "../visible-text-safety.js";
import {
  clampRatio,
  compactionAgentDisplayName,
  conversationCompactionOutputContract,
  DEFAULT_INPUT_TOKEN_BUDGET,
  DEFAULT_THRESHOLD_RATIO,
} from "./conversation-compaction-common.js";
import type {
  BasicAgentConversationSummary,
  BasicAgentLoopContextCompactionResult,
  CompactBasicAgentLoopContextInput,
} from "./conversation-compaction-contracts.js";
import { createOpenAITokenCounter, type BasicAgentTokenCounter } from "./token-counter.js";

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
    sanitizedMessages: loopCompactionMessages({
      goal: input.goal,
      agentDisplayName: compactionAgentDisplayName(input.agentIdentity),
      compactible: split.compactible,
    }),
    outputContract: conversationCompactionOutputContract(),
    constraintRefs: [],
    budget: {
      maxOutputTokens: Math.min(input.modelCapabilities?.maxOutputTokens ?? MAX_COMPACTION_OUTPUT_TOKENS, MAX_COMPACTION_OUTPUT_TOKENS),
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

  // The continuation prompt is re-fed to the model as compacted context, so keep
  // its internal whitespace/blank lines (section breaks, code fragments) intact.
  const promptText = normalizeModelFacingText(
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

function loopCompactionMessages(input: {
  readonly goal: string;
  readonly agentDisplayName: string;
  readonly compactible: readonly {
    readonly message: ModelMessage;
    readonly index: number;
  }[];
}): readonly ModelMessage[] {
  return [
    {
      role: "system",
      content: [
        `You compact earlier runtime context for ${input.agentDisplayName}, the ordinary desktop agent for this run.`,
        "Return exactly one Markdown continuation prompt. Do not return JSON.",
        "Preserve still-relevant goals, user constraints, progress, decisions, next actions, errors, evidence refs, and file paths.",
        "Preserve concrete tool results, errors, stdout/stderr, file content fragments, and development context that may be needed to continue.",
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
        `Current user request: ${normalizeModelFacingText(input.goal)}`,
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
    // Model-facing: keep tool results / file content / stdout indentation intact
    // before indenting the block for the compaction request.
    indentBlock(normalizeModelFacingText(message.content)),
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

function loopContextThreshold(capabilities: CompactBasicAgentLoopContextInput["modelCapabilities"], ratio: number): number {
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
