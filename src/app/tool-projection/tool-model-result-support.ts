import type { ToolCallRequest, ToolContentBlock } from "../../domain/tools/index.js";
import type { InternalToolResult } from "./tool-result-canonical.js";
import {
  modelVisibleTextFragment,
  type ModelVisibleTextFragment,
} from "./tool-result-field-projection.js";

export function ensureToolResultContent(
  result: InternalToolResult,
  fallbackText: string
): InternalToolResult {
  if (result.content.length > 0) {
    return result;
  }
  return {
    ...result,
    content: [{ type: "text", text: fallbackText }],
  };
}

export function textContentBlocks(value: string | undefined): readonly ToolContentBlock[] {
  return value === undefined || value.length === 0 ? [] : [{ type: "text", text: value }];
}

export function textFragmentForToolResult(
  value: unknown,
  maxLength: number,
  request: ToolCallRequest,
  field: string
): ModelVisibleTextFragment | undefined {
  return typeof value === "string"
    ? modelVisibleTextFragment({ value, maxLength, request, field })
    : undefined;
}

export function structuredSnapshot(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      result[key] = item;
    }
  }
  return result;
}

export function structuredRecordWithoutVerbose(record: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (isVerboseToolResultStructuredKey(key)) {
      continue;
    }
    result[key] = item;
  }
  return result;
}

function isVerboseToolResultStructuredKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === "content" ||
    normalized === "contentpreview" ||
    normalized === "stdout" ||
    normalized === "stderr" ||
    normalized === "body" ||
    normalized === "text" ||
    normalized === "raw";
}
