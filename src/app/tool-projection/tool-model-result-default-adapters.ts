import type { ToolContentBlock, ToolDisplayProjection } from "../../domain/tools/index.js";
import type { InternalToolResult } from "./tool-result-canonical.js";
import { asRecord, stringOrUndefined } from "./tool-result-facts.js";
import {
  ensureToolResultContent,
  structuredRecordWithoutVerbose,
  structuredSnapshot,
  textContentBlocks,
  type ToolModelResultAdapterInput,
} from "./tool-model-result-support.js";

export function projectFileChangeToolModelResult(
  input: ToolModelResultAdapterInput & {
    readonly display: Extract<ToolDisplayProjection, { readonly kind: "file_change_summary" | "file_diff_preview" }>;
  }
): InternalToolResult {
  const { display, truncated, fallbackText } = input;
  const files = diffFilesFromPreview(display.preview, display.path);
  return ensureToolResultContent({
    content: files.flatMap((file) => textContentBlocks(file.diff)),
    structuredContent: structuredSnapshot({
      files,
      path: display.path,
      operation: display.operation,
      bytes: "bytes" in display ? display.bytes : undefined,
      replacements: display.replacements,
      previousLength: display.previousLength,
      nextLength: display.nextLength,
      truncated: display.truncated === true || truncated,
    }),
  }, fallbackText);
}

export function projectGenericToolModelResult(input: ToolModelResultAdapterInput & { readonly display: ToolDisplayProjection }): InternalToolResult {
  const { request, output, display, truncated, fallbackText } = input;
  const record = asRecord(output);
  return ensureToolResultContent({
    content: genericToolResultContent(record, display),
    structuredContent: structuredSnapshot({
      toolName: request.toolName,
      action: stringOrUndefined(record.action),
      display,
      result: structuredRecordWithoutVerbose(asRecord(record.result)),
      truncated,
    }),
    isError: record.isError === true ? true : undefined,
  }, fallbackText);
}

function genericToolResultContent(
  record: Readonly<Record<string, unknown>>,
  display: ToolDisplayProjection
): readonly ToolContentBlock[] {
  const result = asRecord(record.result);
  if (display.kind === "generic_tool_summary") {
    return [
      ...textContentBlocks(display.summary),
      ...(display.items ?? []).flatMap((item) => textContentBlocks(item)),
    ];
  }
  return textContentBlocks(stringOrUndefined(result.text) ?? stringOrUndefined(record.summary));
}

function diffFilesFromPreview(
  preview: string | undefined,
  fallbackPath: string | undefined
): readonly { readonly path?: string; readonly diff: string }[] {
  if (preview === undefined || preview.trim().length === 0) {
    return fallbackPath === undefined ? [] : [{ path: fallbackPath, diff: "" }];
  }
  const lines = preview.replace(/\r\n?/g, "\n").split("\n");
  const blocks: { path?: string; lines: string[] }[] = [];
  let current: { path?: string; lines: string[] } = { path: fallbackPath, lines: [] };
  for (const line of lines) {
    const diffPath = line.match(/^diff --git a\/(.+?) b\/(.+)$/u)?.[2];
    if (diffPath !== undefined && current.lines.length > 0) {
      blocks.push(current);
      current = { path: diffPath, lines: [line] };
      continue;
    }
    if (diffPath !== undefined) {
      current.path = diffPath;
    }
    current.lines.push(line);
  }
  if (current.lines.length > 0) {
    blocks.push(current);
  }
  return blocks.map((block) => ({
    path: block.path,
    diff: block.lines.join("\n").trim(),
  })).filter((block) => block.diff.length > 0 || block.path !== undefined);
}
