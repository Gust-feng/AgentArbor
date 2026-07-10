import type {
  ToolCallRequest,
  ToolContentBlock,
  ToolDisplayProjection,
  ToolErrorDomain,
  ToolErrorFacts,
  ToolResult,
  ToolSafeProjection,
} from "../../domain/tools/index.js";
import { toolDisplayName, toolModelAttachmentsFromOutput } from "../../domain/tools/index.js";
import {
  projectToolResultEnvelope as projectKernelToolResultEnvelope,
  projectToolStatusEnvelope,
} from "../../kernel/tools/index.js";
import { projectSearchDisplayItem, projectToolDisplay } from "./tool-display-projection.js";
import { projectToolAgentContent } from "./tool-agent-content-projection.js";
import {
  projectCommandToolModelResult,
  projectFileReadToolModelResult,
  projectResearchReadToolModelResult,
} from "./tool-model-result-read-adapters.js";
import {
  projectLegacyMcpToolResult,
  toolResultFromUnknown,
  type InternalToolResult,
} from "./tool-result-canonical.js";
import {
  FILE_SEARCH_MODEL_MATCHES_LIMIT,
  MODEL_TOOL_TEXT_MAX_CHARS,
  projectDirectoryEntry,
  projectGrepMatch,
  projectGrepSkippedSample,
  projectTableRow,
  projectUnreadableDirectorySample,
} from "./tool-result-field-projection.js";
import {
  asRecord,
  booleanOrUndefined,
  isMcpToolName,
  isString,
  numberOrUndefined,
  searchMessageFromOutput,
  stringArray,
  stringOrUndefined,
  textOrUndefined,
} from "./tool-result-facts.js";
import { compactSafeText, redactOrdinaryText } from "./tool-projection-text.js";
import { toolResultContinuation } from "./tool-result-continuation.js";
import { isSubAgentToolName, projectSubAgentToolModelResult } from "./sub-agent-tool-projection.js";
import {
  ensureToolResultContent,
  structuredRecordWithoutVerbose,
  structuredSnapshot,
  textContentBlocks,
  textFragmentForToolResult,
} from "./tool-model-result-support.js";
type ToolDisplayShape = "file" | "sources" | "diff" | "terminal" | "approval" | "text" | "generic";

export function projectToolResult(input: {
  readonly request: ToolCallRequest;
  readonly output: unknown;
  readonly maxPreviewChars?: number;
}): ToolSafeProjection {
  const record = asRecord(input.output);
  const summary = stringOrUndefined(record.summary);
  const refId = stringOrUndefined(record.refId);
  const truncated = record.truncated === true;
  const display = projectToolDisplay(input.request, input.output);
  const modelResult = projectToolModelResult(input.request, input.output, display, truncated);
  const fallbackSummary = projectToolFallbackSummary(input.request, input.output, display, modelResult);
  const modelContinuation = projectToolModelContinuation({
    request: input.request,
    output: input.output,
    modelResult,
    truncated,
  });
  const diagnosticRef = refId ?? `tool:${input.request.callId}`;
  const envelope = projectKernelToolResultEnvelope({
    request: input.request,
    display,
    summary,
    diagnosticRef,
    truncated,
  });
  // agentContent is the model-continuation payload. UI-only summaries and
  // display previews must never replace it.
  return {
    agentContent: modelContinuation.agentContent,
    modelResult: modelContinuation.modelResult,
    modelAttachments: toolModelAttachmentsFromOutput(input.output),
    uiSummary: compactSafeText(summary ?? fallbackSummary, input.maxPreviewChars ?? 800),
    diagnosticRef,
    display,
    envelope,
    truncated,
    redacted: false,
  };
}

export function projectToolFailure(input: {
  readonly request: ToolCallRequest;
  readonly error: string;
  readonly diagnosticRef?: string;
  readonly errorDomain?: ToolErrorDomain;
  readonly errorFacts?: ToolErrorFacts;
  readonly durationMs?: number;
}): ToolSafeProjection {
  const diagnosticRef = input.diagnosticRef ?? `tool:${input.request.callId}:failed`;
  const modelResult = toolFailureModelResult(input);
  return {
    agentContent: {
      status: "failed",
      toolName: input.request.toolName,
      callId: input.request.callId,
      error: input.error,
      errorDomain: input.errorDomain,
      errorFacts: input.errorFacts,
      facts: input.errorFacts,
      durationMs: input.durationMs,
    },
    modelResult,
    uiSummary: redactOrdinaryText(input.error, 500),
    diagnosticRef,
    envelope: projectToolStatusEnvelope({
      request: input.request,
      status: "failed",
      summary: input.error,
      diagnosticRef,
      errorDomain: input.errorDomain,
      errorFacts: input.errorFacts,
    }),
    truncated: false,
    redacted: false,
  };
}

export function projectToolApprovalRequired(input: {
  readonly request: ToolCallRequest;
  readonly toolName: string;
  readonly operationType: string;
  readonly actionSummary?: string;
}): ToolSafeProjection {
  const diagnosticRef = `tool:${input.request.callId}:confirmation-required`;
  const summary = input.actionSummary ?? toolDisplayName(input.toolName);
  return {
    uiSummary: summary,
    diagnosticRef,
    modelResult: toolApprovalModelResult(input, summary),
    envelope: projectToolStatusEnvelope({
      request: input.request,
      status: "approval_required",
      summary,
      diagnosticRef,
    }),
    truncated: false,
    redacted: false,
  };
}

export function projectToolModelResult(
  request: ToolCallRequest,
  output: unknown,
  display: ToolDisplayProjection,
  truncated: boolean
): InternalToolResult {
  const record = asRecord(output);
  const explicit = toolResultFromUnknown(record.canonicalResult) ?? toolResultFromUnknown(record.mcpResult);
  if (explicit !== undefined) {
    return ensureToolResultContent(explicit, toolResultFallbackText(request, display, record));
  }
  if (record.result !== undefined && isMcpToolName(request.toolName)) {
    return ensureToolResultContent(projectLegacyMcpToolResult(record), toolResultFallbackText(request, display, record));
  }
  if (request.toolName === "run_command" || request.toolName === "shell_command") {
    return projectCommandToolModelResult({ request, output, truncated, fallbackText: toolResultFallbackText(request, display, record) });
  }
  if (isFileReadTool(request.toolName)) {
    return projectFileReadToolModelResult({ request, output, truncated, fallbackText: toolResultFallbackText(request, display, record) });
  }
  if (request.toolName === "read") {
    return projectResearchReadToolModelResult({
      request,
      output,
      truncated,
      fallbackText: Array.isArray(output) ? "工具返回了可查看的读取结果。" : toolResultFallbackText(request, display, record),
    });
  }
  if (request.toolName === "search") {
    return searchToolResult(request, output, display);
  }
  if (request.toolName === "grep_files" || request.toolName === "search_context_attachment_files") {
    return fileSearchToolResult(request, output, truncated);
  }
  if (request.toolName === "list_context_attachment_files") {
    return contextAttachmentListToolResult(request, output, truncated);
  }
  if (request.toolName === "read_context_attachment_table") {
    return contextAttachmentTableToolResult(request, output, truncated);
  }
  if (display.kind === "directory_listing") {
    return directoryToolResult(request, display, truncated, output);
  }
  if (display.kind === "file_change_summary" || display.kind === "file_diff_preview") {
    return fileChangeToolResult(display, truncated);
  }
  if (isSubAgentToolName(request.toolName)) {
    return projectSubAgentToolModelResult({
      request,
      output,
      display,
      truncated,
      fallbackText: toolResultFallbackText(request, display, record),
    });
  }
  if (display.kind === "browser_snapshot") {
    const result = asRecord(record.result);
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
    }, toolResultFallbackText(request, display, record));
  }
  if (display.kind === "http_response") {
    const result = asRecord(record.result);
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
    }, toolResultFallbackText(request, display, record));
  }
  return ensureToolResultContent({
    content: genericToolResultContent(record, display),
    structuredContent: genericStructuredContent(request, output, display, truncated),
    isError: record.isError === true ? true : undefined,
  }, toolResultFallbackText(request, display, record));
}

export function projectToolFallbackSummary(
  request: ToolCallRequest,
  output: unknown,
  display: ToolDisplayProjection,
  modelResult: InternalToolResult
): string {
  const record = asRecord(output);
  const mcpLike = isMcpToolName(request.toolName) || record.mcpResult !== undefined;
  const toolExplanation = explicitExplanationFromOutput(record, { includeSummary: !mcpLike });
  if (toolExplanation !== undefined) {
    return toolExplanation;
  }
  const mcpText = mcpLike
    ? explanationFromToolResultText(modelResult)
    : undefined;
  if (mcpText !== undefined) {
    return mcpText;
  }
  const structuredText = explanationFromStructuredContent(modelResult.structuredContent);
  if (structuredText !== undefined) {
    return structuredText;
  }
  const shape = displayShapeForTool(request, display);
  return fallbackExplanationForShape(shape, modelResult.isError === true);
}

export function toolFailureModelResult(input: {
  readonly request: ToolCallRequest;
  readonly error: string;
  readonly diagnosticRef?: string;
  readonly errorDomain?: ToolErrorDomain;
  readonly errorFacts?: ToolErrorFacts;
  readonly durationMs?: number;
}): ToolResult {
  return {
    content: [{ type: "text", text: input.error }],
    structuredContent: structuredSnapshot({
      status: "failed",
      toolName: input.request.toolName,
      callId: input.request.callId,
      error: input.error,
      errorDomain: input.errorDomain,
      errorFacts: input.errorFacts,
      durationMs: input.durationMs,
    }),
    isError: true,
    error: {
      message: input.error,
      domain: input.errorDomain,
      facts: input.errorFacts,
    },
  };
}

export function toolApprovalModelResult(input: {
  readonly request: ToolCallRequest;
  readonly toolName: string;
  readonly operationType: string;
  readonly actionSummary?: string;
}, summary: string): ToolResult {
  return {
    content: [{ type: "text", text: summary }],
    structuredContent: structuredSnapshot({
      status: "waiting_approval",
      toolName: input.toolName,
      callId: input.request.callId,
      operationType: input.operationType,
      actionSummary: input.actionSummary,
    }),
  };
}

export function projectToolModelContinuation(input: {
  readonly request: ToolCallRequest;
  readonly output: unknown;
  readonly modelResult: InternalToolResult;
  readonly truncated: boolean;
}): { readonly agentContent: unknown; readonly modelResult: ToolResult } {
  const legacyAgentContent = projectToolAgentContent(input.request, input.output, input.truncated);
  const modelResult = toolResultFromModelResult(input.modelResult, input.truncated);
  const record = asRecord(input.output);
  const mcpLike = isMcpToolName(input.request.toolName) || record.mcpResult !== undefined;
  if (!mcpLike) {
    return {
      agentContent: legacyAgentContent,
      modelResult,
    };
  }

  return {
    agentContent: {
      ...asRecord(legacyAgentContent),
      content: modelResult.content,
      structuredContent: modelResult.structuredContent,
      isError: modelResult.isError,
      truncation: modelResult.truncation,
    },
    modelResult,
  };
}

function toolResultFromModelResult(
  modelResult: InternalToolResult,
  truncated: boolean
): ToolResult {
  return {
    content: modelResult.content,
    structuredContent: modelResult.structuredContent,
    isError: modelResult.isError,
    error: modelResult.error,
    truncation: modelResult.truncation ?? (truncated ? {
      truncated: true,
      continuation: modelResult.continuation,
    } : undefined),
    continuation: modelResult.continuation,
  };
}

function searchToolResult(
  request: ToolCallRequest,
  output: unknown,
  display: ToolDisplayProjection
): InternalToolResult {
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
  }, toolResultFallbackText(request, display, record));
}

function fileSearchToolResult(request: ToolCallRequest, output: unknown, truncated: boolean): InternalToolResult {
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
  }, stringOrUndefined(record.summary) ?? "工具返回了可参考的结果。");
}

function contextAttachmentListToolResult(
  request: ToolCallRequest,
  output: unknown,
  truncated: boolean
): InternalToolResult {
  const record = asRecord(output);
  const result = asRecord(record.result);
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
  }, stringOrUndefined(record.summary) ?? "工具返回了可查看的附件目录结果。");
}

function contextAttachmentTableToolResult(
  request: ToolCallRequest,
  output: unknown,
  truncated: boolean
): InternalToolResult {
  const record = asRecord(output);
  const result = asRecord(record.result);
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
  }, stringOrUndefined(record.summary) ?? "工具返回了可查看的附件表格结果。");
}

function directoryToolResult(
  request: ToolCallRequest,
  display: Extract<ToolDisplayProjection, { readonly kind: "directory_listing" }>,
  truncated: boolean,
  output?: unknown
): InternalToolResult {
  const result = asRecord(asRecord(output).result);
  const entries = display.entries.map((entry) => [entry.kind, entry.path].filter(isString).join(" "));
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
      truncated: display.truncated === true || truncated,
    }),
    continuation: toolResultContinuation({
      request,
      result,
      display,
      truncated: display.truncated === true || truncated,
    }),
  }, "工具返回了可查看的结果。");
}

function fileChangeToolResult(
  display: Extract<ToolDisplayProjection, { readonly kind: "file_change_summary" | "file_diff_preview" }>,
  truncated: boolean
): InternalToolResult {
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
  }, "工具返回了文件变更内容。");
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

function genericStructuredContent(
  request: ToolCallRequest,
  output: unknown,
  display: ToolDisplayProjection,
  truncated: boolean
): unknown {
  const record = asRecord(output);
  const result = asRecord(record.result);
  return structuredSnapshot({
    toolName: request.toolName,
    action: stringOrUndefined(record.action),
    display,
    result: structuredRecordWithoutVerbose(result),
    truncated,
  });
}

function displayShapeForTool(request: ToolCallRequest, display: ToolDisplayProjection): ToolDisplayShape {
  if (display.kind === "command_summary") return "terminal";
  if (display.kind === "search_results" || display.kind === "file_search_results") return "sources";
  if (display.kind === "file_change_summary" || display.kind === "file_diff_preview") return "diff";
  if (display.kind === "read_result") return "file";
  if (display.kind === "browser_snapshot" || display.kind === "http_response") return "text";
  if (display.kind === "generic_tool_summary" && isMcpToolName(request.toolName)) return "text";
  return displayShapeForToolName(request.toolName);
}

function displayShapeForToolName(toolName: string): ToolDisplayShape {
  const normalized = toolName.trim().toLowerCase();
  if (normalized === "run_command" || normalized === "shell_command" || normalized.includes("command") || normalized.includes("terminal")) {
    return "terminal";
  }
  if (normalized === "search" || normalized.includes("search") || normalized.includes("grep")) {
    return "sources";
  }
  if (normalized.includes("edit") || normalized.includes("write") || normalized.includes("create") || normalized.includes("delete") || normalized.includes("patch")) {
    return "diff";
  }
  if (normalized.startsWith("read") || normalized.includes("file")) {
    return "file";
  }
  return "generic";
}

function explicitExplanationFromOutput(
  record: Readonly<Record<string, unknown>>,
  options: { readonly includeSummary: boolean } = { includeSummary: true }
): string | undefined {
  const legacyPresentation = asRecord(record.presentation);
  const explanation = asRecord(legacyPresentation.explanation);
  const candidates = [
    stringOrUndefined(explanation.text),
    typeof record.explanation === "string" ? record.explanation : stringOrUndefined(asRecord(record.explanation).text),
    stringOrUndefined(record.message),
    options.includeSummary ? stringOrUndefined(record.summary) : undefined,
  ];
  return candidates
    .map((candidate) => candidate === undefined ? undefined : compactExplanationText(candidate))
    .find((candidate): candidate is string => candidate !== undefined && !isLowValueExplanation(candidate));
}

function explanationFromToolResultText(result: InternalToolResult): string | undefined {
  const text = result.content
    .map((part) => part.type === "text" ? part.text : part.type === "resource" ? part.text : undefined)
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return compactExplanationText(text);
}

function explanationFromStructuredContent(value: unknown): string | undefined {
  const record = asRecord(value);
  const candidates = [
    stringOrUndefined(record.explanation),
    stringOrUndefined(asRecord(record.explanation).text),
    stringOrUndefined(record.message),
    stringOrUndefined(record.summary),
    stringOrUndefined(record.title),
  ];
  return candidates
    .map((candidate) => candidate === undefined ? undefined : compactExplanationText(candidate))
    .find((candidate): candidate is string => candidate !== undefined && !isLowValueExplanation(candidate));
}

function fallbackExplanationForShape(shape: ToolDisplayShape, isError: boolean): string {
  if (shape === "approval") return "这个操作需要确认后才能继续。";
  if (isError) {
    if (shape === "terminal") return "命令返回了错误输出。";
    if (shape === "sources") return "工具返回了需要处理的问题。";
    return "工具返回了错误信息。";
  }
  if (shape === "terminal") return "命令返回了执行输出。";
  if (shape === "sources") return "工具返回了可参考的结果。";
  if (shape === "diff") return "工具返回了文件变更内容。";
  if (shape === "file") return "工具返回了可阅读内容。";
  if (shape === "text") return "工具返回了一段文本。";
  return "工具返回了可查看的结果。";
}

function toolResultFallbackText(
  request: ToolCallRequest,
  display: ToolDisplayProjection,
  record: Readonly<Record<string, unknown>>
): string {
  return compactExplanationText(stringOrUndefined(record.summary)) ??
    fallbackExplanationForShape(displayShapeForTool(request, display), record.isError === true);
}

function compactExplanationText(value: string | undefined): string | undefined {
  const text = compactSafeText(value?.replace(/\s+/g, " "), 180);
  if (text === undefined || text.length === 0) {
    return undefined;
  }
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? text;
  return compactSafeText(firstLine, 180);
}

function isLowValueExplanation(value: string): boolean {
  const normalized = value.replace(/[。.!！?？；;:：、，,\s_-]/g, "").trim().toLowerCase();
  if (normalized.length === 0) return true;
  return normalized === "工具已完成" ||
    normalized === "工具完成" ||
    normalized === "动作完成" ||
    normalized === "已完成" ||
    normalized === "完成" ||
    normalized === "读取完成" ||
    normalized === "资料读取完成" ||
    normalized === "文件已读取" ||
    normalized === "命令已执行" ||
    normalized === "执行完成" ||
    normalized === "搜索完成";
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

function isFileReadTool(toolName: string): boolean {
  return toolName === "read_file" ||
    toolName === "read_skill_resource" ||
    toolName === "read_context_attachment_text" ||
    toolName === "read_context_attachment_pdf_text";
}
