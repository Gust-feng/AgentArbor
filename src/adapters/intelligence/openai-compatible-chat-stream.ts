import type {
  ModelOutputDelta,
  ModelRequest,
  ModelResponse,
} from "../../domain/intelligence/index.js";
import type { ToolCallRequest } from "../../domain/tools/index.js";
import { createId, nowIso } from "../../kernel/id.js";
import { createFailedModelResponse } from "../../kernel/intelligence/failures.js";
import { pendingModelOutputValidation } from "../../kernel/intelligence/validation.js";
import { createVisibleOutputStreamProjector } from "../../kernel/intelligence/visible-output-stream.js";
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
  isPlainRecord,
  parseStructuredOutput,
  parseToolArguments,
} from "./provider-value-utils.js";
import { modelUsageWithTiming, openAIChatUsageFromRecord } from "./model-usage-metrics.js";

export async function normalizeOpenAICompatibleStreamResponse(input: {
  request: ModelRequest;
  stream: AsyncIterable<unknown>;
  providerId: string;
  providerKind: "openai_compatible";
  protocolKind: "openai_compatible_chat_completions";
  model: string;
  dialect: OpenAICompatibleChatDialect;
  startedAtMs: number;
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
  const visibleOutputStream = createVisibleOutputStreamProjector(input.request.outputContract);
  const toolCalls = new Map<number, { id?: string; name?: string; arguments: string }>();
  const protocolExtensions = new Map<string, unknown>();
  let firstOutputTokenAtMs: number | undefined;
  let usage: ReturnType<typeof openAIChatUsageFromRecord> | undefined;

  try {
    for await (const rawEvent of input.stream) {
      const raw = asRecord(rawEvent);
      const rawUsage = openAIChatUsageFromRecord(raw.usage);
      if (hasTokenUsage(rawUsage)) {
        usage = rawUsage;
      }
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
          const outputDelta = visibleOutputStream.push(split.textDelta);
          if (outputDelta.length > 0 && firstOutputTokenAtMs === undefined) {
            firstOutputTokenAtMs = Date.now();
          }
          deltaIndex = emitVisibleOutputDelta({
            emitDelta: input.emitDelta,
            request: input.request,
            providerId: input.providerId,
            model,
            delta: outputDelta,
            index: deltaIndex,
          });
        }
      }
      accumulateStreamingToolCalls(toolCalls, delta.tool_calls, delta.function_call);
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
      const outputDelta = visibleOutputStream.push(flushed.textDelta);
      if (outputDelta.length > 0 && firstOutputTokenAtMs === undefined) {
        firstOutputTokenAtMs = Date.now();
      }
      deltaIndex = emitVisibleOutputDelta({
        emitDelta: input.emitDelta,
        request: input.request,
        providerId: input.providerId,
        model,
        delta: outputDelta,
        index: deltaIndex,
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
  const finalFinishReason = completedToolCalls.length > 0 ? "tool_call" : finishReason;
  const incompleteResponse = failedResponseForIncompleteStreamFinish({
    request: input.request,
    providerId: input.providerId,
    providerKind: input.providerKind,
    protocolKind: input.protocolKind,
    model,
    finishReason: finalFinishReason,
  });
  if (incompleteResponse !== undefined) {
    return incompleteResponse;
  }

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
    usage: modelUsageWithTiming({
      usage,
      latencyMs: Date.now() - input.startedAtMs,
      firstTokenLatencyMs:
        firstOutputTokenAtMs === undefined ? undefined : firstOutputTokenAtMs - input.startedAtMs,
    }),
    finishReason: finalFinishReason,
    validation: pendingModelOutputValidation(),
    completedAt: nowIso(),
  };
}

function hasTokenUsage(value: Pick<NonNullable<ModelResponse["usage"]>, "inputTokens" | "outputTokens" | "totalTokens">): boolean {
  return value.inputTokens !== undefined || value.outputTokens !== undefined || value.totalTokens !== undefined;
}

function failedResponseForIncompleteStreamFinish(input: {
  readonly request: ModelRequest;
  readonly providerId: string;
  readonly providerKind: "openai_compatible";
  readonly protocolKind: "openai_compatible_chat_completions";
  readonly model: string;
  readonly finishReason: ModelResponse["finishReason"];
}): ModelResponse | undefined {
  if (input.finishReason !== "length" && input.finishReason !== "content_filter" && input.finishReason !== "error") {
    return undefined;
  }
  const message = input.finishReason === "length"
    ? "OpenAI-compatible provider stream returned a truncated response."
    : input.finishReason === "content_filter"
      ? "OpenAI-compatible provider stream filtered the response content."
      : "OpenAI-compatible provider stream returned an error finish reason.";
  return createFailedModelResponse({
    requestId: input.request.requestId,
    providerId: input.providerId,
    providerKind: input.providerKind,
    protocolKind: input.protocolKind,
    model: input.model,
    outputKind: input.request.outputContract.outputKind,
    failureKind: "provider_response",
    retryable: input.finishReason === "length",
    message,
  });
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

function emitVisibleOutputDelta(input: {
  readonly emitDelta?: (delta: ModelOutputDelta) => void;
  readonly request: ModelRequest;
  readonly providerId: string;
  readonly model: string;
  readonly delta: string;
  readonly index: number;
}): number {
  if (input.delta.length === 0) {
    return input.index;
  }
  const nextIndex = input.index + 1;
  input.emitDelta?.({
    kind: "output",
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
    return incrementalStreamDeltaText(input.previous, input.next);
  }
  if (input.next.startsWith(input.previous)) {
    return { delta: input.next.slice(input.previous.length), nextPrevious: input.next };
  }
  const overlap = longestSuffixPrefixOverlap(input.previous, input.next);
  return { delta: input.next.slice(overlap), nextPrevious: input.next };
}

function incrementalStreamDeltaText(
  previous: string,
  next: string
): { readonly delta: string; readonly nextPrevious: string } {
  // Some OpenAI-compatible endpoints still emit cumulative snapshots under an
  // incremental profile. Normalize that at the adapter boundary so the rest of
  // the app only sees append-only deltas.
  if (previous.length === 0) {
    return { delta: next, nextPrevious: next };
  }
  if (next.length > previous.length && next.startsWith(previous)) {
    return { delta: next.slice(previous.length), nextPrevious: next };
  }
  if (next.length >= 16 && previous.startsWith(next)) {
    return { delta: "", nextPrevious: previous };
  }
  return { delta: next, nextPrevious: `${previous}${next}` };
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
  value: unknown,
  legacyFunctionCall: unknown
): void {
  if (!Array.isArray(value)) {
    accumulateLegacyStreamingFunctionCall(toolCalls, legacyFunctionCall);
    return;
  }
  let parsed = false;
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
    parsed = true;
  }
  if (!parsed) {
    accumulateLegacyStreamingFunctionCall(toolCalls, legacyFunctionCall);
  }
}

function accumulateLegacyStreamingFunctionCall(
  toolCalls: Map<number, { id?: string; name?: string; arguments: string }>,
  value: unknown
): void {
  const fn = asRecord(value);
  if (Object.keys(fn).length === 0) {
    return;
  }
  const current = toolCalls.get(0) ?? { arguments: "" };
  toolCalls.set(0, {
    id: current.id,
    name: typeof fn.name === "string" ? fn.name : current.name,
    arguments: current.arguments + (typeof fn.arguments === "string" ? fn.arguments : ""),
  });
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
