import type {
  ModelOutputDelta,
  ModelRequest,
  ModelResponse,
} from "../../domain/intelligence/index.js";
import type { ToolCallRequest } from "../../domain/tools/index.js";
import { createId, nowIso } from "../../kernel/id.js";
import { createFailedModelResponse } from "../../kernel/intelligence/failures.js";
import { pendingModelOutputValidation } from "../../kernel/intelligence/validation.js";
import { modelReasoningOutputFromText } from "./model-reasoning-output.js";
import {
  OpenAICompatibleThinkTagStreamSplitter,
  reasoningTextFromRecord,
  type OpenAICompatibleChatDialect,
} from "./openai-compatible-chat-protocol.js";
import {
  finishReasonForOpenAI,
  isProtocolExtensionValue,
  isStandardOpenAIMessageField,
} from "./openai-compatible-chat-response.js";
import {
  asRecord,
  parseStructuredOutput,
  parseToolArguments,
} from "./provider-value-utils.js";

export async function normalizeOpenAICompatibleStreamResponse(input: {
  request: ModelRequest;
  stream: AsyncIterable<unknown>;
  providerId: string;
  providerKind: "openai_compatible";
  protocolKind: "openai_compatible_chat_completions";
  model: string;
  dialect: OpenAICompatibleChatDialect;
  latencyMs: number;
  emitDelta?: (delta: ModelOutputDelta) => void;
}): Promise<ModelResponse> {
  let content = "";
  let rawContent = "";
  let model = input.model;
  let finishReason: ModelResponse["finishReason"];
  let deltaIndex = 0;
  let reasoningContent = "";
  let reasoningDeltaIndex = 0;
  let cumulativeReasoning = "";
  let cumulativeRawContent = "";
  const thinkTagSplitter = new OpenAICompatibleThinkTagStreamSplitter();
  const toolCalls = new Map<number, { id?: string; name?: string; arguments: string }>();
  const protocolExtensions = new Map<string, unknown>();

  try {
    for await (const rawEvent of input.stream) {
      const raw = asRecord(rawEvent);
      if (typeof raw.model === "string") {
        model = raw.model;
      }
      const choices = Array.isArray(raw.choices) ? raw.choices : [];
      const firstChoice = asRecord(choices[0]);
      const delta = asRecord(firstChoice.delta);
      const reasoningChunk = reasoningTextFromRecord(delta);
      const reasoningUpdate = streamDeltaText({
        next: reasoningChunk,
        previous: cumulativeReasoning,
        mode: input.dialect.streamDeltaMode,
      });
      cumulativeReasoning = reasoningUpdate.nextPrevious;
      const reasoningDelta = reasoningUpdate.delta;
      if (reasoningDelta.length > 0) {
        reasoningContent = appendReasoningContent(reasoningContent, reasoningDelta);
        reasoningDeltaIndex = emitReasoningDelta({
          emitDelta: input.emitDelta,
          request: input.request,
          providerId: input.providerId,
          model,
          delta: reasoningDelta,
          index: reasoningDeltaIndex,
        });
      }
      const rawContentChunk = typeof delta.content === "string" ? delta.content : "";
      const rawContentUpdate = streamDeltaText({
        next: rawContentChunk,
        previous: cumulativeRawContent,
        mode: input.dialect.streamDeltaMode,
      });
      cumulativeRawContent = rawContentUpdate.nextPrevious;
      const rawContentDelta = rawContentUpdate.delta;
      if (rawContentDelta.length > 0) {
        rawContent += rawContentDelta;
        const split = thinkTagSplitter.push(rawContentDelta);
        if (split.reasoningDelta.length > 0) {
          reasoningContent = appendReasoningContent(reasoningContent, split.reasoningDelta);
          reasoningDeltaIndex = emitReasoningDelta({
            emitDelta: input.emitDelta,
            request: input.request,
            providerId: input.providerId,
            model,
            delta: split.reasoningDelta,
            index: reasoningDeltaIndex,
          });
        }
        if (split.textDelta.length > 0) {
          content += split.textDelta;
          deltaIndex += 1;
          input.emitDelta?.({
            kind: "output",
            requestId: input.request.requestId,
            purpose: input.request.purpose,
            providerId: input.providerId,
            model,
            delta: split.textDelta,
            index: deltaIndex,
            createdAt: nowIso(),
          });
        }
      }
      accumulateStreamingToolCalls(toolCalls, delta.tool_calls);
      accumulateStreamingProtocolExtensions(protocolExtensions, delta);
      finishReason = finishReasonForOpenAI(firstChoice.finish_reason) ?? finishReason;
    }
    const flushed = thinkTagSplitter.flush();
    if (flushed.reasoningDelta.length > 0) {
      reasoningContent = appendReasoningContent(reasoningContent, flushed.reasoningDelta);
      reasoningDeltaIndex = emitReasoningDelta({
        emitDelta: input.emitDelta,
        request: input.request,
        providerId: input.providerId,
        model,
        delta: flushed.reasoningDelta,
        index: reasoningDeltaIndex,
      });
    }
    if (flushed.textDelta.length > 0) {
      content += flushed.textDelta;
      deltaIndex += 1;
      input.emitDelta?.({
        kind: "output",
        requestId: input.request.requestId,
        purpose: input.request.purpose,
        providerId: input.providerId,
        model,
        delta: flushed.textDelta,
        index: deltaIndex,
        createdAt: nowIso(),
      });
    }
  } catch {
    return createFailedModelResponse({
      requestId: input.request.requestId,
      providerId: input.providerId,
      providerKind: input.providerKind,
      protocolKind: input.protocolKind,
      model,
      outputKind: input.request.outputContract.outputKind,
      failureKind: "provider_response",
      retryable: true,
      message: "OpenAI-compatible provider stream response could not be parsed.",
    });
  }

  const parsedOutput = parseStructuredOutput(content);
  const completedToolCalls: ToolCallRequest[] = [...toolCalls.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, call]) => {
      if (typeof call.name !== "string" || call.name.length === 0) {
        return [];
      }
      return [
        {
          callId: call.id ?? createId("tool-call"),
          toolName: call.name,
          input: parseToolArguments(call.arguments),
        },
      ];
    });
  const assistantMessage =
    completedToolCalls.length === 0
      ? undefined
      : {
          role: "assistant" as const,
          content: rawContent,
          toolCalls: completedToolCalls,
          protocolExtensions: protocolExtensionsFromMap(protocolExtensions),
        };

  return {
    responseId: createId("model-response"),
    requestId: input.request.requestId,
    providerId: input.providerId,
    providerKind: input.providerKind,
    protocolKind: input.protocolKind,
    model,
    status: "completed",
    outputKind: input.request.outputContract.outputKind,
    structuredOutput:
      completedToolCalls.length > 0 ? undefined : input.request.outputContract.format === "json_object" ? parsedOutput : undefined,
    textOutput: content,
    reasoningOutput: modelReasoningOutputFromText({
      source: "openai_chat_reasoning_content",
      content: reasoningContent,
    }),
    assistantMessage,
    toolCalls: completedToolCalls.length === 0 ? undefined : completedToolCalls,
    usage: {
      latencyMs: input.latencyMs,
    },
    finishReason: completedToolCalls.length > 0 ? "tool_call" : finishReason,
    validation: pendingModelOutputValidation(),
    completedAt: nowIso(),
  };
}

function emitReasoningDelta(input: {
  readonly emitDelta?: (delta: ModelOutputDelta) => void;
  readonly request: ModelRequest;
  readonly providerId: string;
  readonly model: string;
  readonly delta: string;
  readonly index: number;
}): number {
  const nextIndex = input.index + 1;
  input.emitDelta?.({
    kind: "reasoning",
    requestId: input.request.requestId,
    purpose: input.request.purpose,
    providerId: input.providerId,
    model: input.model,
    delta: input.delta,
    index: nextIndex,
    createdAt: nowIso(),
  });
  return nextIndex;
}

function streamDeltaText(input: {
  readonly next: string;
  readonly previous: string;
  readonly mode: OpenAICompatibleChatDialect["streamDeltaMode"];
}): { readonly delta: string; readonly nextPrevious: string } {
  if (input.next.length === 0) {
    return { delta: "", nextPrevious: input.previous };
  }
  if (input.mode === "incremental") {
    return { delta: input.next, nextPrevious: input.previous };
  }
  if (input.next.startsWith(input.previous)) {
    return { delta: input.next.slice(input.previous.length), nextPrevious: input.next };
  }
  const overlap = longestSuffixPrefixOverlap(input.previous, input.next);
  return { delta: input.next.slice(overlap), nextPrevious: input.next };
}

function longestSuffixPrefixOverlap(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  for (let length = max; length > 0; length -= 1) {
    if (left.endsWith(right.slice(0, length))) {
      return length;
    }
  }
  return 0;
}

function appendReasoningContent(current: string, next: string): string {
  if (next.length === 0) {
    return current;
  }
  return `${current}${next}`;
}

function accumulateStreamingToolCalls(
  toolCalls: Map<number, { id?: string; name?: string; arguments: string }>,
  value: unknown
): void {
  if (!Array.isArray(value)) {
    return;
  }
  for (const item of value) {
    const record = asRecord(item);
    const index = typeof record.index === "number" ? record.index : toolCalls.size;
    const fn = asRecord(record.function);
    const current = toolCalls.get(index) ?? { arguments: "" };
    toolCalls.set(index, {
      id: typeof record.id === "string" ? record.id : current.id,
      name: typeof fn.name === "string" ? fn.name : current.name,
      arguments: current.arguments + (typeof fn.arguments === "string" ? fn.arguments : ""),
    });
  }
}

function accumulateStreamingProtocolExtensions(extensions: Map<string, unknown>, delta: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(delta)) {
    if (isStandardOpenAIMessageField(key) || !isProtocolExtensionValue(value)) {
      continue;
    }
    const current = extensions.get(key);
    if (typeof current === "string" && typeof value === "string") {
      extensions.set(key, current + value);
    } else if (Array.isArray(current) && Array.isArray(value)) {
      extensions.set(key, [...current, ...value]);
    } else if (current !== undefined && isPlainRecord(current) && isPlainRecord(value)) {
      extensions.set(key, { ...current, ...value });
    } else if (current === undefined) {
      extensions.set(key, value);
    }
  }
}

function protocolExtensionsFromMap(extensions: ReadonlyMap<string, unknown>): Readonly<Record<string, unknown>> | undefined {
  if (extensions.size === 0) {
    return undefined;
  }
  return Object.fromEntries(extensions.entries());
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
