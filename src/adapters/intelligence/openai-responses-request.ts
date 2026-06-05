import type { OpenAIModelRequestSettings } from "../../domain/config/index.js";
import type {
  ModelMessage,
  ModelRequest,
  ModelToolChoice,
} from "../../domain/intelligence/index.js";
import type { ToolDefinition } from "../../domain/tools/index.js";
import { buildOpenAIResponsesControlFields } from "./openai-request-settings.js";
import { removeUndefinedValues } from "./provider-value-utils.js";

export function buildResponsesRequestBody(
  request: ModelRequest,
  model: string,
  stream: boolean,
  requestSettings: OpenAIModelRequestSettings | undefined
): Record<string, unknown> {
  const { instructions, input } = buildInput(request.sanitizedMessages);
  return removeUndefinedValues({
    model,
    input,
    instructions,
    tools: request.tools === undefined || request.tools.length === 0 ? undefined : request.tools.map(toResponsesTool),
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
      content: [{ type: "input_text", text: msg.content }],
    });
  }

  return { instructions, input };
}

function toResponsesTool(definition: ToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    name: definition.name,
    description: definition.description,
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
