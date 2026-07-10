import type { ToolDisplayProjection } from "../../domain/tools/index.js";
import type { InternalToolResult } from "./tool-result-canonical.js";
import { MODEL_TOOL_TEXT_MAX_CHARS } from "./tool-result-field-projection.js";
import {
  asRecord,
  booleanOrUndefined,
  numberOrUndefined,
} from "./tool-result-facts.js";
import { toolResultContinuation } from "./tool-result-continuation.js";
import {
  ensureToolResultContent,
  structuredSnapshot,
  textContentBlocks,
  textFragmentForToolResult,
  type ToolModelResultAdapterInput,
} from "./tool-model-result-support.js";

export function projectBrowserSnapshotToolModelResult(
  input: ToolModelResultAdapterInput & { readonly display: Extract<ToolDisplayProjection, { readonly kind: "browser_snapshot" }> }
): InternalToolResult {
  const { request, output, display, truncated, fallbackText } = input;
  const result = asRecord(asRecord(output).result);
  const text = textFragmentForToolResult(result.text, MODEL_TOOL_TEXT_MAX_CHARS, request, "text");
  const effectiveTruncated = display.truncated === true || truncated || text?.truncated === true;
  const continuation = toolResultContinuation({ request, result, truncated: effectiveTruncated });
  return ensureToolResultContent({
    content: textContentBlocks(text?.text),
    structuredContent: structuredSnapshot({
      title: display.title,
      url: display.url,
      startChar: numberOrUndefined(result.startChar),
      textChars: numberOrUndefined(result.textChars),
      totalTextChars: numberOrUndefined(result.totalTextChars),
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      nextStartChar: numberOrUndefined(result.nextStartChar),
      reachedStartCharCeiling: booleanOrUndefined(result.reachedStartCharCeiling),
      startCharCeiling: numberOrUndefined(result.startCharCeiling),
      rawTextRef: text?.rawRef,
      truncated: effectiveTruncated,
    }),
    continuation,
  }, fallbackText);
}

export function projectHttpResponseToolModelResult(
  input: ToolModelResultAdapterInput & { readonly display: Extract<ToolDisplayProjection, { readonly kind: "http_response" }> }
): InternalToolResult {
  const { request, output, display, truncated, fallbackText } = input;
  const result = asRecord(asRecord(output).result);
  const body = textFragmentForToolResult(result.body, MODEL_TOOL_TEXT_MAX_CHARS, request, "body");
  const effectiveTruncated = display.truncated === true || truncated || body?.truncated === true;
  const continuation = toolResultContinuation({ request, result, truncated: effectiveTruncated });
  return ensureToolResultContent({
    content: textContentBlocks(body?.text),
    structuredContent: structuredSnapshot({
      method: display.method,
      url: display.url,
      statusCode: display.statusCode,
      statusText: display.statusText,
      durationMs: display.durationMs,
      startChar: numberOrUndefined(result.startChar),
      bodyChars: numberOrUndefined(result.bodyChars),
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      nextStartChar: numberOrUndefined(result.nextStartChar),
      reachedStartCharCeiling: booleanOrUndefined(result.reachedStartCharCeiling),
      startCharCeiling: numberOrUndefined(result.startCharCeiling),
      rawBodyRef: body?.rawRef,
      truncated: effectiveTruncated,
    }),
    isError: typeof display.statusCode === "number" && display.statusCode >= 400 ? true : undefined,
    continuation,
  }, fallbackText);
}
