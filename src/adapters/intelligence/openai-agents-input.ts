import type { AgentInputItem } from "@openai/agents";
import {
  OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION,
  persistedModelProtocolExtensions,
  type ModelInputAttachment,
  type ModelMessage,
} from "../../domain/intelligence/index.js";
import type { ToolCallRequest, ToolCallResult, ToolFactValue } from "../../domain/tools/index.js";
import { canonicalToolResultMessage } from "../../app/model-runtime/tool-result-message.js";
import { OpenAIModelInputError } from "./openai-model-input-error.js";
import { openAIResponsesContinuationItems } from "./openai-responses-continuation.js";
import { openAIResponsesOutputItems } from "./openai-responses-continuation.js";
import { validateResponsesFileAttachmentBudget } from "./openai-responses-request.js";
import { filterOpenAIChatContinuationExtensions } from "./openai-compatible-chat-protocol-extensions.js";

export type OpenAIAgentsInputProtocol =
  | "openai_responses"
  | "openai_compatible_chat_completions";

type SdkUserContent = Extract<AgentInputItem, { readonly role: "user" }>["content"];
type SdkUserContentPart = Exclude<SdkUserContent, string>[number];
type SdkToolOutput = Extract<AgentInputItem, { readonly type: "function_call_result" }>["output"];
type SdkToolOutputPart = Extract<SdkToolOutput, readonly unknown[]>[number];
type SdkAttachmentPart = Extract<SdkUserContentPart, { readonly type: "input_image" | "input_file" }>;

export interface OpenAIAgentsInputMapper {
  readonly protocol: OpenAIAgentsInputProtocol;
  messages(instructions: string): AgentInputItem[];
  toolResult(result: ToolCallResult): SdkToolOutput;
}

/**
 * Starts a target-protocol context segment from portable conversation facts.
 * Native continuation fields remain exact only while their owning protocol is
 * active; a protocol switch keeps messages and completed tool facts but drops
 * continuation state that the target protocol cannot consume.
 */
export function modelMessagesForOpenAIProtocol(input: {
  readonly protocol: OpenAIAgentsInputProtocol;
  readonly messages: readonly ModelMessage[];
}): readonly ModelMessage[] {
  return input.messages.map((message) => {
    const { protocolExtensions: _incompatibleExtensions, ...portable } = globalThis.structuredClone(message);
    const protocolExtensions = protocolExtensionsForOpenAIProtocol(
      input.protocol,
      message.protocolExtensions,
    );
    return protocolExtensions === undefined
      ? portable
      : { ...portable, protocolExtensions };
  });
}

/** Maps AgentArbor's canonical messages to SDK input without changing attachment origin roles. */
export function createOpenAIAgentsInputMapper(input: {
  readonly protocol: OpenAIAgentsInputProtocol;
  readonly messages: readonly ModelMessage[];
}): OpenAIAgentsInputMapper {
  const messages = modelMessagesForOpenAIProtocol(input);
  const responseToolAttachmentMessages: ModelMessage[] = [];
  return {
    protocol: input.protocol,
    messages: (instructions) => modelMessagesToSdkInput({
      instructions,
      messages,
      protocol: input.protocol,
    }),
    toolResult: (result) => {
      const message = canonicalToolResultMessage(result);
      if (message.attachments === undefined || message.attachments.length === 0) {
        return message.content;
      }
      if (input.protocol === "openai_responses") {
        validateResponsesFileAttachmentBudget([
          ...messages,
          ...responseToolAttachmentMessages,
          message,
        ]);
        responseToolAttachmentMessages.push(globalThis.structuredClone(message));
      }
      return sdkToolMessageOutput(message, input.protocol);
    },
  };
}

/** Rebuilds the exact canonical request history presented to the SDK model boundary. */
export function canonicalMessagesFromOpenAIAgentsInput(input: {
  readonly protocol: OpenAIAgentsInputProtocol;
  readonly instructions?: string;
  readonly items: readonly unknown[];
}): readonly ModelMessage[] {
  const messages: ModelMessage[] = input.instructions === undefined
    ? []
    : [{ role: "system", content: input.instructions }];
  let assistantItems: unknown[] = [];
  const flushAssistant = (): void => {
    if (assistantItems.length === 0) return;
    const calls = assistantItems.flatMap(canonicalToolCallFromSdkItem);
    const content = assistantItems.flatMap(assistantTextFromSdkItem).join("");
    const protocolExtensions = input.protocol === "openai_responses"
      ? responsesExtensions(assistantItems)
      : chatExtensions(assistantItems);
    if (calls.length > 0 || content.length > 0 || protocolExtensions !== undefined) {
      messages.push({
        role: "assistant",
        content,
        toolCalls: calls.length === 0 ? undefined : calls,
        protocolExtensions,
      });
    }
    assistantItems = [];
  };

  for (const rawItem of input.items) {
    const item = asRecord(rawItem);
    if (item.role === "system") {
      flushAssistant();
      if (messages.length === 0 && typeof item.content === "string") {
        messages.push({ role: "system", content: item.content });
      }
      continue;
    }
    if (item.role === "user") {
      flushAssistant();
      messages.push(canonicalUserMessage(item));
      continue;
    }
    if (item.type === "function_call_result") {
      flushAssistant();
      messages.push(canonicalToolMessage(item));
      continue;
    }
    assistantItems.push(rawItem);
  }
  flushAssistant();
  return messages;
}

function modelMessagesToSdkInput(input: {
  readonly instructions: string;
  readonly messages: readonly ModelMessage[];
  readonly protocol: OpenAIAgentsInputProtocol;
}): AgentInputItem[] {
  if (input.protocol === "openai_responses") {
    validateResponsesFileAttachmentBudget(input.messages);
  }
  const items: AgentInputItem[] = [];
  let nonSystemSeen = false;
  let systemSeen = false;
  for (const message of input.messages) {
    if ((message.attachments?.length ?? 0) > 0 && message.role !== "user" && message.role !== "tool") {
      throw new OpenAIModelInputError(`OpenAI ${message.role} messages cannot carry model input attachments.`);
    }
    if (message.role === "system") {
      if (nonSystemSeen || systemSeen || message.content !== input.instructions) {
        throw new Error("AgentLoop messages may only contain one leading system message equal to instructions.");
      }
      systemSeen = true;
      continue;
    }
    nonSystemSeen = true;
    if (message.role === "user") {
      items.push({ role: "user", content: sdkUserContent(message, input.protocol) });
      continue;
    }
    if (message.role === "tool") {
      if (message.toolCallId === undefined || message.toolName === undefined) {
        throw new Error("Canonical tool messages require toolCallId and toolName.");
      }
      items.push({
        type: "function_call_result",
        callId: message.toolCallId,
        name: message.toolName,
        status: "completed",
        output: sdkToolMessageOutput(message, input.protocol),
      });
      continue;
    }
    if (input.protocol === "openai_responses" && message.protocolExtensions !== undefined) {
      persistedModelProtocolExtensions(message.protocolExtensions);
      const continuationItems = openAIResponsesContinuationItems(message);
      if (continuationItems !== undefined) {
        items.push(...continuationItems as AgentInputItem[]);
        continue;
      }
    }
    if (input.protocol === "openai_compatible_chat_completions" && message.content.length > 0) {
      items.push(sdkAssistantTextItem(message));
    }
    for (const [callIndex, call] of (message.toolCalls ?? []).entries()) {
      items.push({
        type: "function_call",
        callId: call.callId,
        name: call.toolName,
        status: "completed",
        arguments: JSON.stringify(call.input),
        providerData: input.protocol === "openai_compatible_chat_completions" && callIndex === 0
          ? chatProviderData(message.protocolExtensions)
          : undefined,
      });
    }
    if (input.protocol === "openai_responses" && message.content.length > 0) {
      items.push(sdkAssistantTextItem(message));
    }
  }
  return items;
}

function sdkAssistantTextItem(message: ModelMessage): AgentInputItem {
  return {
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: message.content }],
    providerData: (message.toolCalls?.length ?? 0) === 0
      ? chatProviderData(message.protocolExtensions)
      : undefined,
  };
}

function protocolExtensionsForOpenAIProtocol(
  protocol: OpenAIAgentsInputProtocol,
  extensions: ModelMessage["protocolExtensions"],
): Readonly<Record<string, unknown>> | undefined {
  if (extensions === undefined) return undefined;
  if (protocol === "openai_responses") {
    if (!Object.prototype.hasOwnProperty.call(extensions, OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION)) {
      return undefined;
    }
    return persistedModelProtocolExtensions({
      [OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION]: extensions[OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION],
    });
  }
  const chatExtensions = filterOpenAIChatContinuationExtensions({ ...extensions });
  return persistedModelProtocolExtensions(chatExtensions);
}

function canonicalUserMessage(item: Record<string, unknown>): ModelMessage {
  if (typeof item.content === "string") {
    return { role: "user", content: item.content };
  }
  const parts = Array.isArray(item.content) ? item.content.map(asRecord) : [];
  const content = parts.flatMap((part) => part.type === "input_text" && typeof part.text === "string"
    ? [part.text]
    : []).join("");
  const attachments = parts.flatMap((part, index) => {
    const attachment = canonicalAttachment(part, index);
    return attachment === undefined ? [] : [attachment];
  });
  return {
    role: "user",
    content,
    attachments: attachments.length === 0 ? undefined : attachments,
  };
}

function canonicalToolMessage(item: Record<string, unknown>): ModelMessage {
  const callId = typeof item.callId === "string" ? item.callId : "missing-tool-call-id";
  const toolName = typeof item.name === "string" ? item.name : "unknown_tool";
  if (typeof item.output === "string") {
    return { role: "tool", content: item.output, toolCallId: callId, toolName };
  }
  const parts = Array.isArray(item.output) ? item.output.map(asRecord) : [];
  const content = parts.flatMap((part) => part.type === "input_text" && typeof part.text === "string"
    ? [part.text]
    : []).join("");
  const attachments = parts.flatMap((part, index) => {
    const attachment = canonicalAttachment(part, index);
    return attachment === undefined ? [] : [attachment];
  });
  return {
    role: "tool",
    content,
    toolCallId: callId,
    toolName,
    attachments: attachments.length === 0 ? undefined : attachments,
  };
}

function canonicalToolCallFromSdkItem(value: unknown): readonly ToolCallRequest[] {
  const item = asRecord(value);
  const callId = typeof item.callId === "string"
    ? item.callId
    : typeof item.call_id === "string" ? item.call_id : undefined;
  if (item.type !== "function_call" || callId === undefined || typeof item.name !== "string") {
    return [];
  }
  return [{
    callId,
    toolName: item.name,
    input: typeof item.arguments === "string" ? parseJson(item.arguments) : undefined,
  }];
}

function assistantTextFromSdkItem(value: unknown): readonly string[] {
  const item = asRecord(value);
  if (item.role !== "assistant" || !Array.isArray(item.content)) return [];
  return item.content.flatMap((rawPart) => {
    const part = asRecord(rawPart);
    if (part.type === "output_text" && typeof part.text === "string") return [part.text];
    if (part.type === "refusal" && typeof part.refusal === "string") return [part.refusal];
    return [];
  });
}

function responsesExtensions(items: readonly unknown[]): Readonly<Record<string, unknown>> | undefined {
  const outputItems = openAIResponsesOutputItems(items);
  return outputItems === undefined
    ? undefined
    : { [OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION]: outputItems };
}

function chatExtensions(items: readonly unknown[]): Readonly<Record<string, unknown>> | undefined {
  const merged: Record<string, unknown> = {};
  for (const item of items) {
    const record = asRecord(item);
    Object.assign(merged, filterOpenAIChatContinuationExtensions(asRecord(record.providerData)));
    if (Array.isArray(record.content)) {
      for (const part of record.content) {
        Object.assign(
          merged,
          filterOpenAIChatContinuationExtensions(asRecord(asRecord(part).providerData)),
        );
      }
    }
  }
  return Object.keys(merged).length === 0 ? undefined : merged;
}

function chatProviderData(extensions: ModelMessage["protocolExtensions"]): Record<string, unknown> | undefined {
  if (extensions === undefined) return undefined;
  const filtered = filterOpenAIChatContinuationExtensions({ ...extensions });
  return Object.keys(filtered).length === 0 ? undefined : filtered;
}

function canonicalAttachment(part: Record<string, unknown>, index: number): ModelInputAttachment | undefined {
  if (part.type === "input_image") {
    const source = attachmentSource(part.image);
    if (source === undefined) return undefined;
    return {
      kind: "image",
      source,
      attachmentId: `sdk-image-${index}`,
      detail: part.detail === "low" || part.detail === "high" || part.detail === "auto"
        ? part.detail
        : undefined,
    };
  }
  if (part.type === "input_file") {
    const source = attachmentSource(part.file);
    if (source === undefined) return undefined;
    return {
      kind: "file",
      source,
      attachmentId: `sdk-file-${index}`,
      filename: typeof part.filename === "string" ? part.filename : `attachment-${index}`,
    };
  }
  if (part.type === "audio" && typeof part.audio === "string") {
    const format = part.format === "mp3" ? "mp3" : "wav";
    return {
      kind: "audio",
      source: { kind: "data", mimeType: format === "mp3" ? "audio/mpeg" : "audio/wav", data: part.audio },
      attachmentId: `sdk-audio-${index}`,
      filename: `audio-${index}.${format}`,
    };
  }
  return undefined;
}

function attachmentSource(value: unknown): ModelInputAttachment["source"] | undefined {
  if (typeof value === "string") {
    const data = /^data:([^;,]+);base64,(.*)$/su.exec(value);
    if (data !== null) {
      return { kind: "data", mimeType: data[1]!, data: data[2]! };
    }
    return { kind: "url", url: value };
  }
  const record = asRecord(value);
  if (typeof record.id === "string") return { kind: "file_id", fileId: record.id };
  if (typeof record.url === "string") return { kind: "url", url: record.url };
  return undefined;
}

function parseJson(value: string): ToolFactValue | undefined {
  try {
    return JSON.parse(value) as ToolFactValue;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sdkUserContent(
  message: ModelMessage,
  protocol: OpenAIAgentsInputProtocol,
): SdkUserContent {
  if (message.attachments === undefined || message.attachments.length === 0) {
    return message.content;
  }
  const content: SdkUserContentPart[] = [];
  if (message.content.length > 0) {
    content.push({ type: "input_text", text: message.content });
  }
  for (const attachment of message.attachments) {
    content.push(sdkUserAttachment(attachment, protocol));
  }
  return content;
}

function sdkUserAttachment(
  attachment: ModelInputAttachment,
  protocol: OpenAIAgentsInputProtocol,
): SdkUserContentPart {
  if (protocol === "openai_responses") {
    if (attachment.kind === "audio") {
      throw new OpenAIModelInputError(
        "OpenAI Responses does not currently accept audio input attachments; user-origin audio can use an audio-capable Chat Completions model.",
      );
    }
    return sdkResponsesAttachment(attachment);
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
    return { type: "audio", audio: attachment.source.data, format };
  }
  if (attachment.kind === "image") {
    if (attachment.source.kind === "file_id") {
      return sdkInputFile({ source: attachment.source, filename: attachment.filename });
    }
    return {
      type: "input_image",
      image: attachment.source.kind === "url"
        ? attachment.source.url
        : dataUrl(attachment.source.mimeType, attachment.source.data),
      detail: chatImageDetail(attachment.detail),
    };
  }
  if (attachment.source.kind === "url") {
    throw new OpenAIModelInputError(
      "OpenAI-compatible Chat Completions does not support URL-backed file attachments; use inline base64 data or a provider file_id.",
    );
  }
  return sdkInputFile(attachment);
}

function sdkToolMessageOutput(
  message: ModelMessage,
  protocol: OpenAIAgentsInputProtocol,
): SdkToolOutput {
  if (message.attachments === undefined || message.attachments.length === 0) {
    return message.content;
  }
  if (protocol === "openai_compatible_chat_completions") {
    const hasAudio = message.attachments.some((attachment) => attachment.kind === "audio");
    throw new OpenAIModelInputError(
      hasAudio
        ? "OpenAI-compatible Chat Completions cannot attach tool-origin audio without changing its message role. The Responses adapter supports tool-origin image and file attachments, but not audio; AgentArbor currently has no OpenAI role-preserving transport for tool-origin audio."
        : "OpenAI-compatible Chat Completions cannot attach tool-origin image or file content without changing its message role; use the Responses protocol for these tool-origin attachments.",
    );
  }
  const output: SdkToolOutputPart[] = [];
  if (message.content.length > 0) {
    output.push({ type: "input_text", text: message.content });
  }
  for (const attachment of message.attachments) {
    if (attachment.kind === "audio") {
      throw new OpenAIModelInputError(
        "OpenAI Responses does not currently accept tool-origin audio attachments, and the current OpenAI Chat Completions adapter cannot preserve their tool-result role either.",
      );
    }
    output.push(sdkResponsesAttachment(attachment));
  }
  return output;
}

function sdkResponsesAttachment(
  attachment: Exclude<ModelInputAttachment, { readonly kind: "audio" }>,
): SdkAttachmentPart {
  if (attachment.kind === "image") {
    return {
      type: "input_image",
      image: attachment.source.kind === "file_id"
        ? { id: attachment.source.fileId }
        : attachment.source.kind === "url"
          ? attachment.source.url
          : dataUrl(attachment.source.mimeType, attachment.source.data),
      detail: attachment.detail ?? "auto",
    };
  }
  return sdkInputFile(attachment);
}

function sdkInputFile(input: {
  readonly source: ModelInputAttachment["source"];
  readonly filename?: string;
  readonly detail?: "low" | "high";
}): Extract<SdkUserContentPart, { readonly type: "input_file" }> {
  return {
    type: "input_file",
    file: input.source.kind === "file_id"
      ? { id: input.source.fileId }
      : input.source.kind === "url"
        ? { url: input.source.url }
        : dataUrl(input.source.mimeType, input.source.data),
    filename: input.filename,
    providerData: input.detail === undefined ? undefined : { detail: input.detail },
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

function chatImageDetail(
  detail: Extract<ModelInputAttachment, { readonly kind: "image" }>["detail"],
): string | undefined {
  return detail === "original" ? "high" : detail;
}

function dataUrl(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`;
}
