import { encodingForModel, getEncoding, type Tiktoken } from "js-tiktoken";
import type { ModelMessage } from "../../domain/intelligence/index.js";
import type { AgentLoopTokenCounter } from "./contracts.js";

const DEFAULT_MODEL = "gpt-4o";

export function createOpenAITokenCounter(model = DEFAULT_MODEL): AgentLoopTokenCounter {
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
