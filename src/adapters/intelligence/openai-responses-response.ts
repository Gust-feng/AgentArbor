import type {
  ModelMessage,
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
  asRecord,
  numberOrUndefined,
  parseStructuredOutput,
  parseToolArguments,
} from "./provider-value-utils.js";

export function normalizeOpenAIResponsesResponse(input: {
  request: ModelRequest;
  raw: unknown;
  providerId: string;
  providerKind: "openai";
  protocolKind: "openai_responses";
  model: string;
  latencyMs: number;
}): ModelResponse {
  const raw = asRecord(input.raw);
  const output = Array.isArray(raw.output) ? raw.output : [];
  const { textOutput, toolCalls, reasoningContent } = parseOutputItems(output);
  const parsedOutput = parseStructuredOutput(textOutput);
  const responseId = typeof raw.id === "string" ? raw.id : createId("model-response");
  const usage = asRecord(raw.usage);
  const finishReason = finishReasonFromStatus(raw.status, toolCalls);
  const incompleteResponse = failedResponseForIncompleteResponsesFinish({
    request: input.request,
    providerId: input.providerId,
    providerKind: input.providerKind,
    protocolKind: input.protocolKind,
    model: typeof raw.model === "string" ? raw.model : input.model,
    finishReason,
  });
  if (incompleteResponse !== undefined) {
    return incompleteResponse;
  }

  return {
    responseId,
    requestId: input.request.requestId,
    providerId: input.providerId,
    providerKind: input.providerKind,
    protocolKind: input.protocolKind,
    model: typeof raw.model === "string" ? raw.model : input.model,
    status: "completed",
    outputKind: input.request.outputContract.outputKind,
    structuredOutput:
      toolCalls.length > 0 ? undefined : input.request.outputContract.format === "json_object" ? parsedOutput : undefined,
    textOutput,
    reasoningOutput: modelReasoningOutputFromText({
      source: "openai_responses_reasoning_summary",
      content: reasoningContent,
    }),
    assistantMessage: assistantMessageFromOutput({ textOutput, toolCalls, responseId }),
    toolCalls: toolCalls.length === 0 ? undefined : toolCalls,
    usage: {
      inputTokens: numberOrUndefined(usage.input_tokens),
      outputTokens: numberOrUndefined(usage.output_tokens),
      totalTokens: numberOrUndefined(usage.total_tokens),
      latencyMs: input.latencyMs,
    },
    finishReason,
    validation: pendingModelOutputValidation(),
    completedAt: nowIso(),
  };
}

export async function normalizeOpenAIResponsesStreamResponse(input: {
  request: ModelRequest;
  stream: AsyncIterable<unknown>;
  providerId: string;
  providerKind: "openai";
  protocolKind: "openai_responses";
  model: string;
  latencyMs: number;
  emitDelta?: (delta: ModelOutputDelta) => void;
}): Promise<ModelResponse> {
  let textContent = "";
  let responseId = createId("model-response");
  let responseStatus: string | undefined;
  let model = input.model;
  let deltaIndex = 0;
  let reasoningContent = "";
  let reasoningDeltaIndex = 0;
  const visibleOutputStream = createVisibleOutputStreamProjector(input.request.outputContract);
  const toolCallBuilders = new Map<number, { callId?: string; name?: string; arguments: string }>();

  try {
    for await (const rawEvent of input.stream) {
      const event = asRecord(rawEvent);
      const eventType = typeof event.type === "string" ? event.type : "";

      if (eventType === "response.created") {
        const response = asRecord(event.response);
        if (typeof response.id === "string") {
          responseId = response.id;
        }
        if (typeof response.model === "string") {
          model = response.model;
        }
        continue;
      }

      if (eventType === "response.output_item.added") {
        const item = asRecord(event.item);
        if (item.type === "function_call") {
          const outputIndex = typeof event.output_index === "number" ? event.output_index : toolCallBuilders.size;
          toolCallBuilders.set(outputIndex, {
            callId: typeof item.call_id === "string" ? item.call_id : undefined,
            name: typeof item.name === "string" ? item.name : undefined,
            arguments: typeof item.arguments === "string" ? item.arguments : "",
          });
        }
        continue;
      }

      if (eventType === "response.output_text.delta") {
        const delta = typeof event.delta === "string" ? event.delta : "";
        if (delta.length > 0) {
          textContent += delta;
          deltaIndex = emitVisibleOutputDelta({
            emitDelta: input.emitDelta,
            request: input.request,
            providerId: input.providerId,
            model,
            delta: visibleOutputStream.push(delta),
            index: deltaIndex,
          });
        }
        continue;
      }

      if (
        eventType === "response.reasoning_summary_text.delta" ||
        eventType === "response.reasoning_text.delta"
      ) {
        const delta = typeof event.delta === "string" ? event.delta : "";
        if (delta.length > 0) {
          reasoningContent += delta;
          reasoningDeltaIndex += 1;
          input.emitDelta?.({
            kind: "reasoning",
            requestId: input.request.requestId,
            purpose: input.request.purpose,
            providerId: input.providerId,
            model,
            delta,
            index: reasoningDeltaIndex,
            createdAt: nowIso(),
          });
        }
        continue;
      }

      if (eventType === "response.function_call_arguments.delta") {
        const outputIndex = typeof event.output_index === "number" ? event.output_index : 0;
        const builder = toolCallBuilders.get(outputIndex) ?? { arguments: "" };
        builder.arguments += typeof event.delta === "string" ? event.delta : "";
        toolCallBuilders.set(outputIndex, builder);
        continue;
      }

      if (eventType === "response.output_item.done") {
        const item = asRecord(event.item);
        if (item.type === "function_call") {
          const outputIndex = typeof event.output_index === "number" ? event.output_index : toolCallBuilders.size;
          const builder = toolCallBuilders.get(outputIndex) ?? { arguments: "" };
          toolCallBuilders.set(outputIndex, {
            callId: typeof item.call_id === "string" ? item.call_id : builder.callId,
            name: typeof item.name === "string" ? item.name : builder.name,
            arguments: typeof item.arguments === "string" && builder.arguments.length === 0 ? item.arguments : builder.arguments,
          });
        }
        continue;
      }

      if (eventType === "response.completed") {
        const response = asRecord(event.response);
        responseStatus = typeof response.status === "string" ? response.status : "completed";
        if (typeof response.id === "string") {
          responseId = response.id;
        }
        if (typeof response.model === "string") {
          model = response.model;
        }
        if (reasoningContent.length === 0) {
          const parsed = parseOutputItems(Array.isArray(response.output) ? response.output : []);
          reasoningContent = parsed.reasoningContent;
        }
        continue;
      }

      if (eventType === "response.incomplete") {
        responseStatus = "incomplete";
        continue;
      }

      if (eventType === "response.failed") {
        return createFailedModelResponse({
          requestId: input.request.requestId,
          providerId: input.providerId,
          providerKind: input.providerKind,
          protocolKind: input.protocolKind,
          model,
          outputKind: input.request.outputContract.outputKind,
          failureKind: "provider_response",
          retryable: true,
          message: "OpenAI Responses provider stream reported failure.",
        });
      }
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
      message: "OpenAI Responses provider stream response could not be parsed.",
    });
  }

  const toolCalls: ToolCallRequest[] = [...toolCallBuilders.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, builder]) => {
      if (typeof builder.name !== "string" || builder.name.length === 0) {
        return [];
      }
      return [
        {
          callId: builder.callId ?? createId("tool-call"),
          toolName: builder.name,
          input: parseToolArguments(builder.arguments),
        },
      ];
    });
  const parsedOutput = parseStructuredOutput(textContent);
  const finalFinishReason = toolCalls.length > 0 ? "tool_call" : finishReasonFromStatus(responseStatus, toolCalls);
  const incompleteResponse = failedResponseForIncompleteResponsesFinish({
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
    responseId,
    requestId: input.request.requestId,
    providerId: input.providerId,
    providerKind: input.providerKind,
    protocolKind: input.protocolKind,
    model,
    status: "completed",
    outputKind: input.request.outputContract.outputKind,
    structuredOutput:
      toolCalls.length > 0 ? undefined : input.request.outputContract.format === "json_object" ? parsedOutput : undefined,
    textOutput: textContent,
    reasoningOutput: modelReasoningOutputFromText({
      source: "openai_responses_reasoning_summary",
      content: reasoningContent,
    }),
    assistantMessage: assistantMessageFromOutput({ textOutput: textContent, toolCalls, responseId }),
    toolCalls: toolCalls.length === 0 ? undefined : toolCalls,
    usage: {
      latencyMs: input.latencyMs,
    },
    finishReason: finalFinishReason,
    validation: pendingModelOutputValidation(),
    completedAt: nowIso(),
  };
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

function parseOutputItems(output: unknown[]): {
  textOutput: string;
  toolCalls: ToolCallRequest[];
  reasoningContent: string;
} {
  let textOutput = "";
  let reasoningContent = "";
  const toolCalls: ToolCallRequest[] = [];

  for (const item of output) {
    const record = asRecord(item);
    if (record.type === "reasoning") {
      reasoningContent += collectReasoningText(record);
    }
    if (record.type === "message") {
      const content = Array.isArray(record.content) ? record.content : [];
      for (const part of content) {
        const partRecord = asRecord(part);
        if (partRecord.type === "output_text" && typeof partRecord.text === "string") {
          textOutput += partRecord.text;
        }
      }
    }

    if (record.type === "function_call") {
      const name = typeof record.name === "string" ? record.name : undefined;
      if (name !== undefined) {
        toolCalls.push({
          callId: typeof record.call_id === "string" ? record.call_id : createId("tool-call"),
          toolName: name,
          input: parseToolArguments(record.arguments),
        });
      }
    }
  }

  return { textOutput, toolCalls, reasoningContent };
}

function collectReasoningText(record: Record<string, unknown>): string {
  const parts: string[] = [];
  const directText = typeof record.text === "string" ? record.text : undefined;
  if (directText !== undefined) {
    parts.push(directText);
  }
  for (const value of [record.summary, record.content]) {
    if (!Array.isArray(value)) {
      continue;
    }
    for (const item of value) {
      if (typeof item === "string") {
        parts.push(item);
        continue;
      }
      const part = asRecord(item);
      const text =
        typeof part.text === "string" ? part.text :
        typeof part.summary_text === "string" ? part.summary_text :
        typeof part.content === "string" ? part.content :
        undefined;
      if (text !== undefined) {
        parts.push(text);
      }
    }
  }
  return parts.length === 0 ? "" : `${parts.join("\n").trim()}\n`;
}

function assistantMessageFromOutput(input: {
  textOutput: string;
  toolCalls: readonly ToolCallRequest[];
  responseId: string;
}): ModelMessage | undefined {
  if (input.toolCalls.length === 0) {
    return undefined;
  }
  return {
    role: "assistant",
    content: input.textOutput,
    toolCalls: input.toolCalls,
    protocolExtensions: { response_id: input.responseId },
  };
}

function failedResponseForIncompleteResponsesFinish(input: {
  readonly request: ModelRequest;
  readonly providerId: string;
  readonly providerKind: "openai";
  readonly protocolKind: "openai_responses";
  readonly model: string;
  readonly finishReason: ModelResponse["finishReason"];
}): ModelResponse | undefined {
  if (input.finishReason !== "length" && input.finishReason !== "content_filter" && input.finishReason !== "error") {
    return undefined;
  }
  const message = input.finishReason === "length"
    ? "OpenAI Responses provider returned an incomplete response."
    : input.finishReason === "content_filter"
      ? "OpenAI Responses provider filtered the response content."
      : "OpenAI Responses provider returned an error finish reason.";
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

function finishReasonFromStatus(
  status: unknown,
  toolCalls: readonly ToolCallRequest[]
): ModelResponse["finishReason"] {
  if (toolCalls.length > 0) {
    return "tool_call";
  }
  if (status === "completed") {
    return "stop";
  }
  if (status === "incomplete") {
    return "length";
  }
  return undefined;
}
