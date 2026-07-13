import type { OpenAIModelRequestSettings } from "../../domain/config/index.js";
import type {
  ModelInputAttachment,
  ModelMessage,
  ModelRequest,
  ModelToolChoice,
} from "../../domain/intelligence/index.js";
import type { ToolDefinition } from "../../domain/tools/index.js";
import { modelVisibleToolDescription } from "../../domain/tools/index.js";
import { buildOpenAIResponsesControlFields } from "./openai-request-settings.js";
import { removeUndefinedValues } from "./provider-value-utils.js";
import { openAIResponsesContinuationItems } from "./openai-responses-continuation.js";
import { OpenAIModelInputError } from "./openai-model-input-error.js";

const MAX_OPENAI_RESPONSES_FILE_BYTES = 50_000_000;
const MAX_OPENAI_RESPONSES_TOTAL_FILE_BYTES = 50_000_000;

export function buildResponsesRequestBody(
  request: ModelRequest,
  model: string,
  stream: boolean,
  requestSettings: OpenAIModelRequestSettings | undefined,
  options: {
    readonly enableWebSearch?: boolean;
  } = {}
): Record<string, unknown> {
  validateResponsesFileAttachmentBudget(request.sanitizedMessages);
  const { instructions, input } = buildInput(request.sanitizedMessages);
  const tools = [
    ...(options.enableWebSearch === true ? [{ type: "web_search", search_context_size: "medium" }] : []),
    ...(request.tools ?? []).map(toResponsesTool),
  ];
  return removeUndefinedValues({
    model,
    input,
    instructions,
    tools: tools.length === 0 ? undefined : tools,
    tool_choice: request.toolChoice === undefined ? undefined : toResponsesToolChoice(request.toolChoice),
    ...(
      buildOpenAIResponsesControlFields({
        requestBudgetMaxOutputTokens: request.budget.maxOutputTokens,
        settings: requestSettings,
        tools: request.tools,
      }) ?? {}
    ),
    stream: stream ? true : undefined,
  });
}

function buildInput(messages: readonly ModelMessage[]): {
  instructions: string | undefined;
  input: unknown[];
} {
  let instructions: string | undefined;
  const input: unknown[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      instructions = instructions === undefined ? msg.content : `${instructions}\n\n${msg.content}`;
      continue;
    }

    if (msg.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: msg.toolCallId,
        output: responsesFunctionCallOutput(msg),
      });
      continue;
    }

    if (msg.role === "assistant") {
      if (msg.toolCalls !== undefined && msg.toolCalls.length > 0) {
        const continuationItems = openAIResponsesContinuationItems(msg);
        if (continuationItems !== undefined) {
          input.push(...continuationItems);
        } else {
          for (const call of msg.toolCalls) {
            input.push({
              type: "function_call",
              call_id: call.callId,
              name: call.toolName,
              arguments: JSON.stringify(call.input),
            });
          }
          if (msg.content.length > 0) {
            input.push({
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: msg.content }],
            });
          }
        }
        continue;
      }
      if (msg.content.length > 0) {
        input.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: msg.content }],
        });
      }
      continue;
    }

    input.push({
      type: "message",
      role: msg.role,
      content: responsesInputContent(msg),
    });
  }

  return { instructions, input };
}

function responsesFunctionCallOutput(message: ModelMessage): string | readonly Record<string, unknown>[] {
  if (message.attachments === undefined || message.attachments.length === 0) {
    return message.content;
  }
  const output: Record<string, unknown>[] = [];
  if (message.content.length > 0) {
    output.push({ type: "input_text", text: message.content });
  }
  for (const attachment of message.attachments) {
    const part = toResponsesInputContentPart(attachment, "tool");
    if (part !== undefined) {
      output.push(part);
    }
  }
  return output.length === 0 ? message.content : output;
}

function responsesInputContent(message: ModelMessage): readonly Record<string, unknown>[] {
  const content: Record<string, unknown>[] = [{ type: "input_text", text: message.content }];
  if (message.role !== "user" || message.attachments === undefined || message.attachments.length === 0) {
    return content;
  }
  for (const attachment of message.attachments) {
    const part = toResponsesInputContentPart(attachment, "user");
    if (part !== undefined) {
      content.push(part);
    }
  }
  return content;
}

function toResponsesInputContentPart(
  attachment: ModelInputAttachment,
  origin: "user" | "tool",
): Record<string, unknown> | undefined {
  if (attachment.kind === "image") {
    return removeUndefinedValues({
      type: "input_image",
      detail: attachment.detail ?? "auto",
      file_id: attachment.source.kind === "file_id" ? attachment.source.fileId : undefined,
      image_url: attachment.source.kind === "url"
        ? attachment.source.url
        : attachment.source.kind === "data"
          ? dataUrl(attachment.source.mimeType, attachment.source.data)
          : undefined,
    });
  }
  if (attachment.kind === "audio") {
    throw new OpenAIModelInputError(
      origin === "user"
        ? "OpenAI Responses does not currently accept audio input attachments; user-origin audio can use an audio-capable Chat Completions model."
        : "OpenAI Responses does not currently accept tool-origin audio attachments, and the current OpenAI Chat Completions adapter cannot preserve their tool-result role either.",
    );
  }
  return removeUndefinedValues({
    type: "input_file",
    detail: attachment.detail,
    file_id: attachment.source.kind === "file_id" ? attachment.source.fileId : undefined,
    file_url: attachment.source.kind === "url" ? attachment.source.url : undefined,
    file_data: attachment.source.kind === "data"
      ? dataUrl(attachment.source.mimeType, attachment.source.data)
      : undefined,
    filename: attachment.filename,
  });
}

function toResponsesTool(definition: ToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    name: definition.name,
    description: modelVisibleToolDescription(definition),
    parameters: definition.inputSchema,
    strict: false,
  };
}

function toResponsesToolChoice(choice: ModelToolChoice): unknown {
  if (choice === "auto" || choice === "none") {
    return choice;
  }
  return {
    type: "function",
    name: choice.function.name,
  };
}

function dataUrl(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`;
}

function validateResponsesFileAttachmentBudget(messages: readonly ModelMessage[]): void {
  let totalBytes = 0;
  let countedFiles = 0;
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      if (attachment.kind !== "file") {
        continue;
      }
      const byteLength = responsesFileByteLength(attachment);
      if (byteLength === undefined) {
        continue;
      }
      countedFiles += 1;
      if (byteLength >= MAX_OPENAI_RESPONSES_FILE_BYTES) {
        throw new OpenAIModelInputError(
          `OpenAI Responses requires each file input to be smaller than ${MAX_OPENAI_RESPONSES_FILE_BYTES} bytes; received ${byteLength} bytes.`,
        );
      }
      totalBytes += byteLength;
      if (totalBytes > MAX_OPENAI_RESPONSES_TOTAL_FILE_BYTES) {
        throw new OpenAIModelInputError(
          `OpenAI Responses file inputs total ${totalBytes} bytes across ${countedFiles} files; the per-request limit is ${MAX_OPENAI_RESPONSES_TOTAL_FILE_BYTES} bytes.`,
        );
      }
    }
  }
}

function responsesFileByteLength(
  attachment: Extract<ModelInputAttachment, { readonly kind: "file" }>,
): number | undefined {
  if (attachment.source.kind === "data") {
    const clean = attachment.source.data.replace(/\s+/gu, "");
    if (clean.length === 0) {
      return 0;
    }
    const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
  }
  if (attachment.byteLength === undefined) {
    // Remote file IDs and URLs may not carry local size metadata. OpenAI
    // remains the final validator when the request size cannot be known here.
    return undefined;
  }
  if (!Number.isSafeInteger(attachment.byteLength) || attachment.byteLength < 0) {
    throw new OpenAIModelInputError("OpenAI Responses file attachment byteLength must be a non-negative safe integer.");
  }
  return attachment.byteLength;
}
