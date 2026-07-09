import type {
  ToolCallRequest,
  ToolContinuation,
  ToolDisplayProjection,
} from "../../domain/tools/index.js";

type ToolResultContinuationInput = {
  readonly request: ToolCallRequest;
  readonly result: Readonly<Record<string, unknown>>;
  readonly truncated: boolean;
  readonly display?: ToolDisplayProjection;
};

export function toolContinuationFromUnknown(value: unknown): ToolContinuation | undefined {
  const record = asRecord(value);
  const ref = stringOrUndefined(record.ref);
  const note = stringOrUndefined(record.note);
  const nextInput = record.nextInput;
  if (ref === undefined && note === undefined && nextInput === undefined) {
    return undefined;
  }
  return {
    ref,
    nextInput,
    note,
  };
}

export function toolResultContinuation(input: ToolResultContinuationInput): ToolContinuation | undefined {
  const continuation = toolResultContinuationCandidate(input);
  return executableContinuation(continuation);
}

function toolResultContinuationCandidate(input: ToolResultContinuationInput): ToolContinuation | undefined {
  switch (input.request.toolName) {
    case "run_command":
    case "shell_command":
      return commandContinuation(input.result, input.truncated);
    case "read_file":
    case "read_context_attachment_text":
      return fileReadContinuation(input.request, input.result, input.truncated);
    case "read_context_attachment_pdf_text":
      return pdfTextContinuation(input.request, input.result, input.truncated);
    case "read_skill_resource":
      return skillResourceContinuation(input.request, input.result, input.truncated);
    case "list_dir":
      return directoryContinuation(input.request, input.result, input.display, input.truncated);
    case "grep_files":
    case "search_context_attachment_files":
      return offsetSearchContinuation(input.request, input.result, input.truncated);
    case "list_context_attachment_files":
      return contextAttachmentListContinuation(input.request, input.result, input.truncated);
    case "browser_snapshot":
      return browserContinuation(input.request, input.result, input.truncated);
    case "http_request":
      return httpContinuation(input.request, input.result, input.truncated);
    case "read_context_attachment_table":
      return contextAttachmentTableContinuation(input.request, input.result, input.truncated);
    default:
      return undefined;
  }
}

function commandContinuation(
  result: Readonly<Record<string, unknown>>,
  truncated: boolean
): ToolContinuation | undefined {
  if (!truncated) {
    return undefined;
  }
  const logRef = stringOrUndefined(result.logRef);
  return logRef === undefined
    ? undefined
    : {
        ref: logRef,
        nextInput: { ref: logRef, maxLength: 30_000 },
        note: "Use the read tool with this command-log ref to inspect the complete command output.",
      };
}

function fileReadContinuation(
  request: ToolCallRequest,
  result: Readonly<Record<string, unknown>>,
  truncated: boolean
): ToolContinuation | undefined {
  const hasMoreAfter = booleanOrUndefined(result.hasMoreAfter) === true;
  if (!truncated && !hasMoreAfter) {
    return undefined;
  }
  const nextInput = fileReadNextInput(request, result, hasMoreAfter);
  if (nextInput === undefined) {
    return undefined;
  }
  return {
    nextInput,
    note: hasMoreAfter
      ? "Continue with the next bounded file window to inspect more content."
      : "The model-visible content was transport-truncated; use the supplied bounded input to inspect more.",
  };
}

function fileReadNextInput(
  request: ToolCallRequest,
  result: Readonly<Record<string, unknown>>,
  hasMoreAfter: boolean
): Readonly<Record<string, unknown>> | undefined {
  const original = asRecord(request.input);
  const pathValue = stringOrUndefined(result.path) ?? stringOrUndefined(original.path);
  const attachmentId = stringOrUndefined(result.attachmentId) ?? stringOrUndefined(original.attachmentId);
  const ref = stringOrUndefined(original.ref);
  const nextStartChar = readNextStartChar(result);
  if (request.toolName === "read_file" && pathValue !== undefined && nextStartChar !== undefined) {
    return compactRecord({
      path: pathValue,
      maxLength: numberOrUndefined(original.maxLength),
      startChar: nextStartChar,
    });
  }
  if (
    request.toolName === "read_context_attachment_text" &&
    (attachmentId !== undefined || ref !== undefined) &&
    nextStartChar !== undefined
  ) {
    return compactRecord({
      attachmentId,
      ref,
      path: pathValue,
      maxLength: numberOrUndefined(original.maxLength),
      startChar: nextStartChar,
    });
  }
  const endLine = numberOrUndefined(result.endLine);
  if (!hasMoreAfter || endLine === undefined) {
    return undefined;
  }
  const startLine = endLine + 1;
  if (request.toolName === "read_file" && pathValue !== undefined) {
    return compactRecord({
      path: pathValue,
      startLine,
    });
  }
  if (request.toolName === "read_context_attachment_text" && (attachmentId !== undefined || ref !== undefined)) {
    return compactRecord({
      attachmentId,
      ref,
      path: pathValue,
      startLine,
    });
  }
  return undefined;
}

function readNextStartChar(result: Readonly<Record<string, unknown>>): number | undefined {
  const explicitNextStartChar = numberOrUndefined(result.nextStartChar);
  if (explicitNextStartChar !== undefined) {
    return explicitNextStartChar;
  }
  const content = typeof result.content === "string" ? result.content : undefined;
  const startChar = numberOrUndefined(result.startChar);
  const charCount = numberOrUndefined(result.charCount);
  if (content === undefined || startChar === undefined || charCount === undefined || content.length <= 128_000) {
    return undefined;
  }
  const marker = "\n[truncated to 128000 chars]";
  const visibleChars = Math.max(0, 128_000 - marker.length);
  const nextStartChar = Math.min(charCount, startChar + visibleChars);
  return nextStartChar > startChar && nextStartChar < charCount ? nextStartChar : undefined;
}

function pdfTextContinuation(
  request: ToolCallRequest,
  result: Readonly<Record<string, unknown>>,
  truncated: boolean
): ToolContinuation | undefined {
  if (!shouldContinueWithMore(result, truncated)) {
    return undefined;
  }
  const original = asRecord(request.input);
  const attachmentId = stringOrUndefined(result.attachmentId) ?? stringOrUndefined(original.attachmentId);
  const ref = stringOrUndefined(original.ref);
  const nextStartChar = numberOrUndefined(result.nextStartChar);
  if ((attachmentId === undefined && ref === undefined) || nextStartChar === undefined) {
    return undefined;
  }
  return {
    nextInput: compactRecord({
      attachmentId,
      ref,
      path: stringOrUndefined(result.path) ?? stringOrUndefined(original.path),
      maxLength: numberOrUndefined(original.maxLength),
      startChar: nextStartChar,
    }),
    note: "Continue read_context_attachment_pdf_text with the same attachment/path and next extracted-text character offset.",
  };
}

function skillResourceContinuation(
  request: ToolCallRequest,
  result: Readonly<Record<string, unknown>>,
  truncated: boolean
): ToolContinuation | undefined {
  if (!truncated) {
    return undefined;
  }
  const original = asRecord(request.input);
  const skillId = stringOrUndefined(result.skillId) ?? stringOrUndefined(original.skillId);
  const resourcePath = stringOrUndefined(result.path) ?? stringOrUndefined(original.path);
  const type = stringOrUndefined(result.type) ?? stringOrUndefined(original.type);
  const charCount = positiveInteger(result.charCount);
  if (skillId === undefined || resourcePath === undefined || type === undefined || charCount === undefined) {
    return undefined;
  }
  const currentChars = typeof result.content === "string" ? result.content.length : undefined;
  const previousMaxChars = positiveInteger(original.maxChars);
  const currentWindow = Math.max(currentChars ?? 0, previousMaxChars ?? 0);
  const nextMaxChars = Math.min(charCount, Math.max(1, currentWindow) * 2);
  if (previousMaxChars !== undefined && nextMaxChars <= previousMaxChars) {
    return undefined;
  }
  return {
    nextInput: compactRecord({
      skillId,
      path: resourcePath,
      type,
      maxChars: nextMaxChars,
    }),
    note: "Continue read_skill_resource by requesting a larger bounded resource window.",
  };
}

function directoryContinuation(
  request: ToolCallRequest,
  result: Readonly<Record<string, unknown>>,
  display: ToolDisplayProjection | undefined,
  truncated: boolean
): ToolContinuation | undefined {
  if (!shouldContinueWithMore(result, truncated) || booleanOrUndefined(result.reachedOffsetCeiling) === true) {
    return undefined;
  }
  const nextOffset = numberOrUndefined(result.nextOffset);
  const original = asRecord(request.input);
  const directoryDisplay = display?.kind === "directory_listing" ? display : undefined;
  const pathValue = stringOrUndefined(result.path) ?? stringOrUndefined(original.path) ?? directoryDisplay?.path;
  if (nextOffset === undefined || pathValue === undefined) {
    return undefined;
  }
  return {
    nextInput: compactRecord({
      path: pathValue,
      depth: numberOrUndefined(result.depth) ?? numberOrUndefined(original.depth) ?? directoryDisplay?.depth,
      limit: numberOrUndefined(result.limit) ?? numberOrUndefined(original.limit),
      offset: nextOffset,
    }),
    note: "Continue list_dir with the same path/depth and next offset.",
  };
}

function offsetSearchContinuation(
  request: ToolCallRequest,
  result: Readonly<Record<string, unknown>>,
  truncated: boolean
): ToolContinuation | undefined {
  if (!shouldContinueWithMore(result, truncated) || booleanOrUndefined(result.reachedOffsetCeiling) === true) {
    return undefined;
  }
  const original = asRecord(request.input);
  const query = stringOrUndefined(result.query) ?? stringOrUndefined(original.query);
  const nextOffset = numberOrUndefined(result.nextOffset);
  if (query === undefined || nextOffset === undefined) {
    return undefined;
  }
  return {
    nextInput: compactRecord({
      attachmentId: stringOrUndefined(result.attachmentId) ?? stringOrUndefined(original.attachmentId),
      ref: stringOrUndefined(original.ref),
      query,
      path: stringOrUndefined(result.path) ?? stringOrUndefined(original.path),
      limit: numberOrUndefined(result.limit) ?? numberOrUndefined(original.limit),
      offset: nextOffset,
    }),
    note: `Continue ${request.toolName} with the same query/path and next offset.`,
  };
}

function contextAttachmentListContinuation(
  request: ToolCallRequest,
  result: Readonly<Record<string, unknown>>,
  truncated: boolean
): ToolContinuation | undefined {
  if (!shouldContinueWithMore(result, truncated) || booleanOrUndefined(result.reachedOffsetCeiling) === true) {
    return undefined;
  }
  const original = asRecord(request.input);
  const nextOffset = numberOrUndefined(result.nextOffset);
  const attachmentId = stringOrUndefined(result.attachmentId) ?? stringOrUndefined(original.attachmentId);
  const ref = stringOrUndefined(original.ref);
  if ((attachmentId === undefined && ref === undefined) || nextOffset === undefined) {
    return undefined;
  }
  return {
    nextInput: compactRecord({
      attachmentId,
      ref,
      path: stringOrUndefined(result.path) ?? stringOrUndefined(original.path),
      depth: numberOrUndefined(result.depth) ?? numberOrUndefined(original.depth),
      limit: numberOrUndefined(result.limit) ?? numberOrUndefined(original.limit),
      offset: nextOffset,
    }),
    note: "Continue list_context_attachment_files with the same attachment/path/depth and next offset.",
  };
}

function browserContinuation(
  request: ToolCallRequest,
  result: Readonly<Record<string, unknown>>,
  truncated: boolean
): ToolContinuation | undefined {
  if (!shouldContinueWithMore(result, truncated) || booleanOrUndefined(result.reachedStartCharCeiling) === true) {
    return undefined;
  }
  const original = asRecord(request.input);
  const nextStartChar = numberOrUndefined(result.nextStartChar);
  const url = stringOrUndefined(result.url) ?? stringOrUndefined(original.url);
  if (nextStartChar === undefined || url === undefined) {
    return undefined;
  }
  return {
    nextInput: compactRecord({
      url,
      waitMs: numberOrUndefined(original.waitMs),
      maxTextChars: numberOrUndefined(original.maxTextChars),
      startChar: nextStartChar,
    }),
    note: "Continue browser_snapshot with the same URL and next body-text character offset.",
  };
}

function httpContinuation(
  request: ToolCallRequest,
  result: Readonly<Record<string, unknown>>,
  truncated: boolean
): ToolContinuation | undefined {
  if (!shouldContinueWithMore(result, truncated) || booleanOrUndefined(result.reachedStartCharCeiling) === true) {
    return undefined;
  }
  const original = asRecord(request.input);
  const method = (stringOrUndefined(result.method) ?? stringOrUndefined(original.method) ?? "GET").toUpperCase();
  if (method !== "GET") {
    return undefined;
  }
  const nextStartChar = numberOrUndefined(result.nextStartChar);
  const url = stringOrUndefined(result.url) ?? stringOrUndefined(original.url);
  if (nextStartChar === undefined || url === undefined) {
    return undefined;
  }
  return {
    nextInput: compactRecord({
      url,
      method,
      headers: optionalRecord(original.headers),
      timeoutMs: numberOrUndefined(original.timeoutMs),
      startChar: nextStartChar,
    }),
    note: "Continue http_request with the same GET request and next response-body character offset.",
  };
}

function contextAttachmentTableContinuation(
  request: ToolCallRequest,
  result: Readonly<Record<string, unknown>>,
  truncated: boolean
): ToolContinuation | undefined {
  if (!shouldContinueWithMore(result, truncated) || booleanOrUndefined(result.reachedRowCeiling) === true) {
    return undefined;
  }
  const original = asRecord(request.input);
  const attachmentId = stringOrUndefined(result.attachmentId) ?? stringOrUndefined(original.attachmentId);
  const ref = stringOrUndefined(original.ref);
  const nextStartRow = tableNextStartRow(result);
  const rowCount = positiveInteger(original.rowCount) ??
    positiveInteger(result.rowCount) ??
    positiveInteger(result.requestedRowCount) ??
    positiveInteger(result.rowsReturned);
  if ((attachmentId === undefined && ref === undefined) || nextStartRow === undefined || rowCount === undefined) {
    return undefined;
  }
  return {
    nextInput: compactRecord({
      attachmentId,
      ref,
      path: stringOrUndefined(result.path) ?? stringOrUndefined(original.path),
      sheetName: stringOrUndefined(result.sheetName) ?? stringOrUndefined(original.sheetName),
      sheetIndex: positiveInteger(result.sheetIndex) ?? positiveInteger(original.sheetIndex),
      startRow: nextStartRow,
      rowCount,
      headerRow: booleanOrUndefined(result.headerRow) ?? booleanOrUndefined(original.headerRow),
    }),
    note: "Continue read_context_attachment_table with the same table selection and next row window.",
  };
}

function tableNextStartRow(result: Readonly<Record<string, unknown>>): number | undefined {
  const explicit = positiveInteger(result.nextStartRow);
  if (explicit !== undefined) {
    return explicit;
  }
  if (!Array.isArray(result.rows) || result.rows.length === 0) {
    return undefined;
  }
  const lastRowNumber = result.rows
    .map((row) => positiveInteger(asRecord(row).rowNumber))
    .filter((rowNumber): rowNumber is number => rowNumber !== undefined)
    .at(-1);
  return lastRowNumber === undefined ? undefined : lastRowNumber + 1;
}

function executableContinuation(continuation: ToolContinuation | undefined): ToolContinuation | undefined {
  if (continuation === undefined) {
    return undefined;
  }
  const ref = stringOrUndefined(continuation.ref);
  const nextInput = nonEmptyRecord(continuation.nextInput);
  if (ref === undefined && nextInput === undefined) {
    return undefined;
  }
  return compactRecord({
    ref,
    nextInput,
    note: stringOrUndefined(continuation.note),
  }) as ToolContinuation;
}

function shouldContinueWithMore(result: Readonly<Record<string, unknown>>, truncated: boolean): boolean {
  return truncated || booleanOrUndefined(result.hasMoreAfter) === true;
}

function compactRecord(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      result[key] = item;
    }
  }
  return result;
}

function nonEmptyRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  const record = asRecord(value);
  return Object.keys(record).length === 0 ? undefined : record;
}

function optionalRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  const record = asRecord(value);
  return Object.keys(record).length === 0 ? undefined : record;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  if (value === true) return true;
  if (value === false) return false;
  return undefined;
}
