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
import { OpenAIModelInputError } from "./openai-model-input-error.js";
import { promptCacheKeyForModelRequest } from "./openai-prompt-cache.js";

export function buildOpenAICompatibleChatRequestBody(input: {
  readonly request: ModelRequest;
  readonly model: string;
  readonly dialect: OpenAICompatibleChatDialect;
  readonly stream: boolean;
  readonly requestSettings?: OpenAIModelRequestSettings;
  readonly enablePromptCacheKey?: boolean;
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
      prompt_cache_key: input.enablePromptCacheKey === true && input.dialect.profileId === "openai"
        ? promptCacheKeyForModelRequest({
            protocol: "chat",
            model: input.model,
            request: input.request,
          })
        : undefined,
      messages: toOpenAIMessages(input.request.sanitizedMessages, input.dialect),
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

function toOpenAIMessages(
  messages: readonly ModelMessage[],
  dialect: OpenAICompatibleChatDialect
): readonly Record<string, unknown>[] {
  return messages.map((message) => {
    if (message.role === "tool" && (message.attachments?.length ?? 0) > 0) {
      const hasAudio = message.attachments?.some((attachment) => attachment.kind === "audio") === true;
      throw new OpenAIModelInputError(
        hasAudio
          ? "OpenAI-compatible Chat Completions cannot attach tool-origin audio without changing its message role. The Responses adapter supports tool-origin image and file attachments, but not audio; AgentArbor currently has no OpenAI role-preserving transport for tool-origin audio."
          : "OpenAI-compatible Chat Completions cannot attach tool-origin image or file content without changing its message role; use the Responses protocol for these tool-origin attachments.",
      );
    }
    return toOpenAIMessage(message, dialect);
  });
}

function toOpenAIMessage(
  message: ModelMessage,
  dialect: OpenAICompatibleChatDialect
): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }

  if (message.role === "assistant" && message.toolCalls !== undefined && message.toolCalls.length > 0) {
    return removeUndefinedValues({
      ...protocolExtensionsForRequest(message.protocolExtensions),
      role: "assistant",
      content: chatAssistantToolCallContent(message, dialect),
      tool_calls: message.toolCalls.map(toOpenAIToolCall),
    });
  }

  return {
    role: message.role,
    content: toOpenAIMessageContent(message, dialect),
  };
}

function toOpenAIMessageContent(
  message: ModelMessage,
  dialect: OpenAICompatibleChatDialect
): unknown {
  if (message.role !== "user" || message.attachments === undefined || message.attachments.length === 0) {
    return message.content;
  }
  const parts: Record<string, unknown>[] = [];
  if (message.content.length > 0) {
    parts.push({ type: "text", text: message.content });
  }
  for (const attachment of message.attachments) {
    parts.push(toOpenAIContentPart(attachment, dialect));
  }
  return parts.length === 0 ? message.content : parts;
}

function toOpenAIContentPart(
  attachment: ModelInputAttachment,
  dialect: OpenAICompatibleChatDialect
): Record<string, unknown> {
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
        detail: chatImageDetail(attachment.detail, dialect),
      }),
    };
  }
  if (attachment.kind === "audio") {
    if (attachment.source.kind !== "data") {
      throw new OpenAIModelInputError(
        "OpenAI-compatible Chat Completions audio input requires inline base64 data.",
      );
    }
    const format = chatAudioFormat(attachment.source.mimeType);
    if (format === undefined) {
      throw new OpenAIModelInputError(
        `OpenAI-compatible Chat Completions only accepts wav or mp3 audio input, received ${attachment.source.mimeType}.`,
      );
    }
    return {
      type: "input_audio",
      input_audio: {
        data: attachment.source.data,
        format,
      },
    };
  }
  if (attachment.source.kind === "url") {
    throw new OpenAIModelInputError(
      "OpenAI-compatible Chat Completions does not support URL-backed file attachments; use inline base64 data or a provider file_id.",
    );
  }
  return {
    type: "file",
    file: removeUndefinedValues({
      file_id: attachment.source.kind === "file_id" ? attachment.source.fileId : undefined,
      file_data: attachment.source.kind === "data"
        ? dataUrl(attachment.source.mimeType, attachment.source.data)
        : undefined,
      filename: attachment.filename,
    }),
  };
}

function chatAudioFormat(mimeType: string): "wav" | "mp3" | undefined {
  switch (mimeType.toLowerCase().split(";", 1)[0]?.trim()) {
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    default:
      return undefined;
  }
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

function chatAssistantToolCallContent(
  message: ModelMessage,
  dialect: OpenAICompatibleChatDialect
): string | undefined {
  if (message.content.length === 0) {
    return undefined;
  }
  return dialect.preserveFullAssistantMessage ? message.content : undefined;
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

function chatImageDetail(
  value: Extract<ModelInputAttachment, { readonly kind: "image" }>["detail"],
  dialect: OpenAICompatibleChatDialect
): "auto" | "default" | "low" | "high" | undefined {
  if (value === "low" || value === "high") {
    return value;
  }
  if (value === "auto") {
    return dialect.profileId === "minimax" ? "default" : "auto";
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
