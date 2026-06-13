import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionContext,
} from "../../domain/tools/index.js";
import { toolDisplayName } from "../../domain/tools/index.js";
import {
  createToolCompletedMessage,
  createToolApprovalRequiredMessage,
  createToolFailedMessage,
  createToolRequestedMessage,
} from "./tool-events.js";
import type { ToolUseLoopOptions } from "./tool-use-loop-contracts.js";
import { cloneToolCallRequest, cloneToolResults } from "./tool-use-loop-cloning.js";
import { cancelledToolResult } from "./tool-use-loop-results.js";
import { projectToolStatusEnvelope } from "../tools/index.js";

export type ToolUseLoopBatchExecutionResult = {
  readonly results: readonly ToolCallResult[];
  readonly pendingApproval?: {
    readonly confirmationId: string;
    readonly pendingToolCall: ToolCallRequest;
    readonly confirmationRequest?: NonNullable<ToolCallResult["confirmationRequest"]>;
    readonly remainingToolCallsAfterApproval: readonly ToolCallRequest[];
    readonly completedToolResults: readonly ToolCallResult[];
    readonly requestsForAssistantMessage: readonly ToolCallRequest[];
  };
};

export function createToolExecutionContext(options: ToolUseLoopOptions): ToolExecutionContext {
  return {
    callerAgentId: options.callerAgentId,
    traceId: options.traceId,
    goalId: options.goalId,
    abortSignal: options.abortSignal,
  };
}

export async function executeSingleToolCall(input: {
  readonly options: ToolUseLoopOptions;
  readonly request: ToolCallRequest;
  readonly context: ToolExecutionContext;
}): Promise<ToolCallResult> {
  input.options.publishToolEvent?.(createToolRequestedMessage({
    request: input.request,
    context: input.context,
  }));
  const result = await executeToolCallSafely(input.options, input.request, input.context);
  publishToolResultEvent(input.options, result, input.context);
  return result;
}

export async function executeToolCalls(input: {
  readonly options: ToolUseLoopOptions;
  readonly requests: readonly ToolCallRequest[];
  readonly toolDefinitions: readonly ToolDefinition[];
}): Promise<ToolUseLoopBatchExecutionResult> {
  const context = createToolExecutionContext(input.options);
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
          confirmationRequest:
            result.confirmationRequest === undefined ? undefined : globalThis.structuredClone(result.confirmationRequest),
          remainingToolCallsAfterApproval: input.requests.slice(index + 1).map(cloneToolCallRequest),
          completedToolResults: cloneToolResults(results.slice(0, -1)),
          requestsForAssistantMessage: input.requests.map(cloneToolCallRequest),
        },
      };
    }
  }
  return { results };
}

export function publishToolResultEvent(
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

export async function executeToolCallSafely(
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
  if (!options.allowedTools.includes(request.toolName)) {
    return unauthorizedToolResult(request);
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

export function modelVisibleToolDefinitions(options: ToolUseLoopOptions): readonly ToolDefinition[] {
  return options.toolCenter
    .list()
    .filter((tool) => options.allowedTools.includes(tool.name))
    .filter((tool) => !isBlockedToolName(options, tool.name));
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

function unauthorizedToolResult(request: ToolCallRequest): ToolCallResult {
  const summary = `${toolDisplayName(request.toolName)}未授权给当前 Agent。`;
  const diagnosticRef = `tool:${request.callId}:not-allowed`;
  return {
    callId: request.callId,
    toolName: request.toolName,
    input: request.input,
    output: undefined,
    status: "failed",
    error: summary,
    durationMs: 0,
    projection: {
      uiSummary: summary,
      diagnosticRef,
      envelope: projectToolStatusEnvelope({
        request,
        status: "failed",
        summary,
        diagnosticRef,
      }),
      truncated: false,
      redacted: false,
    },
  };
}
