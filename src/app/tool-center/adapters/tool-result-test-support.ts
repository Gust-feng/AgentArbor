import type { ToolCallResult, ToolContinuation } from "../../../domain/tools/index.js";
import { toolModelAttachmentsFromOutput } from "../../../domain/tools/index.js";
import { projectToolDisplay } from "../../tool-projection/tool-display-projection.js";
import { toolContinuationFromExecutionFact } from "../../../kernel/intelligence/tool-call-result-model-view.js";

export function toolExecutionOutput(result: ToolCallResult): Readonly<Record<string, unknown>> {
  return record(result.output);
}

export function toolExecutionResult(result: ToolCallResult): Readonly<Record<string, unknown>> {
  const output = toolExecutionOutput(result);
  return { ...output, ...record(output.result), status: output.status ?? result.status, error: result.error, errorFacts: result.errorFacts, continuation: toolContinuationFromExecutionFact(result) };
}

export function toolExecutionContinuation(result: ToolCallResult): ToolContinuation | undefined {
  const value = toolContinuationFromExecutionFact(result);
  return isContinuation(value) ? value : undefined;
}

export function toolExecutionDisplay(result: ToolCallResult) {
  return projectToolDisplay({ callId: result.callId, toolName: result.toolName, input: result.input }, result.output);
}

export function toolExecutionModelAttachments(result: ToolCallResult) {
  return toolModelAttachmentsFromOutput(result.output);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function isContinuation(value: unknown): value is ToolContinuation {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
