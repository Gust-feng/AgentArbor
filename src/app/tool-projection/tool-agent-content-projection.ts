import type { ToolCallRequest } from "../../domain/tools/index.js";
import { toolDisplayName } from "../../domain/tools/index.js";
import { commandProgramFromToolResult, commandTextFromToolResult } from "./command-text.js";
import { projectToolDisplay } from "./tool-display-projection.js";
import {
  FILE_SEARCH_MODEL_MATCHES_LIMIT,
  MODEL_TOOL_ERROR_MAX_CHARS,
  MODEL_TOOL_TEXT_MAX_CHARS,
  modelVisibleTextFragment,
  projectArchiveEntry,
  projectContextAttachment,
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
  numberOrUndefined,
  optionalRecord,
  readErrorFactsFromOutput,
  readErrorMessageFromOutput,
  stringArray,
  stringOrUndefined,
} from "./tool-result-facts.js";
import { compactSafeText } from "./tool-projection-text.js";
import { toolResultContinuation } from "./tool-result-continuation.js";
import { isSubAgentToolName, projectSubAgentToolAgentContent } from "./sub-agent-tool-projection.js";
export function projectToolAgentContent(request: ToolCallRequest, output: unknown, truncated: boolean): unknown {
  const record = asRecord(output);
  const result = asRecord(record.result);
  const summary = stringOrUndefined(record.summary);
  if (isSubAgentToolName(request.toolName)) {
    return projectSubAgentToolAgentContent({ request, output, truncated });
  }
  if (request.toolName === "read_skill_resource") {
    const content = typeof result.content === "string"
      ? modelVisibleTextFragment({
          value: result.content,
          maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
          request,
          field: "content",
        })
      : undefined;
    const continuation = toolResultContinuation({
      request,
      result,
      truncated: truncated || content?.truncated === true,
    });
    return {
      summary,
      skillId: stringOrUndefined(result.skillId),
      path: stringOrUndefined(result.path),
      type: stringOrUndefined(result.type),
      contentHash: stringOrUndefined(result.contentHash),
      byteLength: numberOrUndefined(result.byteLength),
      charCount: numberOrUndefined(result.charCount),
      requiresToolExecution: result.requiresToolExecution === true,
      notExecutableByResolver: result.notExecutableByResolver === true,
      executionNote: stringOrUndefined(result.executionNote),
      truncated: truncated || content?.truncated === true,
      content: content?.text,
      rawContentRef: content?.rawRef,
      continuation,
    };
  }
  if (request.toolName === "read_file") {
    const content = typeof result.content === "string"
      ? modelVisibleTextFragment({
          value: result.content,
          maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
          request,
          field: "content",
        })
      : undefined;
    const continuation = toolResultContinuation({
      request,
      result,
      truncated: truncated || content?.truncated === true,
    });
    return {
      summary,
      path: stringOrUndefined(result.path),
      bytes: numberOrUndefined(result.bytes),
      binary: result.binary === true,
      startLine: numberOrUndefined(result.startLine),
      endLine: numberOrUndefined(result.endLine),
      totalLines: numberOrUndefined(result.totalLines),
      hasMoreBefore: result.hasMoreBefore === true,
      hasMoreAfter: result.hasMoreAfter === true,
      truncated: truncated || content?.truncated === true,
      content: content?.text,
      rawContentRef: content?.rawRef,
      continuation,
    };
  }
  if (request.toolName === "read_context_attachment_text") {
    const content = typeof result.content === "string"
      ? modelVisibleTextFragment({
          value: result.content,
          maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
          request,
          field: "content",
        })
      : undefined;
    const continuation = toolResultContinuation({
      request,
      result,
      truncated: truncated || content?.truncated === true,
    });
    return {
      summary,
      attachmentId: stringOrUndefined(result.attachmentId),
      kind: stringOrUndefined(result.kind),
      title: stringOrUndefined(result.title),
      path: stringOrUndefined(result.path),
      mimeType: stringOrUndefined(result.mimeType),
      bytes: numberOrUndefined(result.bytes),
      readable: result.readable === true ? true : result.readable === false ? false : undefined,
      binary: result.binary === true,
      reason: stringOrUndefined(result.reason),
      startLine: numberOrUndefined(result.startLine),
      endLine: numberOrUndefined(result.endLine),
      totalLines: numberOrUndefined(result.totalLines),
      hasMoreBefore: result.hasMoreBefore === true,
      hasMoreAfter: result.hasMoreAfter === true,
      truncated: truncated || content?.truncated === true,
      content: content?.text,
      rawContentRef: content?.rawRef,
      continuation,
    };
  }
  if (request.toolName === "read_context_attachment_pdf_text") {
    const content = typeof result.content === "string"
      ? modelVisibleTextFragment({
          value: result.content,
          maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
          request,
          field: "content",
        })
      : undefined;
    const continuation = toolResultContinuation({
      request,
      result,
      truncated: truncated || content?.truncated === true,
    });
    return {
      summary,
      attachmentId: stringOrUndefined(result.attachmentId),
      kind: stringOrUndefined(result.kind),
      title: stringOrUndefined(result.title),
      path: stringOrUndefined(result.path),
      mimeType: stringOrUndefined(result.mimeType),
      bytes: numberOrUndefined(result.bytes),
      format: stringOrUndefined(result.format),
      readable: booleanOrUndefined(result.readable),
      reason: stringOrUndefined(result.reason),
      extraction: stringOrUndefined(result.extraction),
      streamCount: numberOrUndefined(result.streamCount),
      decodedStreams: numberOrUndefined(result.decodedStreams),
      skippedStreams: numberOrUndefined(result.skippedStreams),
      textFragments: numberOrUndefined(result.textFragments),
      startChar: numberOrUndefined(result.startChar),
      textChars: numberOrUndefined(result.textChars),
      charCount: numberOrUndefined(result.charCount),
      hasMoreAfter: result.hasMoreAfter === true,
      nextStartChar: numberOrUndefined(result.nextStartChar),
      truncated: truncated || content?.truncated === true,
      content: content?.text,
      rawContentRef: content?.rawRef,
      continuation,
    };
  }
  if (request.toolName === "read_context_attachment_image") {
    return {
      summary,
      attachmentId: stringOrUndefined(result.attachmentId),
      kind: stringOrUndefined(result.kind),
      title: stringOrUndefined(result.title),
      path: stringOrUndefined(result.path),
      mimeType: stringOrUndefined(result.mimeType),
      bytes: numberOrUndefined(result.bytes),
      format: stringOrUndefined(result.format),
      readable: booleanOrUndefined(result.readable),
      reason: stringOrUndefined(result.reason),
      modelInput: {
        attached: booleanOrUndefined(asRecord(result.modelInput).attached),
        detail: stringOrUndefined(asRecord(result.modelInput).detail),
      },
      truncated,
    };
  }
  if (request.toolName === "list_context_attachments") {
    return {
      summary,
      count: numberOrUndefined(result.count),
      attachments: Array.isArray(result.attachments)
        ? result.attachments.slice(0, 80).map(projectContextAttachment)
        : undefined,
      truncated,
    };
  }
  if (request.toolName === "inspect_context_attachment_table") {
    return {
      summary,
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
      sampleRows: Array.isArray(result.sampleRows) ? result.sampleRows.slice(0, 20).map(projectTableRow) : undefined,
      truncated,
    };
  }
  if (request.toolName === "read_context_attachment_table") {
    const continuation = toolResultContinuation({ request, result, truncated });
    return {
      summary,
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
      rows: Array.isArray(result.rows) ? result.rows.slice(0, 200).map(projectTableRow) : undefined,
      rowsReturned: numberOrUndefined(result.rowsReturned),
      hasMoreBefore: result.hasMoreBefore === true,
      hasMoreAfter: result.hasMoreAfter === true,
      reachedRowCeiling: booleanOrUndefined(result.reachedRowCeiling),
      rowCeiling: numberOrUndefined(result.rowCeiling),
      truncated,
      continuation,
    };
  }
  if (request.toolName === "inspect_context_attachment_archive") {
    return {
      summary,
      attachmentId: stringOrUndefined(result.attachmentId),
      kind: stringOrUndefined(result.kind),
      title: stringOrUndefined(result.title),
      path: stringOrUndefined(result.path),
      mimeType: stringOrUndefined(result.mimeType),
      bytes: numberOrUndefined(result.bytes),
      archive: booleanOrUndefined(result.archive),
      readable: booleanOrUndefined(result.readable),
      reason: stringOrUndefined(result.reason),
      format: stringOrUndefined(result.format),
      entryCount: numberOrUndefined(result.entryCount),
      entriesReturned: numberOrUndefined(result.entriesReturned),
      entries: Array.isArray(result.entries) ? result.entries.slice(0, 200).map(projectArchiveEntry) : undefined,
      truncated,
    };
  }
  if (request.toolName === "list_context_attachment_files") {
    const continuation = toolResultContinuation({ request, result, truncated });
    return {
      summary,
      attachmentId: stringOrUndefined(result.attachmentId),
      kind: stringOrUndefined(result.kind),
      title: stringOrUndefined(result.title),
      path: stringOrUndefined(result.path),
      depth: numberOrUndefined(result.depth),
      offset: numberOrUndefined(result.offset),
      limit: numberOrUndefined(result.limit),
      maxDepth: numberOrUndefined(result.maxDepth),
      entries: Array.isArray(result.entries) ? result.entries.slice(0, 200).map(projectDirectoryEntry) : undefined,
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
      continuation,
    };
  }
  if (request.toolName === "search_context_attachment_files") {
    return {
      summary,
      attachmentId: stringOrUndefined(result.attachmentId),
      kind: stringOrUndefined(result.kind),
      title: stringOrUndefined(result.title),
      query: stringOrUndefined(result.query),
      path: stringOrUndefined(result.path),
      offset: numberOrUndefined(result.offset),
      limit: numberOrUndefined(result.limit),
      matches: Array.isArray(result.matches) ? result.matches.slice(0, FILE_SEARCH_MODEL_MATCHES_LIMIT).map(projectGrepMatch) : undefined,
      matchesReturned: numberOrUndefined(result.matchesReturned) ?? (Array.isArray(result.matches) ? result.matches.length : undefined),
      searchedFiles: numberOrUndefined(result.searchedFiles),
      skippedFiles: numberOrUndefined(result.skippedFiles),
      skippedBinaryFiles: numberOrUndefined(result.skippedBinaryFiles),
      skippedTooLargeFiles: numberOrUndefined(result.skippedTooLargeFiles),
      skippedUnreadableFiles: numberOrUndefined(result.skippedUnreadableFiles),
      skippedDirectories: numberOrUndefined(result.skippedDirectories),
      skippedOtherEntries: numberOrUndefined(result.skippedOtherEntries),
      skippedSamples: Array.isArray(result.skippedSamples)
        ? result.skippedSamples.slice(0, 8).map(projectGrepSkippedSample)
        : undefined,
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      nextOffset: numberOrUndefined(result.nextOffset),
      reachedOffsetCeiling: booleanOrUndefined(result.reachedOffsetCeiling),
      offsetCeiling: numberOrUndefined(result.offsetCeiling),
      truncated,
      continuation: toolResultContinuation({ request, result, truncated }),
    };
  }
  if (request.toolName === "list_dir") {
    const display = projectToolDisplay(request, output);
    return {
      summary,
      path: stringOrUndefined(result.path),
      depth: numberOrUndefined(result.depth),
      offset: numberOrUndefined(result.offset),
      limit: numberOrUndefined(result.limit),
      maxDepth: numberOrUndefined(result.maxDepth),
      entries: Array.isArray(result.entries) ? result.entries.slice(0, 200).map(projectDirectoryEntry) : undefined,
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
      continuation: display.kind === "directory_listing"
        ? toolResultContinuation({ request, result, display, truncated })
        : undefined,
    };
  }
  if (request.toolName === "grep_files") {
    return {
      summary,
      query: stringOrUndefined(result.query),
      path: stringOrUndefined(result.path),
      engine: stringOrUndefined(result.engine),
      offset: numberOrUndefined(result.offset),
      limit: numberOrUndefined(result.limit),
      matches: Array.isArray(result.matches) ? result.matches.slice(0, FILE_SEARCH_MODEL_MATCHES_LIMIT).map(projectGrepMatch) : undefined,
      matchesReturned: numberOrUndefined(result.matchesReturned) ?? (Array.isArray(result.matches) ? result.matches.length : undefined),
      searchedFiles: numberOrUndefined(result.searchedFiles),
      skippedFactsAvailable: result.skippedFactsAvailable === true ? true : result.skippedFactsAvailable === false ? false : undefined,
      skippedFactsComplete: result.skippedFactsComplete === true ? true : result.skippedFactsComplete === false ? false : undefined,
      skippedFiles: numberOrUndefined(result.skippedFiles),
      skippedBinaryFiles: numberOrUndefined(result.skippedBinaryFiles),
      skippedTooLargeFiles: numberOrUndefined(result.skippedTooLargeFiles),
      skippedUnreadableFiles: numberOrUndefined(result.skippedUnreadableFiles),
      skippedDirectories: numberOrUndefined(result.skippedDirectories),
      skippedOtherEntries: numberOrUndefined(result.skippedOtherEntries),
      skippedSamples: Array.isArray(result.skippedSamples)
        ? result.skippedSamples.slice(0, 8).map(projectGrepSkippedSample)
        : undefined,
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      nextOffset: numberOrUndefined(result.nextOffset),
      reachedOffsetCeiling: booleanOrUndefined(result.reachedOffsetCeiling),
      offsetCeiling: numberOrUndefined(result.offsetCeiling),
      maxOffset: numberOrUndefined(result.maxOffset),
      truncated,
      continuation: toolResultContinuation({ request, result, truncated }),
    };
  }
  if (request.toolName === "read") {
    const errorFacts = readErrorFactsFromOutput(record);
    const error = readErrorMessageFromOutput(record);
    if (Array.isArray(output)) {
      const results = output.map((item, index) => projectBatchReadAgentItem(item, request, index));
      return {
        summary: `read batch completed with ${results.length} item${results.length === 1 ? "" : "s"}.`,
        results,
        truncated: truncated || results.some((item) => item.truncated === true),
      };
    }
    const contentPreview = typeof result.contentPreview === "string"
      ? modelVisibleTextFragment({
          value: result.contentPreview,
          maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
          request,
          field: "contentPreview",
        })
      : undefined;
    return {
      summary,
      ref: stringOrUndefined(record.ref) ?? stringOrUndefined(asRecord(request.input).ref),
      source: stringOrUndefined(result.source),
      status: stringOrUndefined(record.status) ?? stringOrUndefined(result.status),
      title: stringOrUndefined(result.title),
      url: stringOrUndefined(result.uri),
      uri: stringOrUndefined(result.uri),
      sourceSearchRef: stringOrUndefined(result.sourceSearchRef),
      error,
      errorFacts,
      truncated: result.truncated === true || truncated || contentPreview?.truncated === true,
      contentPreview: contentPreview?.text,
      rawContentPreviewRef: contentPreview?.rawRef,
      metadata: optionalRecord(result.metadata),
    };
  }
  if (request.toolName === "run_command" || request.toolName === "shell_command") {
    const commandLine = commandTextFromToolResult(result, request.input);
    const stdout = typeof result.stdout === "string"
      ? modelVisibleTextFragment({
          value: result.stdout,
          maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
          request,
          field: "stdout",
        })
      : undefined;
    const stderr = typeof result.stderr === "string"
      ? modelVisibleTextFragment({
          value: result.stderr,
          maxLength: MODEL_TOOL_ERROR_MAX_CHARS,
          request,
          field: "stderr",
        })
      : undefined;
    return {
      summary,
      command: commandProgramFromToolResult(result, request.input),
      commandLine,
      cwd: stringOrUndefined(result.cwd),
      shell: {
        kind: stringOrUndefined(asRecord(result.shell).kind),
        label: stringOrUndefined(asRecord(result.shell).label),
        executable: stringOrUndefined(asRecord(result.shell).executable),
        syntax: stringOrUndefined(asRecord(result.shell).syntax),
      },
      exitCode: numberOrUndefined(result.exitCode),
      timedOut: result.timedOut === true,
      background: result.background === true,
      pid: numberOrUndefined(result.pid),
      logRef: stringOrUndefined(result.logRef),
      logPath: stringOrUndefined(result.logPath),
      stopCommand: stringOrUndefined(result.stopCommand),
      durationMs: numberOrUndefined(result.durationMs),
      waitForPort: numberOrUndefined(result.waitForPort),
      portReady: result.portReady === true ? true : result.portReady === false ? false : undefined,
      stdoutTruncated: result.stdoutTruncated === true ? true : result.stdoutTruncated === false ? false : undefined,
      stderrTruncated: result.stderrTruncated === true ? true : result.stderrTruncated === false ? false : undefined,
      stdoutChars: numberOrUndefined(result.stdoutChars),
      stderrChars: numberOrUndefined(result.stderrChars),
      stdoutOmittedChars: numberOrUndefined(result.stdoutOmittedChars),
      stderrOmittedChars: numberOrUndefined(result.stderrOmittedChars),
      truncated: truncated || stdout?.truncated === true || stderr?.truncated === true,
      stdout: stdout?.text,
      stderr: stderr?.text,
      rawStdoutRef: stdout?.rawRef,
      rawStderrRef: stderr?.rawRef,
      continuation: toolResultContinuation({
        request,
        result,
        truncated: truncated || stdout?.truncated === true || stderr?.truncated === true,
      }),
    };
  }
  if (request.toolName === "browser_snapshot") {
    const text = typeof result.text === "string"
      ? modelVisibleTextFragment({
          value: result.text,
          maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
          request,
          field: "text",
        })
      : undefined;
    const continuation = toolResultContinuation({
      request,
      result,
      truncated: truncated || text?.truncated === true,
    });
    return {
      summary,
      url: stringOrUndefined(result.url),
      title: stringOrUndefined(result.title),
      startChar: numberOrUndefined(result.startChar),
      textChars: numberOrUndefined(result.textChars),
      totalTextChars: numberOrUndefined(result.totalTextChars),
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      nextStartChar: numberOrUndefined(result.nextStartChar),
      reachedStartCharCeiling: booleanOrUndefined(result.reachedStartCharCeiling),
      startCharCeiling: numberOrUndefined(result.startCharCeiling),
      truncated: truncated || text?.truncated === true,
      text: text?.text,
      rawTextRef: text?.rawRef,
      continuation,
    };
  }
  if (request.toolName === "http_request") {
    const body = typeof result.body === "string"
      ? modelVisibleTextFragment({
          value: result.body,
          maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
          request,
          field: "body",
        })
      : undefined;
    const continuation = toolResultContinuation({
      request,
      result,
      truncated: result.truncated === true || truncated || body?.truncated === true,
    });
    return {
      summary,
      url: stringOrUndefined(result.url),
      method: stringOrUndefined(result.method),
      statusCode: numberOrUndefined(result.statusCode),
      statusText: stringOrUndefined(result.statusText),
      headers: asRecord(result.headers),
      durationMs: numberOrUndefined(result.durationMs),
      startChar: numberOrUndefined(result.startChar),
      bodyChars: numberOrUndefined(result.bodyChars),
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      nextStartChar: numberOrUndefined(result.nextStartChar),
      reachedStartCharCeiling: booleanOrUndefined(result.reachedStartCharCeiling),
      startCharCeiling: numberOrUndefined(result.startCharCeiling),
      truncated: result.truncated === true || truncated || body?.truncated === true,
      body: body?.text,
      rawBodyRef: body?.rawRef,
      continuation,
    };
  }
  if (record.result !== undefined && isMcpToolName(request.toolName)) {
    const text = typeof result.text === "string"
      ? modelVisibleTextFragment({
          value: result.text,
          maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
          request,
          field: "text",
        })
      : undefined;
    return {
      summary,
      truncated: truncated || text?.truncated === true,
      text: text?.text,
      rawTextRef: text?.rawRef,
      multimodal: Array.isArray(result.multimodal)
        ? result.multimodal.slice(0, 12).map(projectMcpMultimodalPart)
        : undefined,
    };
  }
  const display = projectToolDisplay(request, output);
  return {
    summary: compactSafeText(summary ?? `${toolDisplayName(request.toolName)}已完成。`, 1_200),
    display,
    truncated,
  };
}

function projectBatchReadAgentItem(
  value: unknown,
  request: ToolCallRequest,
  index: number
): {
  readonly ref?: string;
  readonly status?: string;
  readonly refId?: string;
  readonly source?: string;
  readonly title?: string;
  readonly url?: string;
  readonly uri?: string;
  readonly summary?: string;
  readonly contentPreview?: string;
  readonly truncated: boolean;
  readonly rawContentPreviewRef?: string;
  readonly sourceSearchRef?: string;
  readonly error?: string;
  readonly errorFacts?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
} {
  const item = asRecord(value);
  const contentPreview = typeof item.contentPreview === "string"
    ? modelVisibleTextFragment({
        value: item.contentPreview,
        maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
        request,
        field: `contentPreview:${index}`,
      })
    : undefined;
  return {
    ref: stringOrUndefined(item.ref),
    status: stringOrUndefined(item.status),
    refId: stringOrUndefined(item.refId),
    source: stringOrUndefined(item.source),
    title: stringOrUndefined(item.title),
    url: stringOrUndefined(item.uri),
    uri: stringOrUndefined(item.uri),
    summary: stringOrUndefined(item.summary),
    contentPreview: contentPreview?.text,
    truncated: item.truncated === true || contentPreview?.truncated === true,
    rawContentPreviewRef: contentPreview?.rawRef,
    sourceSearchRef: stringOrUndefined(item.sourceSearchRef),
    error: stringOrUndefined(item.error),
    errorFacts: optionalRecord(item.errorFacts),
    metadata: optionalRecord(item.metadata),
  };
}

function projectMcpMultimodalPart(value: unknown): {
  readonly type?: string;
  readonly mimeType?: string;
  readonly bytesApprox?: number;
} {
  const record = asRecord(value);
  return {
    type: stringOrUndefined(record.type),
    mimeType: stringOrUndefined(record.mimeType),
    bytesApprox: numberOrUndefined(record.bytesApprox),
  };
}
