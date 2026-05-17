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
import { toolDisplayName } from "../../domain/tools/index.js";
import { createId } from "../id.js";
import { projectToolStatusEnvelope } from "../tools/index.js";
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
  readonly blockedToolNames?: readonly string[];
  readonly approvedConfirmationIds?: readonly string[];
  readonly publishToolEvent?: (message: ArborMessage) => void;
  readonly maintainContext?: ToolUseLoopContextMaintainer;
  readonly abortSignal?: AbortSignal;
};

export type ToolUseLoopContextMaintainer = (input: {
  readonly initialRequest: ModelRequest;
  readonly requestId: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolDefinition[];
  readonly toolCalls: readonly ToolCallResult[];
  readonly modelRounds: number;
  readonly rounds: number;
}) => Promise<ToolUseLoopContextMaintenanceResult>;

export type ToolUseLoopContextMaintenanceResult =
  | {
      readonly status: "unchanged";
    }
  | {
      readonly status: "compacted";
      readonly messages: readonly ModelMessage[];
    }
  | {
      readonly status: "failed";
      readonly message: string;
      readonly requestId?: string;
      readonly responseId?: string;
      readonly retryable?: boolean;
    };

export type ToolUseLoopPendingApproval = {
  readonly confirmationId: string;
  readonly pendingToolCall: ToolCallRequest;
  readonly remainingToolCallsAfterApproval: readonly ToolCallRequest[];
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
    | "no_tool_calls"
    | "out_of_fuel"
    | "context_overflow"
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
  return resumeApprovalCore(options, initialRequest, pendingApproval);
}

async function resumeApprovalCore(
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
  const toolDefinitions = modelVisibleToolDefinitions(options);
  let toolCalls = [...pendingApproval.toolCallsBeforeApproval, approvedResult];
  if (approvedResult.status === "approval_required") {
    return {
      finalOutput: approvalStillRequiredModelResponse(initialRequest, pendingApproval),
      toolCalls,
      modelRounds: pendingApproval.modelRounds,
      rounds: pendingApproval.rounds,
      stoppedReason: "approval_required",
      pendingApproval: clonePendingApproval(pendingApproval),
    };
  }
  if (approvedResult.status === "cancelled" || Boolean(options.abortSignal?.aborted)) {
    return abortedLoopResult(initialRequest, toolCalls, pendingApproval.modelRounds, pendingApproval.rounds);
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
      return {
        finalOutput: approvalStillRequiredModelResponse(initialRequest, {
          ...pendingApproval,
          confirmationId: remaining.pendingApproval.confirmationId,
          pendingToolCall: remaining.pendingApproval.pendingToolCall,
          remainingToolCallsAfterApproval: remaining.pendingApproval.remainingToolCallsAfterApproval,
        }),
        toolCalls,
        modelRounds: pendingApproval.modelRounds,
        rounds: pendingApproval.rounds,
        stoppedReason: "approval_required",
        pendingApproval: {
          confirmationId: remaining.pendingApproval.confirmationId,
          pendingToolCall: cloneToolCallRequest(remaining.pendingApproval.pendingToolCall),
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
        },
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
      ...completedToolResults.map(toolResultMessage),
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
    readonly remainingToolCallsAfterApproval: readonly ToolCallRequest[];
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
  if (canExecuteReadOnlyBatchInParallel(input.requests, input.toolDefinitions)) {
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
          remainingToolCallsAfterApproval: input.requests.slice(index + 1).map(cloneToolCallRequest),
          completedToolResults: cloneToolResults(results.slice(0, -1)),
          requestsForAssistantMessage: input.requests.map(cloneToolCallRequest),
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
  if (isBlockedToolName(options, request.toolName)) {
    return {
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: undefined,
      status: "failed",
      error: `${toolDisplayName(request.toolName)}当前不可用。`,
      durationMs: 0,
    };
  }
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
  const maxToolRounds = normalizeOptionalRoundLimit(input.options.maxToolRounds);
  const maxModelRounds = normalizeOptionalRoundLimit(input.options.maxModelRounds);
  const toolDefinitions = modelVisibleToolDefinitions(input.options);
  let messages = cloneMessages(input.messages);
  const toolCalls: ToolCallResult[] = [...input.toolCalls];
  let modelRounds = input.modelRounds;
  let rounds = input.rounds;
  let requestId = input.requestId;

  for (;;) {
    if (input.options.abortSignal?.aborted === true) {
      return abortedLoopResult(input.initialRequest, toolCalls, modelRounds, rounds);
    }
    if (maxModelRounds !== undefined && modelRounds >= maxModelRounds) {
      return outOfFuelLoopResult(input.initialRequest, toolCalls, modelRounds, rounds);
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
      return contextOverflowLoopResult(input.initialRequest, toolCalls, modelRounds, rounds, maintenance);
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

    if (maxToolRounds !== undefined && rounds >= maxToolRounds) {
      return outOfFuelLoopResult(input.initialRequest, toolCalls, modelRounds, rounds);
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

    if (maxModelRounds !== undefined && modelRounds >= maxModelRounds) {
      return outOfFuelLoopResult(input.initialRequest, toolCalls, modelRounds, rounds);
    }
  }
}

function normalizeOptionalRoundLimit(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}

function modelVisibleToolDefinitions(options: ToolUseLoopOptions): readonly ToolDefinition[] {
  return options.toolCenter
    .list()
    .filter((tool) => options.allowedTools === undefined || options.allowedTools.includes(tool.name))
    .filter((tool) => !isBlockedToolName(options, tool.name));
}

async function maintainContextIfNeeded(input: {
  readonly options: ToolUseLoopOptions;
  readonly initialRequest: ModelRequest;
  readonly requestId: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolDefinition[];
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

function isReadOnlyToolCall(request: ToolCallRequest, definitions: readonly ToolDefinition[]): boolean {
  return definitions.find((definition) => definition.name === request.toolName)?.metadata?.operationType === "read-only";
}

function canExecuteReadOnlyBatchInParallel(
  requests: readonly ToolCallRequest[],
  definitions: readonly ToolDefinition[]
): boolean {
  return requests.every((request) => {
    const definition = definitions.find((candidate) => candidate.name === request.toolName);
    return definition?.metadata?.operationType === "read-only" && !mayRequireConfirmationBeforeExecution(request, definition);
  });
}

function mayRequireConfirmationBeforeExecution(request: ToolCallRequest, definition: ToolDefinition): boolean {
  if (definition.metadata?.requiresConfirmation === true) {
    return true;
  }
  return stringFromRecord(request.input, "url") !== undefined;
}

function stringFromRecord(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const raw = (value as Readonly<Record<string, unknown>>)[key];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
}

function isBlockedToolName(options: ToolUseLoopOptions, toolName: string): boolean {
  return options.blockedToolNames?.includes(toolName) === true;
}

function outOfFuelLoopResult(
  initialRequest: ModelRequest,
  toolCalls: readonly ToolCallResult[],
  modelRounds: number,
  rounds: number
): ToolUseLoopResult {
  return {
    finalOutput: outOfFuelModelResponse(initialRequest),
    toolCalls,
    modelRounds,
    rounds,
    stoppedReason: "out_of_fuel",
  };
}

function contextOverflowLoopResult(
  initialRequest: ModelRequest,
  toolCalls: readonly ToolCallResult[],
  modelRounds: number,
  rounds: number,
  failure: Extract<ToolUseLoopContextMaintenanceResult, { readonly status: "failed" }>
): ToolUseLoopResult {
  return {
    finalOutput: contextOverflowModelResponse(initialRequest, failure),
    toolCalls,
    modelRounds,
    rounds,
    stoppedReason: "context_overflow",
  };
}

function cancelledToolResult(request: ToolCallRequest): ToolCallResult {
  const diagnosticRef = `tool:${request.callId}:cancelled`;
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
      diagnosticRef,
      envelope: projectToolStatusEnvelope({
        request,
        status: "cancelled",
        summary: "Tool execution cancelled.",
        diagnosticRef,
      }),
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

function outOfFuelModelResponse(initialRequest: ModelRequest): ModelResponse {
  return {
    responseId: `${initialRequest.requestId}-out-of-fuel`,
    requestId: initialRequest.requestId,
    providerId: "agent-turn-runtime",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "out-of-fuel",
    status: "failed",
    outputKind: initialRequest.outputContract.outputKind,
    finishReason: "error",
    validation: {
      status: "failed",
      checkedAt: new Date().toISOString(),
      issues: [{ code: "out_of_fuel", message: "Agent run paused before the model returned a final no-tool response." }],
    },
    failure: {
      kind: "provider_response",
      message: "Agent run paused before the model returned a final no-tool response.",
      retryable: true,
    },
    completedAt: new Date().toISOString(),
  };
}

function contextOverflowModelResponse(
  initialRequest: ModelRequest,
  failure: Extract<ToolUseLoopContextMaintenanceResult, { readonly status: "failed" }>
): ModelResponse {
  return {
    responseId: failure.responseId ?? `${initialRequest.requestId}-context-overflow`,
    requestId: failure.requestId ?? initialRequest.requestId,
    providerId: "agent-turn-runtime",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "context-maintenance",
    status: "failed",
    outputKind: initialRequest.outputContract.outputKind,
    finishReason: "error",
    validation: {
      status: "failed",
      checkedAt: new Date().toISOString(),
      issues: [{ code: "context_overflow", message: failure.message }],
    },
    failure: {
      kind: "provider_response",
      message: failure.message,
      retryable: failure.retryable ?? true,
    },
    completedAt: new Date().toISOString(),
  };
}

function approvalRequiredResultFromPending(pendingApproval: ToolUseLoopPendingApproval): ToolCallResult {
  const request = pendingApproval.pendingToolCall;
  const diagnosticRef = `tool:${request.callId}:confirmation-required`;
  return {
    callId: request.callId,
    toolName: request.toolName,
    input: globalThis.structuredClone(request.input),
    output: undefined,
    status: "approval_required",
    error: `${toolDisplayName(request.toolName)}仍需要用户确认。`,
    durationMs: 0,
    projection: {
      uiSummary: `${toolDisplayName(request.toolName)}仍在等待用户确认。`,
      diagnosticRef,
      envelope: projectToolStatusEnvelope({
        request,
        status: "approval_required",
        summary: `${toolDisplayName(request.toolName)}仍在等待用户确认。`,
        diagnosticRef,
      }),
      truncated: false,
      redacted: true,
    },
    confirmationRequest: {
      confirmationId: pendingApproval.confirmationId,
      runId: request.callId,
      title: "需要确认",
      actionSummary: `${toolDisplayName(request.toolName)}需要用户确认后才能执行。`,
      affectedResources: [],
      riskLevel: "medium",
      requestedAt: new Date().toISOString(),
      sourceRefs: [`tool:${request.callId}`],
    },
  };
}

function clonePendingApproval(pendingApproval: ToolUseLoopPendingApproval): ToolUseLoopPendingApproval {
  return {
    confirmationId: pendingApproval.confirmationId,
    pendingToolCall: cloneToolCallRequest(pendingApproval.pendingToolCall),
    remainingToolCallsAfterApproval: pendingApproval.remainingToolCallsAfterApproval.map(cloneToolCallRequest),
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
  const envelope = result.projection?.envelope;
  const modelOutput = envelope !== undefined
    ? {
        summary: envelope.agentSummary,
        evidenceRefs: envelope.evidenceRefs,
        truncated: envelope.truncated,
        redacted: envelope.redacted,
        diagnosticRef: envelope.diagnosticRef,
      }
    : result.projection?.agentContent !== undefined
      ? result.projection.agentContent
      : toSafeToolEventValue(result.output);
  return {
    role: "tool",
    content: truncateToolMessageContent(JSON.stringify({
      callId: result.callId,
      toolName: result.toolName,
      status: result.status,
      output: modelOutput,
      error: result.error,
      durationMs: result.durationMs,
    })),
    toolCallId: result.callId,
    toolName: result.toolName,
  };
}

const MAX_TOOL_MESSAGE_CHARS = 40_000;

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
