import type {
  ModelMessage,
  ModelRequest,
  ModelResponse,
} from "../../domain/intelligence/index.js";
import type { ToolCallRequest } from "../../domain/tools/index.js";
import { createId, nowIso } from "../../kernel/id.js";
import { pendingModelOutputValidation } from "../../kernel/intelligence/validation.js";
import { createFailedModelResponse } from "../../kernel/intelligence/failures.js";
import { modelReasoningOutputFromText } from "./model-reasoning-output.js";
import {
  decodeOpenAICompatibleChatMessage,
  type OpenAICompatibleChatDecodedContent,
  type OpenAICompatibleChatDialect,
} from "./openai-compatible-chat-protocol.js";
import {
  asRecord,
  parseStructuredOutput,
  parseToolArguments,
} from "./provider-value-utils.js";
import { filterOpenAIChatProtocolExtensions } from "./openai-compatible-chat-protocol-extensions.js";
import { modelUsageWithTiming, openAIChatUsageFromRecord } from "./model-usage-metrics.js";
import { createOpenAIModelRefusalResponse } from "./openai-model-refusal.js";
import {
  assessOpenAICompatibleChatTerminal,
  normalizeOpenAICompatibleChatFinishReason,
} from "./openai-provider-terminal.js";

export function normalizeOpenAICompatibleResponse(input: {
  request: ModelRequest;
  raw: unknown;
  providerId: string;
  providerKind: "openai_compatible";
  protocolKind: "openai_compatible_chat_completions";
  model: string;
  dialect: OpenAICompatibleChatDialect;
  latencyMs: number;
}): ModelResponse {
  const raw = asRecord(input.raw);
  const choices = Array.isArray(raw.choices) ? raw.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice.message);
  const decoded = decodeOpenAICompatibleChatMessage({ message, dialect: input.dialect });
  const content = decoded.textContent;
  const refusal = typeof message.refusal === "string" ? message.refusal : "";
  if (refusal.trim().length > 0) {
    return createOpenAIModelRefusalResponse({
      request: input.request,
      providerId: input.providerId,
      providerKind: input.providerKind,
      protocolKind: input.protocolKind,
      model: typeof raw.model === "string" ? raw.model : input.model,
      refusal,
    });
  }
  const reasoningOutput = reasoningOutputForChatMessage(decoded);
  const parsedOutput = parseStructuredOutput(content);
  const toolCalls = parseToolCalls(message.tool_calls, message.function_call);
  const assistantMessage = assistantContinuationMessage({ message, content: decoded.rawContent, toolCalls });
  const model = typeof raw.model === "string" ? raw.model : input.model;
  const terminal = assessOpenAICompatibleChatTerminal({
    finishReason: firstChoice.finish_reason,
    hasToolCalls: toolCalls.length > 0,
  });
  if (terminal.status === "failed") {
    return createFailedModelResponse({
      requestId: input.request.requestId,
      providerId: input.providerId,
      providerKind: input.providerKind,
      protocolKind: input.protocolKind,
      model,
      outputKind: input.request.outputContract.outputKind,
      failureKind: "provider_response",
      retryable: terminal.retryable,
      message: terminal.message,
    });
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
      toolCalls.length > 0 ? undefined : input.request.outputContract.format === "json_object" ? parsedOutput : undefined,
    textOutput: content,
    reasoningOutput,
    assistantMessage,
    toolCalls: toolCalls.length === 0 ? undefined : toolCalls,
    usage: modelUsageWithTiming({
      usage: openAIChatUsageFromRecord(raw.usage),
      latencyMs: input.latencyMs,
    }),
    finishReason: terminal.finishReason,
    validation: pendingModelOutputValidation(),
    completedAt: nowIso(),
  };
}

export function finishReasonForOpenAI(value: unknown): ModelResponse["finishReason"] {
  return normalizeOpenAICompatibleChatFinishReason(value);
}

export function parseToolCalls(value: unknown, legacyFunctionCall?: unknown): ToolCallRequest[] {
  if (!Array.isArray(value)) {
    return parseLegacyFunctionCall(legacyFunctionCall);
  }
  const calls: ToolCallRequest[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const fn = asRecord(record.function);
    const name = typeof fn.name === "string" ? fn.name : undefined;
    if (name === undefined) {
      continue;
    }
    calls.push({
      callId: typeof record.id === "string" ? record.id : createId("tool-call"),
      toolName: name,
      input: parseToolArguments(fn.arguments),
    });
  }
  return calls.length > 0 ? calls : parseLegacyFunctionCall(legacyFunctionCall);
}

function parseLegacyFunctionCall(value: unknown): ToolCallRequest[] {
  const fn = asRecord(value);
  const name = typeof fn.name === "string" ? fn.name : undefined;
  if (name === undefined) {
    return [];
  }
  return [{
    callId: createId("tool-call"),
    toolName: name,
    input: parseToolArguments(fn.arguments),
  }];
}

export function protocolExtensionsForResponse(message: Record<string, unknown>): Readonly<Record<string, unknown>> | undefined {
  const filtered = filterOpenAIChatProtocolExtensions(message);
  return Object.keys(filtered).length === 0 ? undefined : filtered;
}

// 协议扩展判定逻辑已收敛到 openai-compatible-chat-protocol-extensions，此处仅再导出以保持原有导出面。
export { isProtocolExtensionValue, isStandardOpenAIMessageField } from "./openai-compatible-chat-protocol-extensions.js";

function assistantContinuationMessage(input: {
  readonly message: Record<string, unknown>;
  readonly content: string;
  readonly toolCalls: readonly ToolCallRequest[];
}): ModelMessage | undefined {
  if (input.toolCalls.length === 0) {
    return undefined;
  }
  return {
    role: "assistant",
    content: input.content,
    toolCalls: input.toolCalls,
    protocolExtensions: protocolExtensionsForResponse(input.message),
  };
}

function reasoningOutputForChatMessage(
  decoded: OpenAICompatibleChatDecodedContent
): ModelResponse["reasoningOutput"] {
  return decoded.reasoningContent.length === 0
    ? undefined
    : modelReasoningOutputFromText({
        source: decoded.reasoningSource,
        content: decoded.reasoningContent,
      });
}
