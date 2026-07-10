import type { ToolDisplayProjection } from "../../domain/tools/index.js";
import { projectSearchDisplayItem } from "./tool-display-projection.js";
import type { InternalToolResult } from "./tool-result-canonical.js";
import {
  FILE_SEARCH_MODEL_MATCHES_LIMIT,
  projectDirectoryEntry,
  projectGrepMatch,
  projectGrepSkippedSample,
  projectTableRow,
  projectUnreadableDirectorySample,
} from "./tool-result-field-projection.js";
import {
  asRecord,
  booleanOrUndefined,
  isString,
  numberOrUndefined,
  searchMessageFromOutput,
  stringArray,
  stringOrUndefined,
} from "./tool-result-facts.js";
import { toolResultContinuation } from "./tool-result-continuation.js";
import {
  ensureToolResultContent,
  structuredSnapshot,
  textContentBlocks,
  type ToolModelResultAdapterInput,
} from "./tool-model-result-support.js";

interface CollectionAdapterInput extends ToolModelResultAdapterInput {
  readonly display: ToolDisplayProjection;
}

export function projectSearchToolModelResult(input: CollectionAdapterInput): InternalToolResult {
  const { output, display, fallbackText } = input;
  const record = asRecord(output);
  const results = display.kind === "search_results"
    ? display.results
    : Array.isArray(record.results)
      ? record.results.map(projectSearchDisplayItem).filter((item): item is NonNullable<ReturnType<typeof projectSearchDisplayItem>> => item !== undefined)
      : [];
  const content = results
    .flatMap((item) => textContentBlocks([item.title, item.snippet].filter(isString).join("\n")));
  return ensureToolResultContent({
    content,
    structuredContent: structuredSnapshot({
      query: display.kind === "search_results" ? display.query : stringOrUndefined(record.query),
      status: display.kind === "search_results" ? display.status : stringOrUndefined(record.status),
      message: display.kind === "search_results" ? display.message : searchMessageFromOutput(record),
      resultsReturned: display.kind === "search_results" ? display.resultsReturned ?? results.length : results.length,
      results,
      truncated: display.kind === "search_results" ? display.truncated : booleanOrUndefined(record.truncated),
    }),
    isError: (display.kind === "search_results" ? display.status : stringOrUndefined(record.status)) === "invalid-input" ? true : undefined,
  }, fallbackText);
}

export function projectFileSearchToolModelResult(input: ToolModelResultAdapterInput): InternalToolResult {
  const { request, output, truncated, fallbackText } = input;
  const record = asRecord(output);
  const result = asRecord(record.result);
  const matches = Array.isArray(result.matches) ? result.matches.slice(0, FILE_SEARCH_MODEL_MATCHES_LIMIT).map(projectGrepMatch) : [];
  const content = matches.flatMap((match) => textContentBlocks(
    [match.path, match.line === undefined ? undefined : String(match.line), match.preview].filter(isString).join(":")
  ));
  return ensureToolResultContent({
    content,
    structuredContent: structuredSnapshot({
      query: stringOrUndefined(result.query),
      path: stringOrUndefined(result.path),
      engine: stringOrUndefined(result.engine),
      offset: numberOrUndefined(result.offset),
      limit: numberOrUndefined(result.limit),
      matches,
      matchesReturned: numberOrUndefined(result.matchesReturned) ?? (Array.isArray(result.matches) ? result.matches.length : matches.length),
      searchedFiles: numberOrUndefined(result.searchedFiles),
      skippedFactsAvailable: booleanOrUndefined(result.skippedFactsAvailable),
      skippedFactsComplete: booleanOrUndefined(result.skippedFactsComplete),
      skippedFiles: numberOrUndefined(result.skippedFiles),
      skippedSamples: Array.isArray(result.skippedSamples)
        ? result.skippedSamples.slice(0, 8).map(projectGrepSkippedSample)
        : undefined,
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      nextOffset: numberOrUndefined(result.nextOffset),
      reachedOffsetCeiling: booleanOrUndefined(result.reachedOffsetCeiling),
      offsetCeiling: numberOrUndefined(result.offsetCeiling),
      maxOffset: numberOrUndefined(result.maxOffset),
      truncated,
    }),
    continuation: toolResultContinuation({ request, result, truncated }),
  }, fallbackText);
}

export function projectContextAttachmentListToolModelResult(input: ToolModelResultAdapterInput): InternalToolResult {
  const { request, output, truncated, fallbackText } = input;
  const result = asRecord(asRecord(output).result);
  const entries = Array.isArray(result.entries) ? result.entries.slice(0, 200).map(projectDirectoryEntry) : [];
  return ensureToolResultContent({
    content: textContentBlocks(entries.slice(0, 30).map((entry) =>
      [entry.kind, entry.path].filter(isString).join(" ")
    ).join("\n")),
    structuredContent: structuredSnapshot({
      attachmentId: stringOrUndefined(result.attachmentId),
      kind: stringOrUndefined(result.kind),
      title: stringOrUndefined(result.title),
      path: stringOrUndefined(result.path),
      depth: numberOrUndefined(result.depth),
      offset: numberOrUndefined(result.offset),
      limit: numberOrUndefined(result.limit),
      maxDepth: numberOrUndefined(result.maxDepth),
      entries,
      entriesReturned: numberOrUndefined(result.entriesReturned),
      totalEntries: numberOrUndefined(result.totalEntries),
      unreadableDirectories: numberOrUndefined(result.unreadableDirectories),
      unreadableSamples: Array.isArray(result.unreadableSamples)
        ? result.unreadableSamples.slice(0, 8).map(projectUnreadableDirectorySample)
        : undefined,
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      nextOffset: numberOrUndefined(result.nextOffset),
      reachedOffsetCeiling: booleanOrUndefined(result.reachedOffsetCeiling),
      offsetCeiling: numberOrUndefined(result.offsetCeiling),
      truncated,
    }),
    continuation: toolResultContinuation({ request, result, truncated }),
  }, fallbackText);
}

export function projectContextAttachmentTableToolModelResult(input: ToolModelResultAdapterInput): InternalToolResult {
  const { request, output, truncated, fallbackText } = input;
  const result = asRecord(asRecord(output).result);
  const rows = Array.isArray(result.rows) ? result.rows.slice(0, 200).map(projectTableRow) : [];
  const content = rows.slice(0, 30).map((row) =>
    `row ${row.rowNumber ?? "?"}: ${(row.values ?? []).join(" | ")}`
  ).join("\n");
  return ensureToolResultContent({
    content: textContentBlocks(content),
    structuredContent: structuredSnapshot({
      attachmentId: stringOrUndefined(result.attachmentId),
      kind: stringOrUndefined(result.kind),
      title: stringOrUndefined(result.title),
      path: stringOrUndefined(result.path),
      mimeType: stringOrUndefined(result.mimeType),
      bytes: numberOrUndefined(result.bytes),
      table: booleanOrUndefined(result.table),
      readable: booleanOrUndefined(result.readable),
      reason: stringOrUndefined(result.reason),
      format: stringOrUndefined(result.format),
      delimiter: stringOrUndefined(result.delimiter),
      sheetName: stringOrUndefined(result.sheetName),
      sheetIndex: numberOrUndefined(result.sheetIndex),
      sheets: stringArray(result.sheets),
      headerRow: booleanOrUndefined(result.headerRow),
      totalRows: numberOrUndefined(result.totalRows),
      dataRows: numberOrUndefined(result.dataRows),
      columnCount: numberOrUndefined(result.columnCount),
      columns: stringArray(result.columns),
      startRow: numberOrUndefined(result.startRow),
      rowCount: numberOrUndefined(result.rowCount),
      requestedRowCount: numberOrUndefined(result.requestedRowCount),
      nextStartRow: numberOrUndefined(result.nextStartRow),
      rows,
      rowsReturned: numberOrUndefined(result.rowsReturned),
      hasMoreBefore: booleanOrUndefined(result.hasMoreBefore),
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      reachedRowCeiling: booleanOrUndefined(result.reachedRowCeiling),
      rowCeiling: numberOrUndefined(result.rowCeiling),
      truncated,
    }),
    continuation: toolResultContinuation({ request, result, truncated }),
    isError: booleanOrUndefined(result.readable) === false ? true : undefined,
  }, fallbackText);
}

export function projectDirectoryToolModelResult(
  input: ToolModelResultAdapterInput & { readonly display: Extract<ToolDisplayProjection, { readonly kind: "directory_listing" }> }
): InternalToolResult {
  const { request, output, display, truncated, fallbackText } = input;
  const result = asRecord(asRecord(output).result);
  const entries = display.entries.map((entry) => [entry.kind, entry.path].filter(isString).join(" "));
  const effectiveTruncated = display.truncated === true || truncated;
  return ensureToolResultContent({
    content: textContentBlocks(entries.slice(0, 30).join("\n")),
    structuredContent: structuredSnapshot({
      path: display.path,
      depth: display.depth,
      entriesReturned: display.entriesReturned,
      totalEntries: display.totalEntries,
      unreadableDirectories: display.unreadableDirectories,
      unreadableSamples: display.unreadableSamples,
      entries: display.entries,
      offset: numberOrUndefined(result.offset),
      limit: numberOrUndefined(result.limit),
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      nextOffset: numberOrUndefined(result.nextOffset),
      truncated: effectiveTruncated,
    }),
    continuation: toolResultContinuation({
      request,
      result,
      display,
      truncated: effectiveTruncated,
    }),
  }, fallbackText);
}
