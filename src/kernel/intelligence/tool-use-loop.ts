import type { ModelMessage, ModelRequest } from "../../domain/intelligence/index.js";
import type { ToolCallResult } from "../../domain/tools/index.js";
import { createId } from "../id.js";
import {
  cloneMessages,
  cloneModelMessage,
  clonePendingApproval,
  cloneToolCallRequest,
  cloneToolResults,
} from "./tool-use-loop-cloning.js";
import type {
  ToolUseLoopConfirmationDecision,
  ToolUseLoopContextMaintenanceResult,
  ToolUseLoopOptions,
  ToolUseLoopPendingApproval,
  ToolUseLoopResult,
} from "./tool-use-loop-contracts.js";
import {
  createToolExecutionContext,
  executeSingleToolCall,
  executeToolCalls,
  modelVisibleToolDefinitions,
  publishToolResultEvent,
} from "./tool-use-loop-execution.js";
import {
  assistantToolCallMessage,
  toolResultMessage,
} from "./tool-use-loop-messages.js";
import {
  abortedLoopResult,
  approvalRequiredResultFromPending,
  approvalStillRequiredModelResponse,
  contextOverflowLoopResult,
  confirmationDecisionSkippedToolResult,
  confirmationDecisionToolResult,
  outOfFuelLoopResult,
} from "./tool-use-loop-results.js";

export type {
  ToolUseLoopConfirmationDecision,
  ToolUseLoopContextMaintainer,
  ToolUseLoopContextMaintenanceResult,
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

export async function resumeToolUseLoopFromConfirmationDecision(
  options: ToolUseLoopOptions,
  initialRequest: ModelRequest,
  pendingApproval: ToolUseLoopPendingApproval,
  decision: ToolUseLoopConfirmationDecision
): Promise<ToolUseLoopResult> {
  if (decision.confirmationId !== pendingApproval.confirmationId) {
    return resumeApprovalCore(options, initialRequest, pendingApproval);
  }
  if (options.abortSignal?.aborted === true) {
    return abortedLoopResult(
      initialRequest,
      pendingApproval.toolCallsBeforeApproval,
      pendingApproval.modelRounds,
      pendingApproval.rounds
    );
  }

  const decisionResult = confirmationDecisionToolResult(pendingApproval.pendingToolCall, decision);
  const skippedResults = pendingApproval.remainingToolCallsAfterApproval.map((request) =>
    confirmationDecisionSkippedToolResult(request, decision)
  );
  const decisionRoundResults = [decisionResult, ...skippedResults];
  const context = createToolExecutionContext(options);
  decisionRoundResults.forEach((result) => publishToolResultEvent(options, result, context));
  const toolCalls = [...pendingApproval.toolCallsBeforeApproval, ...decisionRoundResults];
  return continueToolUseLoopAfterToolResults({
    options,
    initialRequest,
    messages: [
      ...cloneMessages(pendingApproval.messagesBeforeToolCall),
      cloneModelMessage(pendingApproval.assistantMessage),
      ...cloneToolResults([
        ...pendingApproval.completedToolResults,
        ...decisionRoundResults,
      ]).map(toolResultMessage),
    ],
    toolCalls,
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

  const context = createToolExecutionContext(options);
  const approvedResult = await executeSingleToolCall({
    options,
    request: pendingApproval.pendingToolCall,
    context,
  });
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
          confirmationRequest: remaining.pendingApproval.confirmationRequest,
          remainingToolCallsAfterApproval: remaining.pendingApproval.remainingToolCallsAfterApproval,
        }),
        toolCalls,
        modelRounds: pendingApproval.modelRounds,
        rounds: pendingApproval.rounds,
        stoppedReason: "approval_required",
        pendingApproval: {
          confirmationId: remaining.pendingApproval.confirmationId,
          pendingToolCall: cloneToolCallRequest(remaining.pendingApproval.pendingToolCall),
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
