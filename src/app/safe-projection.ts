import type { ModelFailure } from "../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolDisplayProjection,
  ToolErrorDomain,
  ToolErrorFacts,
  ToolSafeProjection,
} from "../domain/tools/index.js";
import { toolDisplayName, toolModelAttachmentsFromOutput } from "../domain/tools/index.js";
import {
  projectToolResultEnvelope as projectKernelToolResultEnvelope,
  projectToolStatusEnvelope,
} from "../kernel/tools/index.js";
import { commandProgramFromToolResult, commandTextFromToolResult } from "./command-text.js";
import { sanitizeAssistantVisibleText } from "./visible-text-safety.js";
import { cleanOrdinaryToolText } from "./ordinary-tool-copy.js";
import { normalizeToolDisplayForOperation } from "./tool-display-normalization.js";

const MODEL_TOOL_TEXT_MAX_CHARS = 128_000;
const MODEL_TOOL_ERROR_MAX_CHARS = 64_000;

// Historical compatibility name: callers across the app still import
// "redactOrdinaryText", but current ordinary text policy is compact-only.
export function redactOrdinaryText(value: string, maxLength = 1_200): string {
  return compactSafeText(sanitizeAssistantVisibleText(value), maxLength) ?? "";
}

// Historical compatibility name: markdown visible to the model/UI is preserved
// except for newline normalization and transparent length clipping.
export function redactOrdinaryMarkdownFragment(value: string, maxLength = 1_200): string {
  const text = sanitizeAssistantVisibleText(value, { preserveOuterWhitespace: true })
    .replace(/\r\n?/g, "\n");
  if (text.trim().length === 0) return text;
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

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
    agentContent: projectToolAgentContent(input.request, input.output, truncated),
    modelAttachments: toolModelAttachmentsFromOutput(input.output),
    uiSummary: compactSafeText(summary ?? `${toolDisplayName(input.request.toolName)}已完成。`, input.maxPreviewChars ?? 800),
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

export function projectModelFailure(failure: ModelFailure | undefined): string {
  return redactOrdinaryText(failure?.message ?? "模型服务没有返回可用结果。", 600);
}

export function safeReadFileToolPreview(input: {
  readonly summary?: string;
  readonly path?: string;
  readonly bytes?: number;
  readonly maxLength?: number;
}): string | undefined {
  const headline = cleanOrdinaryToolText(input.summary) ?? input.path;
  return compactSafeText(headline || "文件已读取。", input.maxLength ?? 900);
}

export function safeCommandToolPreview(input: {
  readonly summary?: string;
  readonly command?: string;
  readonly exitCode?: number;
  readonly maxLength?: number;
}): string | undefined {
  const headline = cleanOrdinaryToolText(input.summary) ?? input.command;
  return compactSafeText(headline || "命令已执行。", input.maxLength ?? 900);
}

export function compactSafeText(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const text = value.trim();
  if (text.length === 0) {
    return undefined;
  }
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}...`;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}

function optionalRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  const record = asRecord(value);
  return Object.keys(record).length === 0 ? undefined : record;
}

function readErrorFactsFromOutput(record: Readonly<Record<string, unknown>>): ToolErrorFacts | undefined {
  const direct = optionalRecord(record.errorFacts);
  if (direct !== undefined) {
    return direct as ToolErrorFacts;
  }
  const trace = asRecord(record.trace);
  const sourceSteps = Array.isArray(trace.sourceSteps) ? trace.sourceSteps : [];
  for (const value of sourceSteps) {
    const step = asRecord(value);
    if (stringOrUndefined(step.status) === "completed") {
      continue;
    }
    const facts = optionalRecord(step.errorFacts);
    if (facts !== undefined) {
      return facts as ToolErrorFacts;
    }
  }
  return undefined;
}

function readErrorMessageFromOutput(record: Readonly<Record<string, unknown>>): string | undefined {
  const direct = stringOrUndefined(record.error);
  if (direct !== undefined) {
    return direct;
  }
  const trace = asRecord(record.trace);
  const sourceSteps = Array.isArray(trace.sourceSteps) ? trace.sourceSteps : [];
  for (const value of sourceSteps) {
    const step = asRecord(value);
    if (stringOrUndefined(step.status) === "completed") {
      continue;
    }
    const message = stringOrUndefined(step.message);
    if (message !== undefined) {
      return message;
    }
  }
  return undefined;
}

function searchMessageFromOutput(record: Readonly<Record<string, unknown>>): string | undefined {
  const direct = stringOrUndefined(record.message);
  if (direct !== undefined) {
    return direct;
  }
  const trace = asRecord(record.trace);
  const sourceSteps = Array.isArray(trace.sourceSteps) ? trace.sourceSteps : [];
  for (const value of sourceSteps) {
    const step = asRecord(value);
    if (stringOrUndefined(step.status) === "completed") {
      continue;
    }
    const message = stringOrUndefined(step.message);
    if (message !== undefined) {
      return message;
    }
  }
  return undefined;
}

function projectToolDisplay(request: ToolCallRequest, output: unknown): ToolDisplayProjection {
  const record = asRecord(output);
  const result = asRecord(record.result);
  const action = displayActionForTool(stringOrUndefined(record.action), request.toolName);
  const summary = compactSafeText(stringOrUndefined(record.summary), 500);
  if (request.toolName === "search" && Array.isArray(record.results)) {
    return {
      kind: "search_results",
      query: stringOrUndefined(record.query),
      status: stringOrUndefined(record.status),
      message: compactSafeText(searchMessageFromOutput(record), 500),
      results: record.results.slice(0, 8).map(searchDisplayItem).filter((item): item is NonNullable<ReturnType<typeof searchDisplayItem>> => item !== undefined),
      truncated: record.results.length > 8 || record.truncated === true,
    };
  }
  if (request.toolName === "read" && Array.isArray(output)) {
    return {
      kind: "generic_tool_summary",
      action,
      summary: `读取 ${output.length} 个 ref。`,
      items: output.slice(0, 8).map(batchReadDisplayItem).filter(isString),
    };
  }
  if (request.toolName === "read") {
    const errorFacts = readErrorFactsFromOutput(record);
    const error = readErrorMessageFromOutput(record);
    return {
      kind: "read_result",
      ref: stringOrUndefined(record.ref) ?? stringOrUndefined(asRecord(request.input).ref),
      source: stringOrUndefined(result.source),
      status: stringOrUndefined(record.status) ?? stringOrUndefined(result.status),
      title: stringOrUndefined(result.title),
      url: stringOrUndefined(result.uri),
      uri: stringOrUndefined(result.uri),
      sourceSearchRef: stringOrUndefined(result.sourceSearchRef),
      contentPreview: compactSafeText(stringOrUndefined(result.contentPreview) ?? stringOrUndefined(result.summary), 1_200),
      error,
      errorFacts,
      truncated: result.truncated === true || record.truncated === true,
    };
  }
  if (request.toolName === "browser_snapshot") {
    return {
      kind: "browser_snapshot",
      title: stringOrUndefined(result.title),
      url: stringOrUndefined(result.url),
      text: compactSafeText(stringOrUndefined(result.text), 900),
      truncated: record.truncated === true,
    };
  }
  if (request.toolName === "http_request") {
    return {
      kind: "http_response",
      method: stringOrUndefined(result.method),
      url: stringOrUndefined(result.url),
      statusCode: numberOrUndefined(result.statusCode),
      statusText: stringOrUndefined(result.statusText),
      durationMs: numberOrUndefined(result.durationMs),
      bodyPreview: compactSafeText(stringOrUndefined(result.body), 900),
      truncated: result.truncated === true || record.truncated === true,
    };
  }
  if (record.result !== undefined && isMcpToolName(request.toolName)) {
    return normalizeToolDisplayForOperation({
      toolName: request.toolName,
      input: request.input,
      output,
      existingDisplay: record.display,
      truncated: record.truncated === true,
    });
  }
  const normalizedDisplay = normalizeToolDisplayForOperation({
    toolName: request.toolName,
    input: request.input,
    output,
    existingDisplay: record.display,
    truncated: record.truncated === true,
  });
  if (
    (normalizedDisplay.kind === "file_change_summary" || normalizedDisplay.kind === "file_diff_preview") &&
    request.toolName !== "write_file" &&
    request.toolName !== "create_file" &&
    request.toolName !== "delete_file" &&
    request.toolName !== "edit_file"
  ) {
    return normalizedDisplay;
  }
  if (request.toolName === "write_file" || request.toolName === "create_file" || request.toolName === "delete_file") {
    return normalizedDisplay;
  }
  if (request.toolName === "edit_file") {
    return normalizedDisplay;
  }
  if (request.toolName === "run_command" || request.toolName === "shell_command") {
    const stdout = stringOrUndefined(result.stdout);
    const stderr = stringOrUndefined(result.stderr);
    const commandLine = commandTextFromToolResult(result, request.input);
    return {
      kind: "command_summary",
      command: commandProgramFromToolResult(result, request.input),
      args: stringArray(result.args).length > 0 ? stringArray(result.args) : stringArray(asRecord(request.input).args),
      commandLine,
      cwd: stringOrUndefined(result.cwd),
      shell: stringOrUndefined(asRecord(result.shell).label),
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
      outputSummary: stdout === undefined ? undefined : summarizeCommandOutput(stdout),
      errorSummary: stderr === undefined ? undefined : summarizeCommandOutput(stderr),
    };
  }
  if (request.toolName === "list_dir" && Array.isArray(result.entries)) {
    return {
      kind: "generic_tool_summary",
      action,
      summary,
      items: result.entries.slice(0, 12).map((entry) => {
        const item = asRecord(entry);
        const path = stringOrUndefined(item.path) ?? stringOrUndefined(item.name);
        const depth = numberOrUndefined(item.depth);
        return [
          stringOrUndefined(item.kind),
          path,
          depth === undefined ? undefined : `depth=${depth}`,
        ].filter(isString).join(" ");
      }).filter((item) => item.length > 0),
    };
  }
  if (request.toolName === "grep_files" && Array.isArray(result.matches)) {
    return {
      kind: "generic_tool_summary",
      action,
      summary,
      items: result.matches.slice(0, 12).map((match) => {
        const item = asRecord(match);
        const path = stringOrUndefined(item.path);
        const line = numberOrUndefined(item.line);
        return path === undefined ? undefined : `${path}${line === undefined ? "" : `:${line}`}`;
      }).filter(isString),
    };
  }
  return normalizedDisplay;
}

function projectToolAgentContent(request: ToolCallRequest, output: unknown, truncated: boolean): unknown {
  const record = asRecord(output);
  const result = asRecord(record.result);
  const summary = stringOrUndefined(record.summary);
  if (request.toolName === "read_skill_resource") {
    const content = typeof result.content === "string"
      ? modelVisibleTextFragment({
          value: result.content,
          maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
          request,
          field: "content",
        })
      : undefined;
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
      charCount: numberOrUndefined(result.charCount),
      hasMoreAfter: result.hasMoreAfter === true,
      truncated: truncated || content?.truncated === true,
      content: content?.text,
      rawContentRef: content?.rawRef,
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
      requestedRowCount: numberOrUndefined(result.requestedRowCount),
      rows: Array.isArray(result.rows) ? result.rows.slice(0, 200).map(projectTableRow) : undefined,
      rowsReturned: numberOrUndefined(result.rowsReturned),
      hasMoreBefore: result.hasMoreBefore === true,
      hasMoreAfter: result.hasMoreAfter === true,
      truncated,
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
    return {
      summary,
      attachmentId: stringOrUndefined(result.attachmentId),
      kind: stringOrUndefined(result.kind),
      title: stringOrUndefined(result.title),
      path: stringOrUndefined(result.path),
      depth: numberOrUndefined(result.depth),
      maxDepth: numberOrUndefined(result.maxDepth),
      entries: Array.isArray(result.entries) ? result.entries.slice(0, 200).map(projectDirectoryEntry) : undefined,
      entriesReturned: numberOrUndefined(result.entriesReturned),
      totalEntries: numberOrUndefined(result.totalEntries),
      unreadableDirectories: numberOrUndefined(result.unreadableDirectories),
      unreadableSamples: Array.isArray(result.unreadableSamples)
        ? result.unreadableSamples.slice(0, 8).map(projectUnreadableDirectorySample)
        : undefined,
      truncated,
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
      matches: Array.isArray(result.matches) ? result.matches.slice(0, 80).map(projectGrepMatch) : undefined,
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
      truncated,
    };
  }
  if (request.toolName === "list_dir") {
    return {
      summary,
      path: stringOrUndefined(result.path),
      depth: numberOrUndefined(result.depth),
      maxDepth: numberOrUndefined(result.maxDepth),
      entries: Array.isArray(result.entries) ? result.entries.slice(0, 200).map(projectDirectoryEntry) : undefined,
      entriesReturned: numberOrUndefined(result.entriesReturned),
      totalEntries: numberOrUndefined(result.totalEntries),
      unreadableDirectories: numberOrUndefined(result.unreadableDirectories),
      unreadableSamples: Array.isArray(result.unreadableSamples)
        ? result.unreadableSamples.slice(0, 8).map(projectUnreadableDirectorySample)
        : undefined,
      truncated,
    };
  }
  if (request.toolName === "grep_files") {
    return {
      summary,
      query: stringOrUndefined(result.query),
      path: stringOrUndefined(result.path),
      engine: stringOrUndefined(result.engine),
      matches: Array.isArray(result.matches) ? result.matches.slice(0, 80).map(projectGrepMatch) : undefined,
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
      truncated,
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
    return {
      summary,
      url: stringOrUndefined(result.url),
      title: stringOrUndefined(result.title),
      truncated: truncated || text?.truncated === true,
      text: text?.text,
      rawTextRef: text?.rawRef,
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
    return {
      summary,
      url: stringOrUndefined(result.url),
      method: stringOrUndefined(result.method),
      statusCode: numberOrUndefined(result.statusCode),
      statusText: stringOrUndefined(result.statusText),
      headers: asRecord(result.headers),
      durationMs: numberOrUndefined(result.durationMs),
      truncated: result.truncated === true || truncated || body?.truncated === true,
      body: body?.text,
      rawBodyRef: body?.rawRef,
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

function batchReadDisplayItem(value: unknown): string | undefined {
  const item = asRecord(value);
  const ref = stringOrUndefined(item.ref);
  const status = stringOrUndefined(item.status);
  const title = stringOrUndefined(item.title);
  const error = stringOrUndefined(item.error);
  const headline = title ?? ref;
  if (headline === undefined && status === undefined) {
    return undefined;
  }
  return [status, headline, error].filter(isString).join(" · ");
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

function projectDirectoryEntry(value: unknown): {
  readonly path?: string;
  readonly name?: string;
  readonly kind?: string;
  readonly bytes?: number;
  readonly depth?: number;
} {
  const record = asRecord(value);
  return {
    path: stringOrUndefined(record.path),
    name: stringOrUndefined(record.name),
    kind: stringOrUndefined(record.kind),
    bytes: numberOrUndefined(record.bytes),
    depth: numberOrUndefined(record.depth),
  };
}

function projectArchiveEntry(value: unknown): {
  readonly path?: string;
  readonly name?: string;
  readonly kind?: string;
  readonly bytes?: number;
  readonly compressedBytes?: number;
  readonly compressionMethod?: number;
  readonly unsafePath?: boolean;
} {
  const record = asRecord(value);
  return {
    path: stringOrUndefined(record.path),
    name: stringOrUndefined(record.name),
    kind: stringOrUndefined(record.kind),
    bytes: numberOrUndefined(record.bytes),
    compressedBytes: numberOrUndefined(record.compressedBytes),
    compressionMethod: numberOrUndefined(record.compressionMethod),
    unsafePath: booleanOrUndefined(record.unsafePath),
  };
}

function projectContextAttachment(value: unknown): {
  readonly attachmentId?: string;
  readonly kind?: string;
  readonly format?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly mimeType?: string;
  readonly byteLength?: number;
  readonly available?: boolean;
  readonly previewTruncated?: boolean;
  readonly authorized?: boolean;
  readonly ref?: string;
  readonly canReadText?: boolean;
  readonly canReadPdfText?: boolean;
  readonly canReadImage?: boolean;
  readonly canReadTable?: boolean;
  readonly canInspectArchive?: boolean;
  readonly canListFiles?: boolean;
  readonly canSearchFiles?: boolean;
  readonly canUseVisionInput?: boolean;
} {
  const record = asRecord(value);
  return {
    attachmentId: stringOrUndefined(record.attachmentId),
    kind: stringOrUndefined(record.kind),
    format: stringOrUndefined(record.format),
    title: stringOrUndefined(record.title),
    summary: stringOrUndefined(record.summary),
    mimeType: stringOrUndefined(record.mimeType),
    byteLength: numberOrUndefined(record.byteLength),
    available: booleanOrUndefined(record.available),
    previewTruncated: booleanOrUndefined(record.previewTruncated),
    authorized: booleanOrUndefined(record.authorized),
    ref: stringOrUndefined(record.ref),
    canReadText: booleanOrUndefined(record.canReadText),
    canReadPdfText: booleanOrUndefined(record.canReadPdfText),
    canReadImage: booleanOrUndefined(record.canReadImage),
    canReadTable: booleanOrUndefined(record.canReadTable),
    canInspectArchive: booleanOrUndefined(record.canInspectArchive),
    canListFiles: booleanOrUndefined(record.canListFiles),
    canSearchFiles: booleanOrUndefined(record.canSearchFiles),
    canUseVisionInput: booleanOrUndefined(record.canUseVisionInput),
  };
}

function projectTableRow(value: unknown): {
  readonly rowNumber?: number;
  readonly values?: readonly string[];
  readonly record?: Readonly<Record<string, string>>;
} {
  const record = asRecord(value);
  return {
    rowNumber: numberOrUndefined(record.rowNumber),
    values: stringArray(record.values),
    record: stringRecordOrUndefined(record.record),
  };
}

function projectGrepMatch(value: unknown): { readonly path?: string; readonly line?: number; readonly preview?: string } {
  const record = asRecord(value);
  const preview = typeof record.preview === "string"
    ? modelVisibleTextFragment({ value: record.preview, maxLength: 500 })
    : undefined;
  return {
    path: stringOrUndefined(record.path),
    line: numberOrUndefined(record.line),
    preview: preview?.text,
  };
}

function projectUnreadableDirectorySample(value: unknown): {
  readonly path?: string;
  readonly errorCode?: string;
} {
  const record = asRecord(value);
  return {
    path: stringOrUndefined(record.path),
    errorCode: stringOrUndefined(record.errorCode),
  };
}

function projectGrepSkippedSample(value: unknown): {
  readonly path?: string;
  readonly reason?: string;
  readonly bytes?: number;
  readonly errorCode?: string;
} {
  const record = asRecord(value);
  return {
    path: stringOrUndefined(record.path),
    reason: stringOrUndefined(record.reason),
    bytes: numberOrUndefined(record.bytes),
    errorCode: stringOrUndefined(record.errorCode),
  };
}

type ModelVisibleTextFragment = {
  readonly text: string;
  readonly truncated: boolean;
  readonly rawRef?: string;
};

function modelVisibleTextFragment(input: {
  readonly value: string;
  readonly maxLength: number;
  readonly request?: ToolCallRequest;
  readonly field?: string;
}): ModelVisibleTextFragment {
  const { value, maxLength } = input;
  if (value.length <= maxLength) {
    return { text: value, truncated: false };
  }
  const marker = `\n[truncated to ${maxLength} chars]`;
  return {
    text: `${value.slice(0, Math.max(0, maxLength - marker.length))}${marker}`,
    truncated: true,
    rawRef: input.request === undefined || input.field === undefined
      ? undefined
      : rawToolFieldRef(input.request, input.field),
  };
}

function rawToolFieldRef(request: ToolCallRequest, field: string): string {
  return `tool:${request.callId}:raw:${request.toolName}:${field}`;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  if (value === true) return true;
  if (value === false) return false;
  return undefined;
}

function displayActionForTool(action: string | undefined, toolName: string): string {
  if (action === undefined || action === toolName || /^[a-z][a-z0-9_:-]*$/i.test(action)) {
    return toolDisplayName(action ?? toolName);
  }
  return action;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringRecordOrUndefined(value: unknown): Readonly<Record<string, string>> | undefined {
  const record = asRecord(value);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") {
      result[key] = item;
    }
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function searchDisplayItem(value: unknown): Extract<ToolDisplayProjection, { readonly kind: "search_results" }>["results"][number] | undefined {
  const item = asRecord(value);
  const title = stringOrUndefined(item.title);
  if (title === undefined) {
    return undefined;
  }
  return {
    title: redactOrdinaryText(title, 160),
    url: stringOrUndefined(item.url) ?? stringOrUndefined(item.uri),
    refId: stringOrUndefined(item.refId),
    source: stringOrUndefined(item.source),
    snippet: compactSafeText(stringOrUndefined(item.snippet), 260),
  };
}

function summarizeCommandOutput(value: string): string | undefined {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 4);
  return compactSafeText(lines.join("\n"), 420);
}

function isMcpToolName(toolName: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*__[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(toolName);
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
