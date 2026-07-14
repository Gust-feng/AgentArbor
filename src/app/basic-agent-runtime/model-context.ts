import {
  persistedModelProtocolExtensions,
  type ModelMessage,
  type ModelResponse,
} from "../../domain/intelligence/index.js";
import type { RuntimeOrdinaryModelContextRecord } from "../../domain/runtime-database/index.js";

export function ordinaryModelContextFromTurn(input: {
  readonly runId: string;
  readonly contextMessages: readonly ModelMessage[] | undefined;
  readonly finalOutput: ModelResponse | undefined;
  readonly completed: boolean;
}): RuntimeOrdinaryModelContextRecord | undefined {
  if (input.contextMessages === undefined) {
    return undefined;
  }
  const messages = input.contextMessages.map(persistableModelContextMessage);
  if (input.completed) {
    const finalMessage = finalAssistantMessage(input.finalOutput);
    if (finalMessage !== undefined) {
      messages.push(persistableModelContextMessage(finalMessage));
    }
  }
  return {
    runId: input.runId,
    messages,
  };
}

export function modelContextMessagesForNextTurn(
  context: RuntimeOrdinaryModelContextRecord | undefined,
): readonly ModelMessage[] {
  if (context === undefined) {
    return [];
  }
  return context.messages
    .filter((message) => !isOrdinaryRootPromptMessage(message))
    .map(clonePersistedModelContextMessage);
}

function finalAssistantMessage(response: ModelResponse | undefined): ModelMessage | undefined {
  if (response === undefined || response.status !== "completed") {
    return undefined;
  }
  if (response.assistantMessage !== undefined) {
    return response.assistantMessage;
  }
  const content = response.textOutput ?? (typeof response.structuredOutput === "string" ? response.structuredOutput : "");
  return content.length === 0 ? undefined : { role: "assistant", content };
}

function persistableModelContextMessage(message: ModelMessage): ModelMessage {
  const protocolExtensions = persistedModelProtocolExtensions(message.protocolExtensions);
  return {
    role: message.role,
    content: message.content,
    ref: message.ref,
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    toolCalls: message.toolCalls?.map((call) => ({
      callId: call.callId,
      toolName: call.toolName,
      input: globalThis.structuredClone(call.input),
    })),
    protocolExtensions,
  };
}

function clonePersistedModelContextMessage(message: ModelMessage): ModelMessage {
  return {
    ...message,
    attachments: undefined,
    toolCalls: message.toolCalls?.map((call) => ({
      callId: call.callId,
      toolName: call.toolName,
      input: globalThis.structuredClone(call.input),
    })),
    protocolExtensions:
      message.protocolExtensions === undefined
        ? undefined
        : globalThis.structuredClone(message.protocolExtensions),
  };
}

function isOrdinaryRootPromptMessage(message: ModelMessage): boolean {
  return message.role === "system" && message.ref?.startsWith("context:system:") === true;
}
