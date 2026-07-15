import type {
  Model,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelRetryAdvice,
  ModelRetryAdviceRequest,
  StreamEvent,
} from "@openai/agents";
import {
  filterOpenAIChatContinuationExtensions,
} from "./openai-compatible-chat-protocol-extensions.js";

type JsonRecord = Record<string, unknown>;

/**
 * Keeps compatible-provider request dialects and replay continuation at the
 * model boundary. The SDK may normalize or strip non-OpenAI fields before they
 * reach the concrete model, so this wrapper restores only the frozen profile's
 * request fields and a small allowlist of assistant continuation fields.
 */
export function withOpenAICompatibleChatProfile(
  provider: ModelProvider,
  requestProviderData: Readonly<JsonRecord>,
): ModelProvider {
  return {
    async getModel(modelName?: string): Promise<Model> {
      const model = await provider.getModel(modelName);
      return new OpenAICompatibleChatProfileModel(model, requestProviderData);
    },
  };
}

class OpenAICompatibleChatProfileModel implements Model {
  constructor(
    private readonly inner: Model,
    private readonly requestProviderData: Readonly<JsonRecord>,
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const response = await this.inner.getResponse(this.profileRequest(request));
    return enrichResponse(response, continuationFromChatResponse(response.providerData));
  }

  async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
    const continuation: JsonRecord = {};
    for await (const event of this.inner.getStreamedResponse(this.profileRequest(request))) {
      if (event.type === "model") {
        accumulateChatStreamContinuation(continuation, event.event);
        yield event;
        continue;
      }
      if (event.type === "response_done") {
        yield {
          ...event,
          response: enrichResponse(event.response, continuation),
        };
        continue;
      }
      yield event;
    }
  }

  getRetryAdvice(args: ModelRetryAdviceRequest): ModelRetryAdvice | Promise<ModelRetryAdvice | undefined> | undefined {
    return this.inner.getRetryAdvice?.(args);
  }

  private profileRequest(request: ModelRequest): ModelRequest {
    if (Object.keys(this.requestProviderData).length === 0) return request;
    return {
      ...request,
      modelSettings: {
        ...request.modelSettings,
        providerData: {
          ...request.modelSettings.providerData,
          ...this.requestProviderData,
        },
      },
    };
  }
}

function enrichResponse<T extends Pick<ModelResponse, "output">>(
  response: T,
  continuation: Readonly<JsonRecord>,
): T {
  if (Object.keys(continuation).length === 0) return response;
  const targetIndex = response.output.findIndex((item) => item.type === "function_call");
  const fallbackIndex = targetIndex >= 0
    ? targetIndex
    : response.output.findIndex((item) => item.type === "message");
  if (fallbackIndex < 0) return response;
  const output = response.output.map((item, index) => {
    if (index !== fallbackIndex) return item;
    return {
      ...item,
      providerData: {
        ...asRecord(item.providerData),
        ...continuation,
      },
    };
  });
  return { ...response, output };
}

function continuationFromChatResponse(value: unknown): JsonRecord {
  const response = asRecord(value);
  const choices = Array.isArray(response.choices) ? response.choices : [];
  return filterOpenAIChatContinuationExtensions(asRecord(asRecord(choices[0]).message));
}

function accumulateChatStreamContinuation(target: JsonRecord, value: unknown): void {
  const event = asRecord(value);
  const choices = Array.isArray(event.choices) ? event.choices : [];
  const delta = filterOpenAIChatContinuationExtensions(asRecord(asRecord(choices[0]).delta));
  for (const [key, next] of Object.entries(delta)) {
    const current = target[key];
    if (typeof current === "string" && typeof next === "string") {
      target[key] = `${current}${next}`;
    } else if (Array.isArray(current) && Array.isArray(next)) {
      target[key] = [...current, ...next];
    } else if (isRecord(current) && isRecord(next)) {
      target[key] = { ...current, ...next };
    } else if (current === undefined) {
      target[key] = next;
    }
  }
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
