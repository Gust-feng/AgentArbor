import type { OpenAIModelRequestSettings } from "../../domain/config/index.js";
import type {
  ModelInputAttachment,
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
      stream_options: input.stream && input.dialect.supportsStreamUsage ? { include_usage: true } : undefined,
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
    content: toOpenAIMessageContent(message),
  };
}

function toOpenAIMessageContent(message: ModelMessage): unknown {
  if (message.role !== "user" || message.attachments === undefined || message.attachments.length === 0) {
    return message.content;
  }
  const parts: Record<string, unknown>[] = [];
  if (message.content.length > 0) {
    parts.push({ type: "text", text: message.content });
  }
  for (const attachment of message.attachments) {
    const part = toOpenAIContentPart(attachment);
    if (part !== undefined) {
      parts.push(part);
    }
  }
  return parts.length === 0 ? message.content : parts;
}

function toOpenAIContentPart(attachment: ModelInputAttachment): Record<string, unknown> | undefined {
  if (attachment.kind === "image") {
    if (attachment.source.kind === "file_id") {
      return {
        type: "file",
        file: removeUndefinedValues({
          file_id: attachment.source.fileId,
          filename: attachment.filename,
        }),
      };
    }
    const url = attachment.source.kind === "url"
      ? attachment.source.url
      : dataUrl(attachment.source.mimeType, attachment.source.data);
    return {
      type: "image_url",
      image_url: removeUndefinedValues({
        url,
        detail: chatImageDetail(attachment.detail),
      }),
    };
  }
  if (attachment.source.kind === "url") {
    return undefined;
  }
  return {
    type: "file",
    file: removeUndefinedValues({
      file_id: attachment.source.kind === "file_id" ? attachment.source.fileId : undefined,
      file_data: attachment.source.kind === "data" ? attachment.source.data : undefined,
      filename: attachment.filename,
    }),
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

function dataUrl(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`;
}

function chatImageDetail(value: Extract<ModelInputAttachment, { readonly kind: "image" }>["detail"]): "auto" | "low" | "high" | undefined {
  if (value === "auto" || value === "low" || value === "high") {
    return value;
  }
  if (value === "original") {
    return "high";
  }
  return undefined;
}

function protocolExtensionsForRequest(
  extensions: Readonly<Record<string, unknown>> | undefined
): Record<string, unknown> {
  if (extensions === undefined) {
    return {};
  }
  return filterOpenAIChatProtocolExtensions(extensions);
}
