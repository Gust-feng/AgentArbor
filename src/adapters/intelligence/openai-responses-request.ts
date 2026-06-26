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

export function buildResponsesRequestBody(
  request: ModelRequest,
  model: string,
  stream: boolean,
  requestSettings: OpenAIModelRequestSettings | undefined,
  options: {
    readonly enableWebSearch?: boolean;
  } = {}
): Record<string, unknown> {
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
        output: msg.content,
      });
      continue;
    }

    if (msg.role === "assistant") {
      if (msg.toolCalls !== undefined && msg.toolCalls.length > 0) {
        for (const call of msg.toolCalls) {
          input.push({
            type: "function_call",
            call_id: call.callId,
            name: call.toolName,
            arguments: JSON.stringify(call.input),
          });
        }
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

function responsesInputContent(message: ModelMessage): readonly Record<string, unknown>[] {
  const content: Record<string, unknown>[] = [{ type: "input_text", text: message.content }];
  if (message.role !== "user" || message.attachments === undefined || message.attachments.length === 0) {
    return content;
  }
  for (const attachment of message.attachments) {
    const part = toResponsesInputContentPart(attachment);
    if (part !== undefined) {
      content.push(part);
    }
  }
  return content;
}

function toResponsesInputContentPart(attachment: ModelInputAttachment): Record<string, unknown> | undefined {
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
  return removeUndefinedValues({
    type: "input_file",
    detail: attachment.detail,
    file_id: attachment.source.kind === "file_id" ? attachment.source.fileId : undefined,
    file_url: attachment.source.kind === "url" ? attachment.source.url : undefined,
    file_data: attachment.source.kind === "data" ? attachment.source.data : undefined,
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
