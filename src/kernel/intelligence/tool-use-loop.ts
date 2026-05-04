import type { ArborMessage } from "../../domain/common.js";
import type {
  IntelligenceChannel,
  ModelMessage,
  ModelRequest,
  ModelResponse,
} from "../../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolExecutionBroker,
  ToolExecutionContext,
} from "../../domain/tools/index.js";
import { createId } from "../id.js";
import {
  createToolCompletedMessage,
  createToolFailedMessage,
  createToolRequestedMessage,
  toSafeToolEventValue,
} from "./tool-events.js";

export type ToolUseLoopOptions = {
  readonly intelligenceChannel: IntelligenceChannel;
  readonly toolCenter: ToolExecutionBroker;
  readonly callerAgentId: string;
  readonly traceId: string;
  readonly goalId: string;
  readonly maxModelRounds?: number;
  readonly maxToolRounds?: number;
  readonly allowedTools?: readonly string[];
  readonly publishToolEvent?: (message: ArborMessage) => void;
};

export type ToolUseLoopResult = {
  readonly finalOutput: ModelResponse;
  readonly toolCalls: readonly ToolCallResult[];
  readonly modelRounds: number;
  readonly rounds: number;
  readonly stoppedReason: "completed" | "max_rounds" | "max_model_rounds" | "no_tool_calls" | "error";
};

export async function executeToolUseLoop(
  options: ToolUseLoopOptions,
  initialRequest: ModelRequest
): Promise<ToolUseLoopResult> {
  const maxToolRounds = Math.max(0, Math.floor(options.maxToolRounds ?? 5));
  const maxModelRounds = Math.max(1, Math.floor(options.maxModelRounds ?? Number.MAX_SAFE_INTEGER));
  const toolDefinitions = options.toolCenter
    .list()
    .filter((tool) => options.allowedTools === undefined || options.allowedTools.includes(tool.name));
  let messages = cloneMessages(initialRequest.sanitizedMessages);
  const toolCalls: ToolCallResult[] = [];
  let modelRounds = 0;
  let rounds = 0;
  let requestId = initialRequest.requestId;

  for (;;) {
    if (modelRounds >= maxModelRounds) {
      throw new Error("executeToolUseLoop reached maxModelRounds before issuing a model request.");
    }
    const response = await options.intelligenceChannel.request({
      ...initialRequest,
      requestId,
      sanitizedMessages: messages,
      tools: toolDefinitions,
      toolChoice: initialRequest.toolChoice ?? (toolDefinitions.length > 0 ? "auto" : "none"),
    });
    modelRounds += 1;

    if (response.status !== "completed") {
      return { finalOutput: response, toolCalls, modelRounds, rounds, stoppedReason: "error" };
    }

    const requestedToolCalls = response.toolCalls ?? [];
    if (requestedToolCalls.length === 0) {
      return {
        finalOutput: response,
        toolCalls,
        modelRounds,
        rounds,
        stoppedReason: toolCalls.length > 0 ? "completed" : "no_tool_calls",
      };
    }

    if (rounds >= maxToolRounds) {
      return { finalOutput: response, toolCalls, modelRounds, rounds, stoppedReason: "max_rounds" };
    }

    const roundResults = await executeToolCalls({ options, requests: requestedToolCalls });
    toolCalls.push(...roundResults);
    rounds += 1;
    messages = [
      ...messages,
      {
        role: "assistant",
        content: "",
        toolCalls: requestedToolCalls.map(cloneToolCallRequest),
      },
      ...roundResults.map(toolResultMessage),
    ];
    requestId = createId("model-request");

    if (modelRounds >= maxModelRounds) {
      return { finalOutput: response, toolCalls, modelRounds, rounds, stoppedReason: "max_model_rounds" };
    }

    if (rounds >= maxToolRounds) {
      return { finalOutput: response, toolCalls, modelRounds, rounds, stoppedReason: "max_rounds" };
    }
  }
}

async function executeToolCalls(input: {
  readonly options: ToolUseLoopOptions;
  readonly requests: readonly ToolCallRequest[];
}): Promise<ToolCallResult[]> {
  const context: ToolExecutionContext = {
    callerAgentId: input.options.callerAgentId,
    traceId: input.options.traceId,
    goalId: input.options.goalId,
  };
  const results: ToolCallResult[] = [];
  for (const request of input.requests) {
    input.options.publishToolEvent?.(createToolRequestedMessage({ request, context }));
    const result = await executeToolCallSafely(input.options, request, context);
    input.options.publishToolEvent?.(
      result.status === "completed"
        ? createToolCompletedMessage({ result, context })
        : createToolFailedMessage({ result, context })
    );
    results.push(result);
  }
  return results;
}

async function executeToolCallSafely(
  options: ToolUseLoopOptions,
  request: ToolCallRequest,
  context: ToolExecutionContext
): Promise<ToolCallResult> {
  try {
    return await options.toolCenter.execute(request, context, {
      callerAgentId: options.callerAgentId,
      allowedTools: options.allowedTools,
    });
  } catch (error) {
    return {
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: undefined,
      status: "failed",
      error: error instanceof Error ? error.message : "Tool execution failed.",
      durationMs: 0,
    };
  }
}

function toolResultMessage(result: ToolCallResult): ModelMessage {
  return {
    role: "tool",
    content: JSON.stringify({
      callId: result.callId,
      toolName: result.toolName,
      status: result.status,
      output: toSafeToolEventValue(result.output),
      error: result.error,
      durationMs: result.durationMs,
    }),
    toolCallId: result.callId,
    toolName: result.toolName,
  };
}

function cloneMessages(messages: readonly ModelMessage[]): ModelMessage[] {
  return messages.map((message) => ({
    ...message,
    toolCalls: message.toolCalls?.map(cloneToolCallRequest),
  }));
}

function cloneToolCallRequest(request: ToolCallRequest): ToolCallRequest {
  return {
    callId: request.callId,
    toolName: request.toolName,
    input: globalThis.structuredClone(request.input),
  };
}
