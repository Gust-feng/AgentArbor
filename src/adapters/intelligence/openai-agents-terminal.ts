import type {
  Model,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelRetryAdvice,
  ModelRetryAdviceRequest,
  StreamEvent,
} from "@openai/agents";
import { asRecord } from "./provider-value-utils.js";
import {
  assessOpenAICompatibleChatTerminal,
  assessOpenAIResponsesTerminal,
} from "./openai-provider-terminal.js";

export type OpenAIAgentsTerminalProtocol =
  | "openai_responses"
  | "openai_compatible_chat_completions";

type SdkRawResponse = {
  readonly providerData?: unknown;
  readonly output: readonly unknown[];
};

type OpenAIAgentsTerminalObservation = {
  chatFinishReason?: unknown;
  responsesStatus?: unknown;
  responsesIncompleteReason?: unknown;
};

type OpenAIAgentsTerminalAssessment = {
  readonly message: string;
  readonly preserveCanonicalResponse: boolean;
};

class OpenAIAgentsTerminalGuardError extends Error {
  constructor(
    message: string,
    readonly response: SdkRawResponse | undefined,
    readonly preserveCanonicalResponse: boolean,
  ) {
    super(message);
    this.name = "OpenAIAgentsTerminalGuardError";
  }
}

/**
 * Guards the SDK model boundary, before Runner can interpret a turn or invoke
 * any function tool. The same provider is used by the root Agent and AgentTool
 * children, so every model turn crosses this gate.
 */
export function withOpenAIAgentsTerminalGuard(
  provider: ModelProvider,
  protocol: OpenAIAgentsTerminalProtocol,
): ModelProvider {
  return {
    async getModel(modelName?: string): Promise<Model> {
      return new OpenAIAgentsTerminalGuardModel(
        await provider.getModel(modelName),
        protocol,
      );
    },
  };
}

export function openAIAgentsTerminalGuardFailure(error: unknown): string | undefined {
  return error instanceof OpenAIAgentsTerminalGuardError ? error.message : undefined;
}

export function preservedOpenAIAgentsTerminalResponse(error: unknown): SdkRawResponse | undefined {
  return error instanceof OpenAIAgentsTerminalGuardError && error.preserveCanonicalResponse
    ? error.response
    : undefined;
}

class OpenAIAgentsTerminalGuardModel implements Model {
  constructor(
    private readonly inner: Model,
    private readonly protocol: OpenAIAgentsTerminalProtocol,
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const response = await this.inner.getResponse(request);
    this.assertTerminal(response);
    return response;
  }

  async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
    const observation: OpenAIAgentsTerminalObservation = {};
    let sawTerminalResponse = false;
    for await (const event of this.inner.getStreamedResponse(request)) {
      if (event.type === "model") {
        observeOpenAIAgentsTerminalEvent(this.protocol, event.event, observation);
      }
      if (event.type === "response_done") {
        sawTerminalResponse = true;
        this.assertTerminal(event.response, observation);
      }
      yield event;
    }
    if (!sawTerminalResponse) {
      this.assertTerminal(undefined, observation);
    }
  }

  getRetryAdvice(args: ModelRetryAdviceRequest): ModelRetryAdvice | Promise<ModelRetryAdvice | undefined> | undefined {
    if (args.error instanceof OpenAIAgentsTerminalGuardError) {
      return {
        suggested: false,
        reason: "The provider returned a non-completed terminal turn.",
      };
    }
    return this.inner.getRetryAdvice?.(args);
  }

  private assertTerminal(
    response: SdkRawResponse | undefined,
    observation: OpenAIAgentsTerminalObservation = {},
  ): void {
    const assessment = assessOpenAIAgentsTerminal({
      protocol: this.protocol,
      response,
      fallbackChatFinishReason: observation.chatFinishReason,
      fallbackResponsesStatus: observation.responsesStatus,
      fallbackResponsesIncompleteReason: observation.responsesIncompleteReason,
    });
    if (assessment !== undefined) {
      throw new OpenAIAgentsTerminalGuardError(
        assessment.message,
        response,
        assessment.preserveCanonicalResponse,
      );
    }
  }
}

function assessOpenAIAgentsTerminal(input: {
  readonly protocol: OpenAIAgentsTerminalProtocol;
  readonly response: SdkRawResponse | undefined;
  readonly fallbackChatFinishReason?: unknown;
  readonly fallbackResponsesStatus?: unknown;
  readonly fallbackResponsesIncompleteReason?: unknown;
}): OpenAIAgentsTerminalAssessment | undefined {
  if (input.response === undefined) {
    return {
      message: "OpenAI Agents SDK completed without a final provider response.",
      preserveCanonicalResponse: false,
    };
  }

  const providerData = asRecord(input.response.providerData);
  const hasToolCalls = hasSdkToolCalls(input.response.output);
  if (input.protocol === "openai_responses") {
    const incompleteDetails = asRecord(providerData.incomplete_details);
    const terminal = assessOpenAIResponsesTerminal({
      status: providerData.status ?? input.fallbackResponsesStatus,
      incompleteReason: incompleteDetails.reason ?? input.fallbackResponsesIncompleteReason,
      hasToolCalls,
    });
    if (terminal.status === "failed") {
      return { message: terminal.message, preserveCanonicalResponse: false };
    }
  } else {
    const choices = Array.isArray(providerData.choices) ? providerData.choices : [];
    const firstChoice = asRecord(choices[0]);
    const terminal = assessOpenAICompatibleChatTerminal({
      finishReason: firstChoice.finish_reason ?? input.fallbackChatFinishReason,
      hasToolCalls,
    });
    if (terminal.status === "failed") {
      return { message: terminal.message, preserveCanonicalResponse: false };
    }
  }

  const refusal = refusalFromSdkResponse(input.response);
  return refusal === undefined
    ? undefined
    : {
        message: `The model refused the request: ${refusal}`,
        preserveCanonicalResponse: true,
      };
}

function observeOpenAIAgentsTerminalEvent(
  protocol: OpenAIAgentsTerminalProtocol,
  value: unknown,
  observation: OpenAIAgentsTerminalObservation,
): void {
  const event = asRecord(value);
  if (protocol === "openai_compatible_chat_completions") {
    const choices = Array.isArray(event.choices) ? event.choices : [];
    const finishReason = asRecord(choices[0]).finish_reason;
    if (finishReason !== undefined && finishReason !== null) {
      observation.chatFinishReason = finishReason;
    }
    return;
  }

  if (
    event.type !== "response.completed" &&
    event.type !== "response.incomplete" &&
    event.type !== "response.failed" &&
    event.type !== "response.cancelled"
  ) {
    return;
  }
  const response = asRecord(event.response);
  observation.responsesStatus = response.status ?? terminalResponsesStatus(event.type);
  const incompleteDetails = asRecord(response.incomplete_details);
  observation.responsesIncompleteReason = incompleteDetails.reason;
}

function terminalResponsesStatus(type: unknown): string | undefined {
  switch (type) {
    case "response.completed":
      return "completed";
    case "response.incomplete":
      return "incomplete";
    case "response.failed":
      return "failed";
    case "response.cancelled":
      return "cancelled";
    default:
      return undefined;
  }
}

function hasSdkToolCalls(output: readonly unknown[] | undefined): boolean {
  return output?.some((item) => asRecord(item).type === "function_call") === true;
}

function refusalFromSdkResponse(response: SdkRawResponse): string | undefined {
  const providerData = asRecord(response.providerData);
  const choices = Array.isArray(providerData.choices) ? providerData.choices : [];
  const messageRefusal = asRecord(asRecord(choices[0]).message).refusal;
  if (typeof messageRefusal === "string" && messageRefusal.trim().length > 0) {
    return messageRefusal.trim();
  }

  for (const item of response.output ?? []) {
    const refusal = refusalFromOutputItem(asRecord(item));
    if (refusal !== undefined) return refusal;
  }
  const providerOutput = Array.isArray(providerData.output) ? providerData.output : [];
  for (const item of providerOutput) {
    const refusal = refusalFromOutputItem(asRecord(item));
    if (refusal !== undefined) return refusal;
  }
  return undefined;
}

function refusalFromOutputItem(item: Readonly<Record<string, unknown>>): string | undefined {
  if (typeof item.refusal === "string" && item.refusal.trim().length > 0) {
    return item.refusal.trim();
  }
  const content = Array.isArray(item.content) ? item.content : [];
  for (const part of content) {
    const refusal = asRecord(part).refusal;
    if (typeof refusal === "string" && refusal.trim().length > 0) {
      return refusal.trim();
    }
  }
  return undefined;
}
