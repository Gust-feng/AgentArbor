export type OpenAITerminalFinishReason = "stop" | "tool_call";

export type OpenAITerminalVerdict =
  | {
      readonly status: "completed";
      readonly finishReason: OpenAITerminalFinishReason;
    }
  | {
      readonly status: "failed";
      readonly message: string;
      readonly retryable: boolean;
    };

export type OpenAICompatibleChatFinishReason =
  | "stop"
  | "length"
  | "tool_call"
  | "content_filter"
  | "error";

/**
 * Converts provider and SDK spellings into the canonical Chat finish reason.
 * Unknown values deliberately remain undefined so callers cannot treat them as
 * a successful provider terminal state.
 */
export function normalizeOpenAICompatibleChatFinishReason(
  value: unknown,
): OpenAICompatibleChatFinishReason | undefined {
  switch (value) {
    case "stop":
    case "length":
    case "content_filter":
    case "error":
    case "tool_call":
      return value;
    case "tool_calls":
    case "function_call":
      return "tool_call";
    default:
      return undefined;
  }
}

/**
 * OpenAI-compatible Chat may complete only after an explicit stop, or an
 * explicit tool-call finish paired with parsed tool calls. A text payload is
 * not evidence of completion by itself.
 */
export function assessOpenAICompatibleChatTerminal(input: {
  readonly finishReason: unknown;
  readonly hasToolCalls: boolean;
}): OpenAITerminalVerdict {
  const finishReason = normalizeOpenAICompatibleChatFinishReason(input.finishReason);
  if (input.hasToolCalls && finishReason === "tool_call") {
    return { status: "completed", finishReason: "tool_call" };
  }
  if (!input.hasToolCalls && finishReason === "stop") {
    return { status: "completed", finishReason: "stop" };
  }

  if (input.finishReason === undefined || input.finishReason === null) {
    return {
      status: "failed",
      message: "OpenAI-compatible Chat stream ended without a terminal finish reason.",
      retryable: true,
    };
  }
  const display = typeof input.finishReason === "string" && input.finishReason.length > 0
    ? input.finishReason
    : "unknown";
  const reason = input.hasToolCalls
    ? `OpenAI-compatible Chat returned finish reason ${display} (finish_reason=${display}) for a tool-call response; the response is incomplete.`
    : `OpenAI-compatible Chat returned finish reason ${display} (finish_reason=${display}); the response is incomplete.`;
  return {
    status: "failed",
    message: reason,
    retryable: finishReason === "length" || finishReason === undefined,
  };
}

/**
 * Responses keeps tool calls and final text under one response status. Even a
 * complete function-call item is not usable when the enclosing response is
 * incomplete, failed, cancelled, or otherwise unknown.
 */
export function assessOpenAIResponsesTerminal(input: {
  readonly status: unknown;
  readonly incompleteReason?: unknown;
  readonly hasToolCalls: boolean;
}): OpenAITerminalVerdict {
  if (input.status === "completed") {
    return {
      status: "completed",
      finishReason: input.hasToolCalls ? "tool_call" : "stop",
    };
  }

  if (input.status === undefined || input.status === null) {
    return {
      status: "failed",
      message: "OpenAI Responses provider stream ended without a terminal response event.",
      retryable: true,
    };
  }
  const status = typeof input.status === "string" && input.status.length > 0
    ? input.status
    : "unknown";
  const incompleteReason = typeof input.incompleteReason === "string" && input.incompleteReason.length > 0
    ? ` (${input.incompleteReason})`
    : "";
  return {
    status: "failed",
    message: `OpenAI Responses returned ${status}${incompleteReason}; the response is incomplete.`,
    retryable: status === "incomplete" && input.incompleteReason !== "content_filter",
  };
}
