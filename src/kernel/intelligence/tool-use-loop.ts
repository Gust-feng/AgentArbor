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
  ToolDefinition,
  ToolExecutionBroker,
  ToolExecutionContext,
} from "../../domain/tools/index.js";
import { createId } from "../id.js";
import {
  createToolCompletedMessage,
  createToolApprovalRequiredMessage,
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
  readonly approvedConfirmationIds?: readonly string[];
  readonly publishToolEvent?: (message: ArborMessage) => void;
  readonly abortSignal?: AbortSignal;
};

export type ToolUseLoopPendingApproval = {
  readonly confirmationId: string;
  readonly pendingToolCall: ToolCallRequest;
  readonly messagesBeforeToolCall: readonly ModelMessage[];
  readonly assistantMessage: ModelMessage;
  readonly completedToolResults: readonly ToolCallResult[];
  readonly toolCallsBeforeApproval: readonly ToolCallResult[];
  readonly modelRounds: number;
  readonly rounds: number;
  readonly requestId: string;
};

export type ToolUseLoopResult = {
  readonly finalOutput: ModelResponse;
  readonly toolCalls: readonly ToolCallResult[];
  readonly modelRounds: number;
  readonly rounds: number;
  readonly stoppedReason:
    | "completed"
    | "max_rounds"
    | "max_model_rounds"
    | "no_tool_calls"
    | "approval_required"
    | "cancelled"
    | "error";
  readonly pendingApproval?: ToolUseLoopPendingApproval;
};

export async function executeToolUseLoop(
  options: ToolUseLoopOptions,
  initialRequest: ModelRequest
): Promise<ToolUseLoopResult> {
  return continueToolUseLoopAfterToolResults({
    options,
    initialRequest,
    messages: initialRequest.sanitizedMessages,
    toolCalls: [],
    modelRounds: 0,
    rounds: 0,
    requestId: initialRequest.requestId,
  });
}

export async function resumeToolUseLoopFromApproval(
  options: ToolUseLoopOptions,
  initialRequest: ModelRequest,
  pendingApproval: ToolUseLoopPendingApproval
): Promise<ToolUseLoopResult> {
  if (!options.approvedConfirmationIds?.includes(pendingApproval.confirmationId)) {
    return {
      finalOutput: approvalStillRequiredModelResponse(initialRequest, pendingApproval),
      toolCalls: [
        ...cloneToolResults(pendingApproval.toolCallsBeforeApproval),
        approvalRequiredResultFromPending(pendingApproval),
      ],
      modelRounds: pendingApproval.modelRounds,
      rounds: pendingApproval.rounds,
      stoppedReason: "approval_required",
      pendingApproval: clonePendingApproval(pendingApproval),
    };
  }
  if (options.abortSignal?.aborted === true) {
    return abortedLoopResult(
      initialRequest,
      pendingApproval.toolCallsBeforeApproval,
      pendingApproval.modelRounds,
      pendingApproval.rounds
    );
  }

  const context: ToolExecutionContext = {
    callerAgentId: options.callerAgentId,
    traceId: options.traceId,
    goalId: options.goalId,
    abortSignal: options.abortSignal,
  };
  options.publishToolEvent?.(createToolRequestedMessage({
    request: pendingApproval.pendingToolCall,
    context,
  }));
  const approvedResult = await executeToolCallSafely(options, pendingApproval.pendingToolCall, context);
  publishToolResultEvent(options, approvedResult, context);
  const toolCalls = [...pendingApproval.toolCallsBeforeApproval, approvedResult];
  const rounds = pendingApproval.rounds + 1;
  if (approvedResult.status === "approval_required") {
    return {
      finalOutput: approvalStillRequiredModelResponse(initialRequest, pendingApproval),
      toolCalls: [...toolCalls],
      modelRounds: pendingApproval.modelRounds,
      rounds: pendingApproval.rounds,
      stoppedReason: "approval_required",
      pendingApproval: clonePendingApproval(pendingApproval),
    };
  }
  if (approvedResult.status === "cancelled" || Boolean(options.abortSignal?.aborted)) {
    return abortedLoopResult(initialRequest, toolCalls, pendingApproval.modelRounds, rounds);
  }
  return continueToolUseLoopAfterToolResults({
    options,
    initialRequest,
    messages: [
      ...cloneMessages(pendingApproval.messagesBeforeToolCall),
      cloneModelMessage(pendingApproval.assistantMessage),
      ...pendingApproval.completedToolResults.map(toolResultMessage),
      toolResultMessage(approvedResult),
    ],
    toolCalls,
    modelRounds: pendingApproval.modelRounds,
    rounds,
    requestId: pendingApproval.requestId,
  });
}

async function executeToolCalls(input: {
  readonly options: ToolUseLoopOptions;
  readonly requests: readonly ToolCallRequest[];
  readonly toolDefinitions: readonly ToolDefinition[];
}): Promise<{
  readonly results: readonly ToolCallResult[];
  readonly pendingApproval?: {
    readonly confirmationId: string;
    readonly pendingToolCall: ToolCallRequest;
    readonly completedToolResults: readonly ToolCallResult[];
    readonly requestsForAssistantMessage: readonly ToolCallRequest[];
  };
}> {
  const context: ToolExecutionContext = {
    callerAgentId: input.options.callerAgentId,
    traceId: input.options.traceId,
    goalId: input.options.goalId,
    abortSignal: input.options.abortSignal,
  };
  if (input.requests.every((request) => isReadOnlyToolCall(request, input.toolDefinitions))) {
    input.requests.forEach((request) => input.options.publishToolEvent?.(createToolRequestedMessage({ request, context })));
    const results = await Promise.all(
      input.requests.map((request) => executeToolCallSafely(input.options, request, context))
    );
    results.forEach((result) => {
      publishToolResultEvent(input.options, result, context);
    });
    return { results };
  }
  const results: ToolCallResult[] = [];
  for (let index = 0; index < input.requests.length; index += 1) {
    const request = input.requests[index]!;
    if (input.options.abortSignal?.aborted === true) {
      results.push(cancelledToolResult(request));
      continue;
    }
    input.options.publishToolEvent?.(createToolRequestedMessage({ request, context }));
    const result = await executeToolCallSafely(input.options, request, context);
    publishToolResultEvent(input.options, result, context);
    results.push(result);
    if (result.status === "approval_required") {
      return {
        results,
        pendingApproval: {
          confirmationId: result.confirmationRequest?.confirmationId ?? `confirmation-${result.callId}`,
          pendingToolCall: cloneToolCallRequest(request),
          completedToolResults: cloneToolResults(results.slice(0, -1)),
          requestsForAssistantMessage: input.requests.slice(0, index + 1).map(cloneToolCallRequest),
        },
      };
    }
  }
  return { results };
}

function publishToolResultEvent(
  options: ToolUseLoopOptions,
  result: ToolCallResult,
  context: ToolExecutionContext
): void {
  options.publishToolEvent?.(
    result.status === "completed"
      ? createToolCompletedMessage({ result, context })
      : result.status === "approval_required"
        ? createToolApprovalRequiredMessage({ result, context })
        : createToolFailedMessage({ result, context })
  );
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
      approvedConfirmationIds: options.approvedConfirmationIds,
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

async function continueToolUseLoopAfterToolResults(input: {
  readonly options: ToolUseLoopOptions;
  readonly initialRequest: ModelRequest;
  readonly messages: readonly ModelMessage[];
  readonly toolCalls: readonly ToolCallResult[];
  readonly modelRounds: number;
  readonly rounds: number;
  readonly requestId: string;
}): Promise<ToolUseLoopResult> {
  const maxToolRounds = Math.max(0, Math.floor(input.options.maxToolRounds ?? 5));
  const maxModelRounds = Math.max(1, Math.floor(input.options.maxModelRounds ?? Number.MAX_SAFE_INTEGER));
  const toolDefinitions = input.options.toolCenter
    .list()
    .filter((tool) => input.options.allowedTools === undefined || input.options.allowedTools.includes(tool.name));
  let messages = cloneMessages(input.messages);
  const toolCalls: ToolCallResult[] = [...input.toolCalls];
  let modelRounds = input.modelRounds;
  let rounds = input.rounds;
  let requestId = input.requestId;
  let forcedFinalAttempted = false;

  for (;;) {
    if (input.options.abortSignal?.aborted === true) {
      return abortedLoopResult(input.initialRequest, toolCalls, modelRounds, rounds);
    }
    if (modelRounds >= maxModelRounds) {
      return {
        finalOutput: modelLimitResponse(input.initialRequest, requestId),
        toolCalls,
        modelRounds,
        rounds,
        stoppedReason: "max_model_rounds",
      };
    }
    const finalToolSynthesis = forcedFinalAttempted;
    const response = await input.options.intelligenceChannel.request({
      ...input.initialRequest,
      requestId,
      sanitizedMessages: withIterationWarning(finalToolSynthesis ? withNoMoreToolsInstruction(messages) : messages, {
        modelRounds,
        maxModelRounds,
        toolRounds: rounds,
        maxToolRounds,
      }),
      tools: finalToolSynthesis ? [] : toolDefinitions,
      toolChoice: finalToolSynthesis ? "none" : input.initialRequest.toolChoice ?? (toolDefinitions.length > 0 ? "auto" : "none"),
    }, { abortSignal: input.options.abortSignal });
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
      if (!forcedFinalAttempted && modelRounds < maxModelRounds) {
        forcedFinalAttempted = true;
        requestId = createId("model-request");
        continue;
      }
      return { finalOutput: response, toolCalls, modelRounds, rounds, stoppedReason: "max_rounds" };
    }

    const roundResult = await executeToolCalls({ options: input.options, requests: requestedToolCalls, toolDefinitions });
    toolCalls.push(...roundResult.results);
    if (roundResult.pendingApproval !== undefined) {
      const requestIdForResume = createId("model-request");
      return {
        finalOutput: response,
        toolCalls,
        modelRounds,
        rounds,
        stoppedReason: "approval_required",
        pendingApproval: {
          confirmationId: roundResult.pendingApproval.confirmationId,
          pendingToolCall: cloneToolCallRequest(roundResult.pendingApproval.pendingToolCall),
          messagesBeforeToolCall: cloneMessages(messages),
          assistantMessage: assistantToolCallMessage(response, roundResult.pendingApproval.requestsForAssistantMessage),
          completedToolResults: cloneToolResults(roundResult.pendingApproval.completedToolResults),
          toolCallsBeforeApproval: cloneToolResults([
            ...toolCalls.slice(0, Math.max(0, toolCalls.length - roundResult.results.length)),
            ...roundResult.pendingApproval.completedToolResults,
          ]),
          modelRounds,
          rounds,
          requestId: requestIdForResume,
        },
      };
    }
    const roundResults = roundResult.results;
    rounds += 1;
    messages = [
      ...messages,
      assistantToolCallMessage(response, requestedToolCalls),
      ...roundResults.map(toolResultMessage),
    ];
    requestId = createId("model-request");

    if (modelRounds >= maxModelRounds) {
      return { finalOutput: response, toolCalls, modelRounds, rounds, stoppedReason: "max_model_rounds" };
    }
  }
}

function isReadOnlyToolCall(request: ToolCallRequest, definitions: readonly ToolDefinition[]): boolean {
  return definitions.find((definition) => definition.name === request.toolName)?.metadata?.operationType === "read-only";
}

function cancelledToolResult(request: ToolCallRequest): ToolCallResult {
  return {
    callId: request.callId,
    toolName: request.toolName,
    input: request.input,
    output: undefined,
    status: "cancelled",
    error: "Tool execution cancelled.",
    durationMs: 0,
    projection: {
      uiSummary: "工具执行已取消。",
      diagnosticRef: `tool:${request.callId}:cancelled`,
      truncated: false,
      redacted: true,
    },
  };
}

function abortedLoopResult(
  initialRequest: ModelRequest,
  toolCalls: readonly ToolCallResult[],
  modelRounds: number,
  rounds: number
): ToolUseLoopResult {
  return {
    finalOutput: {
      responseId: `${initialRequest.requestId}-cancelled`,
      requestId: initialRequest.requestId,
      providerId: "agent-turn-runtime",
      providerKind: "fake",
      protocolKind: "openai_compatible_chat_completions",
      model: "cancelled",
      status: "failed",
      outputKind: initialRequest.outputContract.outputKind,
      finishReason: "error",
      validation: {
        status: "failed",
        checkedAt: new Date().toISOString(),
        issues: [{ code: "cancelled", message: "Agent turn was cancelled." }],
      },
      failure: {
        kind: "provider_response",
        message: "Agent turn was cancelled.",
        retryable: false,
      },
      completedAt: new Date().toISOString(),
    },
    toolCalls,
    modelRounds,
    rounds,
    stoppedReason: "cancelled",
  };
}

function approvalStillRequiredModelResponse(
  initialRequest: ModelRequest,
  pendingApproval: ToolUseLoopPendingApproval
): ModelResponse {
  return {
    responseId: `${initialRequest.requestId}-approval-required`,
    requestId: pendingApproval.requestId,
    providerId: "agent-turn-runtime",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "approval-required",
    status: "completed",
    outputKind: initialRequest.outputContract.outputKind,
    textOutput: "Tool execution is paused until the matching confirmation is approved.",
    finishReason: "stop",
    validation: {
      status: "passed",
      checkedAt: new Date().toISOString(),
      issues: [],
    },
    completedAt: new Date().toISOString(),
  };
}

function modelLimitResponse(initialRequest: ModelRequest, requestId: string): ModelResponse {
  return {
    responseId: `${requestId}-max-model-rounds`,
    requestId,
    providerId: "agent-turn-runtime",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "max-model-rounds",
    status: "failed",
    outputKind: initialRequest.outputContract.outputKind,
    finishReason: "error",
    validation: {
      status: "failed",
      checkedAt: new Date().toISOString(),
      issues: [{ code: "max_model_rounds", message: "Agent turn reached the model round limit." }],
    },
    failure: {
      kind: "provider_response",
      message: "Agent turn reached the model round limit.",
      retryable: false,
    },
    completedAt: new Date().toISOString(),
  };
}

function approvalRequiredResultFromPending(pendingApproval: ToolUseLoopPendingApproval): ToolCallResult {
  return {
    callId: pendingApproval.pendingToolCall.callId,
    toolName: pendingApproval.pendingToolCall.toolName,
    input: globalThis.structuredClone(pendingApproval.pendingToolCall.input),
    output: undefined,
    status: "approval_required",
    error: `Tool ${pendingApproval.pendingToolCall.toolName} still requires user confirmation.`,
    durationMs: 0,
    confirmationRequest: {
      confirmationId: pendingApproval.confirmationId,
      runId: pendingApproval.pendingToolCall.callId,
      title: "需要确认",
      actionSummary: `工具 ${pendingApproval.pendingToolCall.toolName} 需要用户确认后才能执行。`,
      affectedResources: [],
      riskLevel: "medium",
      requestedAt: new Date().toISOString(),
      sourceRefs: [`tool:${pendingApproval.pendingToolCall.callId}`],
    },
  };
}

function clonePendingApproval(pendingApproval: ToolUseLoopPendingApproval): ToolUseLoopPendingApproval {
  return {
    confirmationId: pendingApproval.confirmationId,
    pendingToolCall: cloneToolCallRequest(pendingApproval.pendingToolCall),
    messagesBeforeToolCall: cloneMessages(pendingApproval.messagesBeforeToolCall),
    assistantMessage: cloneModelMessage(pendingApproval.assistantMessage),
    completedToolResults: cloneToolResults(pendingApproval.completedToolResults),
    toolCallsBeforeApproval: cloneToolResults(pendingApproval.toolCallsBeforeApproval),
    modelRounds: pendingApproval.modelRounds,
    rounds: pendingApproval.rounds,
    requestId: pendingApproval.requestId,
  };
}

function assistantToolCallMessage(
  response: ModelResponse,
  requestedToolCalls: readonly ToolCallRequest[]
): ModelMessage {
  if (response.assistantMessage?.role === "assistant") {
    return cloneModelMessage({
      ...response.assistantMessage,
      content: response.assistantMessage.content ?? response.textOutput ?? "",
      toolCalls: requestedToolCalls.map(cloneToolCallRequest),
    });
  }
  return {
    role: "assistant",
    content: response.textOutput ?? "",
    toolCalls: requestedToolCalls.map(cloneToolCallRequest),
  };
}

function toolResultMessage(result: ToolCallResult): ModelMessage {
  return {
    role: "tool",
    content: truncateToolMessageContent(JSON.stringify({
      callId: result.callId,
      toolName: result.toolName,
      status: result.status,
      output: toSafeToolEventValue(result.output),
      error: result.error,
      durationMs: result.durationMs,
    })),
    toolCallId: result.callId,
    toolName: result.toolName,
  };
}

const MAX_TOOL_MESSAGE_CHARS = 40_000;

function withIterationWarning(messages: readonly ModelMessage[], input: {
  readonly modelRounds: number;
  readonly maxModelRounds: number;
  readonly toolRounds: number;
  readonly maxToolRounds: number;
}): readonly ModelMessage[] {
  const nextModelRound = input.modelRounds + 1;
  const finalModelRound = input.modelRounds > 0 && nextModelRound >= input.maxModelRounds;
  const finalToolRound = input.maxToolRounds > 0 && input.toolRounds >= input.maxToolRounds;
  if (!finalModelRound && !finalToolRound) {
    return messages;
  }
  return [
    ...messages,
    {
      role: "system",
      content:
        "Iteration warning: this turn is close to its model/tool round limit. Do not start broad new exploration unless essential; synthesize the available evidence, mention uncertainty, and produce a useful final answer if possible.",
      ref: "prompt:tool_use.iteration_warning.v1",
    },
  ];
}

function withNoMoreToolsInstruction(messages: readonly ModelMessage[]): readonly ModelMessage[] {
  return [
    ...messages,
    {
      role: "system",
      content:
        "Tool round limit reached. Do not call more tools. Synthesize a useful final answer from the available safe tool summaries, cite uncertainty, and ask for confirmation if a write or execution action is still needed.",
      ref: "prompt:tool_use.no_more_tools.v1",
    },
  ];
}

function truncateToolMessageContent(value: string): string {
  if (value.length <= MAX_TOOL_MESSAGE_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_TOOL_MESSAGE_CHARS - 80)}... [tool message truncated to ${MAX_TOOL_MESSAGE_CHARS} chars]`;
}

function cloneMessages(messages: readonly ModelMessage[]): ModelMessage[] {
  return messages.map(cloneModelMessage);
}

function cloneModelMessage(message: ModelMessage): ModelMessage {
  return {
    ...message,
    protocolExtensions:
      message.protocolExtensions === undefined ? undefined : globalThis.structuredClone(message.protocolExtensions),
    toolCalls: message.toolCalls?.map(cloneToolCallRequest),
  };
}

function cloneToolCallRequest(request: ToolCallRequest): ToolCallRequest {
  return {
    callId: request.callId,
    toolName: request.toolName,
    input: globalThis.structuredClone(request.input),
  };
}

function cloneToolResults(results: readonly ToolCallResult[]): ToolCallResult[] {
  return results.map((result) => ({
    ...result,
    input: globalThis.structuredClone(result.input),
    output: globalThis.structuredClone(result.output),
    projection:
      result.projection === undefined ? undefined : globalThis.structuredClone(result.projection),
    confirmationRequest:
      result.confirmationRequest === undefined ? undefined : globalThis.structuredClone(result.confirmationRequest),
  }));
}
