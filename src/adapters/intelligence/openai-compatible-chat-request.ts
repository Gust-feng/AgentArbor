import type { OpenAIModelRequestSettings } from "../../domain/config/index.js";
import type {
  ModelMessage,
  ModelRequest,
  ModelToolChoice,
} from "../../domain/intelligence/index.js";
import type { ToolCallRequest, ToolDefinition } from "../../domain/tools/index.js";
import { modelVisibleToolDescription } from "../../domain/tools/index.js";
import {
  applyOpenAICompatibleChatDialectControls,
  applyOpenAICompatibleChatRequestPolicy,
  type OpenAICompatibleChatDialect,
} from "./openai-compatible-chat-protocol.js";
import { buildOpenAIChatCompletionsControlFields } from "./openai-request-settings.js";
import { removeUndefinedValues } from "./provider-value-utils.js";
import { filterOpenAIChatProtocolExtensions } from "./openai-compatible-chat-protocol-extensions.js";

export function buildOpenAICompatibleChatRequestBody(input: {
  readonly request: ModelRequest;
  readonly model: string;
  readonly dialect: OpenAICompatibleChatDialect;
  readonly stream: boolean;
  readonly requestSettings?: OpenAIModelRequestSettings;
}): Record<string, unknown> {
  const controlFields = applyOpenAICompatibleChatDialectControls({
    fields: buildOpenAIChatCompletionsControlFields({
      requestBudgetMaxOutputTokens: input.request.budget.maxOutputTokens,
      settings: input.requestSettings,
      tools: input.request.tools,
    }) ?? {},
    dialect: input.dialect,
    settings: input.requestSettings,
  });
  return removeUndefinedValues(applyOpenAICompatibleChatRequestPolicy({
    dialect: input.dialect,
    fields: {
      model: input.model,
      messages: input.request.sanitizedMessages.map(toOpenAIMessage),
      tools: input.request.tools === undefined || input.request.tools.length === 0 ? undefined : input.request.tools.map(toOpenAITool),
      tool_choice: toOpenAIToolChoice(input.request.toolChoice),
      response_format:
        input.request.outputContract.format === "json_object" ? { type: "json_object" } : undefined,
      ...controlFields,
      stream: input.stream ? true : undefined,
    },
  }));
}

function toOpenAIMessage(message: ModelMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }

  if (message.role === "assistant" && message.toolCalls !== undefined && message.toolCalls.length > 0) {
    return {
      ...protocolExtensionsForRequest(message.protocolExtensions),
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map(toOpenAIToolCall),
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
}

function toOpenAITool(definition: ToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: definition.name,
      description: modelVisibleToolDescription(definition),
      parameters: definition.inputSchema,
    },
  };
}

function toOpenAIToolChoice(choice: ModelToolChoice | undefined): unknown {
  if (choice === undefined) {
    return undefined;
  }
  if (choice === "auto" || choice === "none") {
    return choice;
  }
  return {
    type: "function",
    function: {
      name: choice.function.name,
    },
  };
}

function toOpenAIToolCall(toolCall: ToolCallRequest): Record<string, unknown> {
  return {
    id: toolCall.callId,
    type: "function",
    function: {
      name: toolCall.toolName,
      arguments: JSON.stringify(toolCall.input),
    },
  };
}

function protocolExtensionsForRequest(
  extensions: Readonly<Record<string, unknown>> | undefined
): Record<string, unknown> {
  if (extensions === undefined) {
    return {};
  }
  return filterOpenAIChatProtocolExtensions(extensions);
}
