import type { ToolCallResult } from "../../../domain/tools/index.js";
import { toolModelAttachmentsFromOutput } from "../../../domain/tools/index.js";

export function toolExecutionOutput(result: ToolCallResult): Readonly<Record<string, unknown>> {
  return record(result.output);
}

export function toolExecutionModelAttachments(result: ToolCallResult) {
  return toolModelAttachmentsFromOutput(result.output);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}
