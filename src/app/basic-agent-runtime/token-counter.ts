import { encodingForModel, getEncoding, type Tiktoken } from "js-tiktoken";
import type { ModelMessage } from "../../domain/intelligence/index.js";

export type BasicAgentTokenCounter = {
  readonly source: "openai_tiktoken";
  readonly model: string;
  countText(text: string): number;
  countMessage(message: Pick<ModelMessage, "role" | "content">): number;
  countMessages(messages: readonly Pick<ModelMessage, "role" | "content">[]): number;
};

const DEFAULT_MODEL = "gpt-4o";

export function createOpenAITokenCounter(model = DEFAULT_MODEL): BasicAgentTokenCounter {
  const encoding = encodingForOpenAIModel(model);
  return {
    source: "openai_tiktoken",
    model,
    countText(text) {
      return encoding.encode(text).length;
    },
    countMessage(message) {
      return encoding.encode(serializeMessageForTokenBudget(message)).length;
    },
    countMessages(messages) {
      return encoding.encode(messages.map(serializeMessageForTokenBudget).join("\n")).length;
    },
  };
}

function encodingForOpenAIModel(model: string): Tiktoken {
  try {
    return encodingForModel(model as never);
  } catch {
    return getEncoding("o200k_base");
  }
}

function serializeMessageForTokenBudget(message: Pick<ModelMessage, "role" | "content">): string {
  return `<message role="${message.role}">\n${message.content}\n</message>`;
}
