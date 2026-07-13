import type { ModelMessage, ModelRequest, ModelResponse } from "../../domain/intelligence/index.js";
import type { ToolCallResult } from "../../domain/tools/index.js";
import { createId } from "../id.js";
import {
  cloneMessages,
  cloneModelMessage,
  clonePendingApproval,
  cloneToolCallRequest,
  cloneToolResult,
  cloneToolResults,
} from "./tool-use-loop-cloning.js";
import type {
  ToolUseLoopConfirmationDecision,
  ToolUseLoopContextMaintenanceResult,
  ToolUseLoopModelResponseTrace,
  ToolUseLoopOptions,
  ToolUseLoopPendingApproval,
  ToolUseLoopResult,
} from "./tool-use-loop-contracts.js";
import {
  createToolExecutionContext,
  executeSingleToolCall,
  executeToolCalls,
  modelVisibleToolDefinitions,
  publishToolRequestEvent,
  publishToolResultEvent,
} from "./tool-use-loop-execution.js";
import {
  assistantToolCallMessage,
  toolResultMessages,
  toolResultMessagesWithResolvedApprovals,
} from "./tool-use-loop-messages.js";
import {
  abortedLoopResult,
  approvalRequiredResultFromPending,
  approvalStillRequiredModelResponse,
  cancelledApprovalAfterAbortToolResult,
  cancelledPendingApprovalToolResult,
  cancelledToolResult,
  contextOverflowLoopResult,
  confirmationDecisionSkippedToolResult,
  confirmationDecisionToolResult,
  outOfFuelLoopResult,
} from "./tool-use-loop-results.js";
import { createFailedModelResponse } from "./failures.js";

export type {
  ToolUseLoopConfirmationDecision,
  ToolUseLoopContextMaintainer,
  ToolUseLoopContextMaintenanceResult,
  ToolUseLoopModelResponseTrace,
  ToolUseLoopOptions,
  ToolUseLoopPendingApproval,
  ToolUseLoopResult,
} from "./tool-use-loop-contracts.js";

export async function executeToolUseLoop(
  options: ToolUseLoopOptions,
  initialRequest: ModelRequest
): Promise<ToolUseLoopResult> {
  return continueToolUseLoopAfterToolResults({
    options,
    initialRequest,
    messages: initialRequest.sanitizedMessages,
    toolCalls: [],
    modelResponses: [],
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
  assertPendingApprovalContract(pendingApproval);
  return resumeApprovalCore(options, initialRequest, pendingApproval);
}

export async function resumeToolUseLoopFromConfirmationDecision(
  options: ToolUseLoopOptions,
  initialRequest: ModelRequest,
  pendingApproval: ToolUseLoopPendingApproval,
  decision: ToolUseLoopConfirmationDecision
): Promise<ToolUseLoopResult> {
  assertPendingApprovalContract(pendingApproval);
  if (options.abortSignal?.aborted === true) {
    return abortPendingApprovalLoopResult(options, initialRequest, pendingApproval);
  }
  if (decision.confirmationId !== pendingApproval.confirmationId) {
    return unresolvedPendingApprovalLoopResult(initialRequest, pendingApproval);
  }

  const decisionResult = confirmationDecisionToolResult(pendingApproval.pendingToolResult, decision);
  const skippedResults = pendingApproval.remainingToolCallsAfterApproval.map((request) =>
    confirmationDecisionSkippedToolResult(request, decision)
  );
  const decisionRoundResults = [decisionResult, ...skippedResults];
  const context = createToolExecutionContext(options);
  publishToolResultEvent(options, decisionResult, context);
  pendingApproval.remainingToolCallsAfterApproval.forEach((request, index) => {
    publishToolRequestEvent(options, request, context);
    publishToolResultEvent(options, skippedResults[index]!, context);
  });
  const toolCalls = [...pendingApproval.toolCallsBeforeApproval, ...decisionRoundResults];
  return continueToolUseLoopAfterToolResults({
    options,
    initialRequest,
    messages: [
      ...cloneMessages(pendingApproval.messagesBeforeToolCall),
      cloneModelMessage(pendingApproval.assistantMessage),
      ...toolResultMessagesWithResolvedApprovals(cloneToolResults([
        ...pendingApproval.completedToolResults,
        ...decisionRoundResults,
      ]), pendingApproval.resolvedPreApprovalResults),
    ],
    toolCalls,
    modelResponses: [],
    modelRounds: pendingApproval.modelRounds,
    rounds: pendingApproval.rounds + 1,
    requestId: pendingApproval.requestId,
  });
}

async function resumeApprovalCore(
  options: ToolUseLoopOptions,
  initialRequest: ModelRequest,
  pendingApproval: ToolUseLoopPendingApproval
): Promise<ToolUseLoopResult> {
  if (options.abortSignal?.aborted === true) {
    return abortPendingApprovalLoopResult(options, initialRequest, pendingApproval);
  }
  if (!options.approvedConfirmationIds?.includes(pendingApproval.confirmationId)) {
    return unresolvedPendingApprovalLoopResult(initialRequest, pendingApproval);
  }

  const context = createToolExecutionContext(options);
  const approvedResult = await executeSingleToolCall({
    options,
    request: pendingApproval.pendingToolCall,
    context,
    requestAlreadyPublished: true,
  });
  const toolDefinitions = modelVisibleToolDefinitions(options);
  const resolvedPreApprovalResults = [
    ...(pendingApproval.resolvedPreApprovalResults ?? []).map(cloneToolResult),
    cloneToolResult(pendingApproval.pendingToolResult),
  ];
  let toolCalls = [...pendingApproval.toolCallsBeforeApproval, approvedResult];
  if (approvedResult.status === "cancelled" || Boolean(options.abortSignal?.aborted)) {
    return abortAfterApprovedToolResult(
      options,
      initialRequest,
      pendingApproval,
      approvedResult,
      resolvedPreApprovalResults,
    );
  }
  if (approvedResult.status === "approval_required") {
    const nextPendingApproval: ToolUseLoopPendingApproval = {
      ...clonePendingApproval(pendingApproval),
      confirmationId: approvedResult.confirmationRequest?.confirmationId ?? `confirmation-${approvedResult.callId}`,
      pendingToolResult: cloneToolResult(approvedResult),
      resolvedPreApprovalResults,
      confirmationRequest:
        approvedResult.confirmationRequest === undefined
          ? undefined
          : globalThis.structuredClone(approvedResult.confirmationRequest),
    };
    return {
      finalOutput: approvalStillRequiredModelResponse(initialRequest, nextPendingApproval),
      toolCalls,
      modelResponses: [],
      contextMessages: cloneMessages(pendingApproval.messagesBeforeToolCall),
      modelRounds: pendingApproval.modelRounds,
      rounds: pendingApproval.rounds,
      stoppedReason: "approval_required",
      pendingApproval: nextPendingApproval,
    };
  }
  let completedToolResults = [
    ...cloneToolResults(pendingApproval.completedToolResults),
    approvedResult,
  ];
  if (pendingApproval.remainingToolCallsAfterApproval.length > 0) {
    const remaining = await executeToolCalls({
      options,
      requests: pendingApproval.remainingToolCallsAfterApproval,
      toolDefinitions,
    });
    toolCalls = [...toolCalls, ...remaining.results];
    if (remaining.pendingApproval !== undefined) {
      const completedBeforeNextApproval = [
        ...completedToolResults,
        ...remaining.pendingApproval.completedToolResults,
      ];
      const nextPendingApproval: ToolUseLoopPendingApproval = {
        confirmationId: remaining.pendingApproval.confirmationId,
        pendingToolCall: cloneToolCallRequest(remaining.pendingApproval.pendingToolCall),
        pendingToolResult: cloneToolResult(remaining.pendingApproval.pendingToolResult),
        resolvedPreApprovalResults,
        confirmationRequest:
          remaining.pendingApproval.confirmationRequest === undefined
            ? undefined
            : globalThis.structuredClone(remaining.pendingApproval.confirmationRequest),
        remainingToolCallsAfterApproval: remaining.pendingApproval.remainingToolCallsAfterApproval.map(cloneToolCallRequest),
        messagesBeforeToolCall: cloneMessages(pendingApproval.messagesBeforeToolCall),
        assistantMessage: cloneModelMessage(pendingApproval.assistantMessage),
        completedToolResults: cloneToolResults(completedBeforeNextApproval),
        toolCallsBeforeApproval: cloneToolResults([
          ...pendingApproval.toolCallsBeforeApproval,
          approvedResult,
          ...remaining.pendingApproval.completedToolResults,
        ]),
        modelRounds: pendingApproval.modelRounds,
        rounds: pendingApproval.rounds,
        requestId: createId("model-request"),
      };
      if (Boolean(options.abortSignal?.aborted)) {
        return abortPendingApprovalLoopResult(options, initialRequest, nextPendingApproval);
      }
      return {
        finalOutput: approvalStillRequiredModelResponse(initialRequest, nextPendingApproval),
        toolCalls,
        modelResponses: [],
        contextMessages: cloneMessages(pendingApproval.messagesBeforeToolCall),
        modelRounds: pendingApproval.modelRounds,
        rounds: pendingApproval.rounds,
        stoppedReason: "approval_required",
        pendingApproval: nextPendingApproval,
      };
    }
    completedToolResults = [...completedToolResults, ...remaining.results];
  }
  const rounds = pendingApproval.rounds + 1;
  return continueToolUseLoopAfterToolResults({
    options,
    initialRequest,
    messages: [
      ...cloneMessages(pendingApproval.messagesBeforeToolCall),
      cloneModelMessage(pendingApproval.assistantMessage),
      ...toolResultMessagesWithResolvedApprovals(
        completedToolResults,
        resolvedPreApprovalResults,
      ),
    ],
    toolCalls,
    modelResponses: [],
    modelRounds: pendingApproval.modelRounds,
    rounds,
    requestId: pendingApproval.requestId,
  });
}

function unresolvedPendingApprovalLoopResult(
  initialRequest: ModelRequest,
  pendingApproval: ToolUseLoopPendingApproval,
): ToolUseLoopResult {
  return {
    finalOutput: approvalStillRequiredModelResponse(initialRequest, pendingApproval),
    toolCalls: [
      ...cloneToolResults(pendingApproval.toolCallsBeforeApproval),
      approvalRequiredResultFromPending(pendingApproval),
    ],
    modelResponses: [],
    contextMessages: cloneMessages(pendingApproval.messagesBeforeToolCall),
    modelRounds: pendingApproval.modelRounds,
    rounds: pendingApproval.rounds,
    stoppedReason: "approval_required",
    pendingApproval: clonePendingApproval(pendingApproval),
  };
}

function abortPendingApprovalLoopResult(
  options: ToolUseLoopOptions,
  initialRequest: ModelRequest,
  pendingApproval: ToolUseLoopPendingApproval,
): ToolUseLoopResult {
  const context = createToolExecutionContext(options);
  const pendingCancellation = cancelledPendingApprovalToolResult(pendingApproval);
  publishToolResultEvent(options, pendingCancellation, context);
  const skippedResults = pendingApproval.remainingToolCallsAfterApproval.map((request) => {
    const result = cancelledToolResult(request);
    publishToolRequestEvent(options, request, context);
    publishToolResultEvent(options, result, context);
    return result;
  });
  const roundResults = [
    ...cloneToolResults(pendingApproval.completedToolResults),
    pendingCancellation,
    ...skippedResults,
  ];
  return abortedLoopResult(
    initialRequest,
    [
      ...cloneToolResults(pendingApproval.toolCallsBeforeApproval),
      pendingCancellation,
      ...skippedResults,
    ],
    pendingApproval.modelRounds,
    pendingApproval.rounds,
    [],
    [
      ...cloneMessages(pendingApproval.messagesBeforeToolCall),
      cloneModelMessage(pendingApproval.assistantMessage),
      ...toolResultMessagesWithResolvedApprovals(
        roundResults,
        pendingApproval.resolvedPreApprovalResults,
      ),
    ],
  );
}

function abortAfterApprovedToolResult(
  options: ToolUseLoopOptions,
  initialRequest: ModelRequest,
  pendingApproval: ToolUseLoopPendingApproval,
  approvedResult: ToolCallResult,
  resolvedPreApprovalResults: readonly ToolCallResult[],
): ToolUseLoopResult {
  const context = createToolExecutionContext(options);
  const settledApprovedResult = approvedResult.status === "approval_required"
    ? cancelledApprovalAfterAbortToolResult(approvedResult)
    : cloneToolResult(approvedResult);
  if (approvedResult.status === "approval_required") {
    // The broker already published the next approval request. Close that
    // lifecycle explicitly when abort wins the race so no confirmation remains
    // observable after the run has entered its cancelled terminal state.
    publishToolResultEvent(options, settledApprovedResult, context);
  }
  const skippedResults = pendingApproval.remainingToolCallsAfterApproval.map((request) => {
    const result = cancelledToolResult(request);
    publishToolRequestEvent(options, request, context);
    publishToolResultEvent(options, result, context);
    return result;
  });
  const roundResults = [
    ...cloneToolResults(pendingApproval.completedToolResults),
    settledApprovedResult,
    ...skippedResults,
  ];
  return abortedLoopResult(
    initialRequest,
    [
      ...cloneToolResults(pendingApproval.toolCallsBeforeApproval),
      settledApprovedResult,
      ...skippedResults,
    ],
    pendingApproval.modelRounds,
    pendingApproval.rounds,
    [],
    [
      ...cloneMessages(pendingApproval.messagesBeforeToolCall),
      cloneModelMessage(pendingApproval.assistantMessage),
      ...toolResultMessagesWithResolvedApprovals(roundResults, resolvedPreApprovalResults),
    ],
  );
}

function assertPendingApprovalContract(pendingApproval: ToolUseLoopPendingApproval): void {
  const pendingResult = pendingApproval.pendingToolResult;
  const resultConfirmationId = pendingResult.confirmationRequest?.confirmationId;
  const mirroredConfirmationId = pendingApproval.confirmationRequest?.confirmationId;
  // The mirrored request is what downstream surfaces may show to the user.
  // Bind every approval fact to the broker result before executing the call.
  const confirmationFactsMatch = contractFactsEqual(
    pendingResult.confirmationRequest,
    pendingApproval.confirmationRequest,
  );
  const requestsThatMayExecute = [
    pendingApproval.pendingToolCall,
    ...pendingApproval.remainingToolCallsAfterApproval,
  ];
  const assistantToolCalls = pendingApproval.assistantMessage.role === "assistant"
    ? pendingApproval.assistantMessage.toolCalls ?? []
    : [];
  const assistantCallIds = new Set<string>();
  const assistantPairingIsValid = assistantToolCalls.every((assistantCall) => {
    if (assistantCallIds.has(assistantCall.callId)) {
      return false;
    }
    assistantCallIds.add(assistantCall.callId);
    return true;
  }) && requestsThatMayExecute.every((request, index, requests) => {
    if (requests.findIndex((candidate) => candidate.callId === request.callId) !== index) {
      return false;
    }
    const pairedAssistantCalls = assistantToolCalls.filter((assistantCall) =>
      assistantCall.callId === request.callId
    );
    return pairedAssistantCalls.length === 1 && toolCallRequestsEqual(pairedAssistantCalls[0]!, request);
  });
  if (
    pendingResult.status !== "approval_required" ||
    pendingResult.callId !== pendingApproval.pendingToolCall.callId ||
    pendingResult.toolName !== pendingApproval.pendingToolCall.toolName ||
    !contractFactsEqual(pendingResult.input, pendingApproval.pendingToolCall.input) ||
    !assistantPairingIsValid ||
    !confirmationFactsMatch ||
    (resultConfirmationId !== undefined && resultConfirmationId !== pendingApproval.confirmationId) ||
    (mirroredConfirmationId !== undefined && mirroredConfirmationId !== pendingApproval.confirmationId)
  ) {
    throw new Error("Pending tool approval facts are inconsistent and cannot be resumed safely.");
  }
}

function toolCallRequestsEqual(left: {
  readonly callId: string;
  readonly toolName: string;
  readonly input: ToolCallResult["input"];
}, right: {
  readonly callId: string;
  readonly toolName: string;
  readonly input: ToolCallResult["input"];
}): boolean {
  return left.callId === right.callId &&
    left.toolName === right.toolName &&
    contractFactsEqual(left.input, right.input);
}

function contractFactsEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (
    left === undefined || right === undefined ||
    left === null || right === null ||
    typeof left !== "object" || typeof right !== "object" ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return false;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) =>
      contractFactsEqual(item, right[index])
    );
  }
  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(rightRecord, key) &&
    contractFactsEqual(leftRecord[key], rightRecord[key])
  );
}

async function continueToolUseLoopAfterToolResults(input: {
  readonly options: ToolUseLoopOptions;
  readonly initialRequest: ModelRequest;
  readonly messages: readonly ModelMessage[];
  readonly toolCalls: readonly ToolCallResult[];
  readonly modelResponses: readonly ToolUseLoopModelResponseTrace[];
  readonly modelRounds: number;
  readonly rounds: number;
  readonly requestId: string;
}): Promise<ToolUseLoopResult> {
  const maxToolRounds = normalizeOptionalRoundLimit(input.options.maxToolRounds);
  const maxModelRounds = normalizeOptionalRoundLimit(input.options.maxModelRounds);
  const toolDefinitions = modelVisibleToolDefinitions(input.options);
  let messages = cloneMessages(input.messages);
  const toolCalls: ToolCallResult[] = [...input.toolCalls];
  let modelResponses: ToolUseLoopModelResponseTrace[] = [...input.modelResponses];
  let modelRounds = input.modelRounds;
  let rounds = input.rounds;
  let requestId = input.requestId;

  for (;;) {
    if (input.options.abortSignal?.aborted === true) {
      return abortedLoopResult(input.initialRequest, toolCalls, modelRounds, rounds, modelResponses, cloneMessages(messages));
    }
    if (maxModelRounds !== undefined && modelRounds >= maxModelRounds) {
      return outOfFuelLoopResult(input.initialRequest, toolCalls, modelRounds, rounds, modelResponses, cloneMessages(messages));
    }
    const maintenance = await maintainContextIfNeeded({
      options: input.options,
      initialRequest: input.initialRequest,
      requestId,
      messages,
      tools: toolDefinitions,
      toolCalls,
      modelRounds,
      rounds,
    });
    if (maintenance.status === "failed") {
      return contextOverflowLoopResult(
        input.initialRequest,
        toolCalls,
        modelRounds,
        rounds,
        maintenance,
        modelResponses,
        cloneMessages(messages),
      );
    }
    if (maintenance.status === "compacted") {
      messages = cloneMessages(maintenance.messages);
    }

    const response = await input.options.intelligenceChannel.request({
      ...input.initialRequest,
      requestId,
      sanitizedMessages: messages,
      tools: toolDefinitions,
      toolChoice: input.initialRequest.toolChoice === "none"
        ? "none"
        : input.initialRequest.toolChoice ?? (toolDefinitions.length > 0 ? "auto" : "none"),
    }, { abortSignal: input.options.abortSignal });
    modelRounds += 1;
    modelResponses = [...modelResponses, modelResponseTrace(response)];

    if (response.status !== "completed") {
      return {
        finalOutput: response,
        toolCalls,
        modelResponses,
        contextMessages: cloneMessages(messages),
        modelRounds,
        rounds,
        stoppedReason: "error",
      };
    }

    const requestedToolCalls = response.toolCalls ?? [];
    if (requestedToolCalls.length === 0) {
      const incompleteResponse = incompleteModelResponseForCompletion(response);
      if (incompleteResponse !== undefined) {
        return {
          finalOutput: incompleteResponse,
          toolCalls,
          modelResponses,
          contextMessages: cloneMessages(messages),
          modelRounds,
          rounds,
          stoppedReason: "error",
        };
      }
      return {
        finalOutput: response,
        toolCalls,
        modelResponses,
        contextMessages: cloneMessages(messages),
        modelRounds,
        rounds,
        stoppedReason: toolCalls.length > 0 ? "completed" : "no_tool_calls",
      };
    }

    if (maxToolRounds !== undefined && rounds >= maxToolRounds) {
      return outOfFuelLoopResult(input.initialRequest, toolCalls, modelRounds, rounds, modelResponses, cloneMessages(messages));
    }

    const roundResult = await executeToolCalls({ options: input.options, requests: requestedToolCalls, toolDefinitions });
    toolCalls.push(...roundResult.results);
    if (roundResult.pendingApproval !== undefined) {
      const requestIdForResume = createId("model-request");
      const pendingApproval: ToolUseLoopPendingApproval = {
        confirmationId: roundResult.pendingApproval.confirmationId,
        pendingToolCall: cloneToolCallRequest(roundResult.pendingApproval.pendingToolCall),
        pendingToolResult: cloneToolResult(roundResult.pendingApproval.pendingToolResult),
        confirmationRequest:
          roundResult.pendingApproval.confirmationRequest === undefined
            ? undefined
            : globalThis.structuredClone(roundResult.pendingApproval.confirmationRequest),
        remainingToolCallsAfterApproval: roundResult.pendingApproval.remainingToolCallsAfterApproval.map(cloneToolCallRequest),
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
      };
      if (Boolean(input.options.abortSignal?.aborted)) {
        return abortPendingApprovalLoopResult(input.options, input.initialRequest, pendingApproval);
      }
      return {
        finalOutput: response,
        toolCalls,
        modelResponses,
        contextMessages: cloneMessages(messages),
        modelRounds,
        rounds,
        stoppedReason: "approval_required",
        pendingApproval,
      };
    }
    const roundResults = roundResult.results;
    rounds += 1;
    messages = [
      ...messages,
      assistantToolCallMessage(response, requestedToolCalls),
      ...toolResultMessages(roundResults),
    ];
    requestId = createId("model-request");

    if (maxModelRounds !== undefined && modelRounds >= maxModelRounds) {
      return outOfFuelLoopResult(input.initialRequest, toolCalls, modelRounds, rounds, modelResponses, cloneMessages(messages));
    }
  }
}

function modelResponseTrace(response: ModelResponse): ToolUseLoopModelResponseTrace {
  return {
    requestId: response.requestId,
    responseId: response.responseId,
    status: response.status,
    text: response.textOutput ?? response.assistantMessage?.content,
    reasoningSummary: response.reasoningOutput?.content,
    toolCallIds: (response.toolCalls ?? []).map((call) => call.callId),
    finishReason: response.finishReason,
    completedAt: response.completedAt,
  };
}

function incompleteModelResponseForCompletion(response: ModelResponse): ModelResponse | undefined {
  if (response.finishReason !== "length" && response.finishReason !== "content_filter" && response.finishReason !== "error") {
    return undefined;
  }
  const reason = response.finishReason;
  const message = reason === "length"
    ? "模型输出被截断，不能作为最终答案。"
    : reason === "content_filter"
      ? "模型输出被内容过滤，不能作为最终答案。"
      : "模型服务返回错误结束，不能作为最终答案。";
  return createFailedModelResponse({
    requestId: response.requestId,
    providerId: response.providerId,
    providerKind: response.providerKind,
    protocolKind: response.protocolKind,
    model: response.model,
    outputKind: response.outputKind,
    failureKind: "provider_response",
    retryable: reason === "length",
    message,
    responseId: response.responseId,
  });
}

function normalizeOptionalRoundLimit(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}

async function maintainContextIfNeeded(input: {
  readonly options: ToolUseLoopOptions;
  readonly initialRequest: ModelRequest;
  readonly requestId: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: ReturnType<typeof modelVisibleToolDefinitions>;
  readonly toolCalls: readonly ToolCallResult[];
  readonly modelRounds: number;
  readonly rounds: number;
}): Promise<ToolUseLoopContextMaintenanceResult> {
  if (input.options.maintainContext === undefined) {
    return { status: "unchanged" };
  }
  try {
    return await input.options.maintainContext({
      initialRequest: input.initialRequest,
      requestId: input.requestId,
      messages: input.messages,
      tools: input.tools,
      toolCalls: input.toolCalls,
      modelRounds: input.modelRounds,
      rounds: input.rounds,
    });
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "Context maintenance failed.",
      retryable: true,
    };
  }
}
