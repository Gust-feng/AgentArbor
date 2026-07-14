import type { AgentInputItem } from "@openai/agents";
import {
  OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION,
  persistedModelProtocolExtensions,
  type ModelInputAttachment,
  type ModelMessage,
} from "../../domain/intelligence/index.js";
import type { ToolCallResult } from "../../domain/tools/index.js";
import { toolModelAttachmentsFromOutput } from "../../domain/tools/index.js";
import { OpenAIModelInputError } from "./openai-model-input-error.js";
import { openAIResponsesContinuationItems } from "./openai-responses-continuation.js";
import { validateResponsesFileAttachmentBudget } from "./openai-responses-request.js";

export type OpenAIAgentsInputProtocol =
  | "openai_responses"
  | "openai_compatible_chat_completions";

type SdkUserContent = Extract<AgentInputItem, { readonly role: "user" }>["content"];
type SdkUserContentPart = Exclude<SdkUserContent, string>[number];
type SdkToolOutput = Extract<AgentInputItem, { readonly type: "function_call_result" }>["output"];
type SdkToolOutputPart = Extract<SdkToolOutput, readonly unknown[]>[number];
type SdkAttachmentPart = Extract<SdkUserContentPart, { readonly type: "input_image" | "input_file" }>;

export interface OpenAIAgentsInputMapper {
  messages(instructions: string): AgentInputItem[];
  toolResult(result: ToolCallResult): SdkToolOutput;
}

/** Maps AgentArbor's canonical messages to SDK input without changing attachment origin roles. */
export function createOpenAIAgentsInputMapper(input: {
  readonly protocol: OpenAIAgentsInputProtocol;
  readonly messages: readonly ModelMessage[];
}): OpenAIAgentsInputMapper {
  const messages = input.messages.map((message) => globalThis.structuredClone(message));
  const responseToolAttachmentMessages: ModelMessage[] = [];
  return {
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

export function canonicalToolResultMessage(result: ToolCallResult): ModelMessage {
  const attachments = toolModelAttachmentsFromOutput(result.output);
  return {
    role: "tool",
    content: JSON.stringify(result),
    toolCallId: result.callId,
    toolName: result.toolName,
    attachments: attachments === undefined
      ? undefined
      : attachments.map((attachment) => globalThis.structuredClone(attachment)),
  };
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
    } else if (
      input.protocol !== "openai_responses" &&
      message.protocolExtensions?.[OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION] !== undefined
    ) {
      throw new Error("Responses protocol output items cannot be replayed through Chat Completions.");
    }
    for (const call of message.toolCalls ?? []) {
      items.push({
        type: "function_call",
        callId: call.callId,
        name: call.toolName,
        status: "completed",
        arguments: JSON.stringify(call.input),
      });
    }
    if (message.content.length > 0) {
      items.push({
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: message.content }],
      });
    }
  }
  return items;
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
