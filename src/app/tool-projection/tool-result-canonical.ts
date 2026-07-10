import type {
  ToolContentBlock,
  ToolErrorDomain,
  ToolErrorFacts,
  ToolResult,
} from "../../domain/tools/index.js";
import {
  asRecord,
  booleanOrUndefined,
  numberOrUndefined,
  optionalRecord,
  stringOrUndefined,
  textOrUndefined,
} from "./tool-result-facts.js";
import { toolContinuationFromUnknown } from "./tool-result-continuation.js";

export type InternalToolResult = ToolResult;

/** Restores a canonical tool result without dropping multimodal or continuation facts. */
export function toolResultFromUnknown(value: unknown): InternalToolResult | undefined {
  const record = asRecord(value);
  if (!Array.isArray(record.content)) {
    return undefined;
  }
  const content = record.content
    .map(toolContentBlockFromUnknown)
    .filter((part): part is ToolContentBlock => part !== undefined);
  return {
    content,
    structuredContent: record.structuredContent,
    isError: booleanOrUndefined(record.isError),
    error: toolResultErrorFromUnknown(record.error),
    truncation: toolResultTruncationFromUnknown(record.truncation),
    continuation: toolContinuationFromUnknown(record.continuation),
  };
}

/** Converts the pre-canonical MCP result shape used by older adapters. */
export function projectLegacyMcpToolResult(record: Readonly<Record<string, unknown>>): InternalToolResult {
  const result = asRecord(record.result);
  const content: ToolContentBlock[] = [];
  const text = textOrUndefined(result.text);
  if (text !== undefined) {
    content.push({ type: "text", text });
  }
  for (const item of Array.isArray(result.multimodal) ? result.multimodal : []) {
    const part = asRecord(item);
    const type = stringOrUndefined(part.type);
    const mimeType = stringOrUndefined(part.mimeType);
    if ((type === "image" || type === "audio") && mimeType !== undefined) {
      content.push({ type, mimeType, ref: stringOrUndefined(part.ref) });
    }
  }
  return {
    content,
    structuredContent: result.structuredContent ?? record.structuredContent,
    isError: booleanOrUndefined(record.isError),
  };
}

function toolContentBlockFromUnknown(value: unknown): ToolContentBlock | undefined {
  const record = asRecord(value);
  const type = stringOrUndefined(record.type);
  if (type === "text") {
    const text = textOrUndefined(record.text);
    return text === undefined ? undefined : { type: "text", text };
  }
  if (type === "image") {
    const mimeType = stringOrUndefined(record.mimeType);
    return mimeType === undefined ? undefined : {
      type: "image",
      mimeType,
      data: textOrUndefined(record.data),
      ref: stringOrUndefined(record.ref),
    };
  }
  if (type === "audio") {
    const mimeType = stringOrUndefined(record.mimeType);
    return mimeType === undefined ? undefined : {
      type: "audio",
      mimeType,
      data: textOrUndefined(record.data),
      ref: stringOrUndefined(record.ref),
    };
  }
  if (type === "resource") {
    const uri = stringOrUndefined(record.uri);
    return uri === undefined ? undefined : {
      type: "resource",
      uri,
      mimeType: stringOrUndefined(record.mimeType),
      text: textOrUndefined(record.text),
    };
  }
  return undefined;
}

function toolResultTruncationFromUnknown(value: unknown): ToolResult["truncation"] | undefined {
  const record = asRecord(value);
  if (record.truncated !== true) {
    return undefined;
  }
  return {
    truncated: true,
    reason: stringOrUndefined(record.reason),
    omittedChars: numberOrUndefined(record.omittedChars),
    omittedItems: numberOrUndefined(record.omittedItems),
    continuation: toolContinuationFromUnknown(record.continuation),
  };
}

function toolResultErrorFromUnknown(value: unknown): ToolResult["error"] | undefined {
  const record = asRecord(value);
  const message = stringOrUndefined(record.message);
  if (message === undefined) {
    return undefined;
  }
  return {
    message,
    domain: toolErrorDomainFromUnknown(record.domain),
    facts: optionalRecord(record.facts) as ToolErrorFacts | undefined,
    retryable: booleanOrUndefined(record.retryable),
  };
}

function toolErrorDomainFromUnknown(value: unknown): ToolErrorDomain | undefined {
  return value === "tool_error" ||
      value === "runtime_error" ||
      value === "model_error" ||
      value === "ui_submit_error" ||
      value === "process_error"
    ? value
    : undefined;
}
