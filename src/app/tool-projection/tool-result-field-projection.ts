import type { ToolCallRequest } from "../../domain/tools/index.js";
import {
  asRecord,
  booleanOrUndefined,
  numberOrUndefined,
  stringArray,
  stringOrUndefined,
  stringRecordOrUndefined,
} from "./tool-result-facts.js";

export const MODEL_TOOL_TEXT_MAX_CHARS = 128_000;
export const MODEL_TOOL_ERROR_MAX_CHARS = 64_000;
export const FILE_SEARCH_MODEL_MATCHES_LIMIT = 80;

export type ModelVisibleTextFragment = {
  readonly text: string;
  readonly truncated: boolean;
  readonly rawRef?: string;
};

/**
 * Clips a model-visible text field only when necessary and preserves a stable
 * reference for a tool that can continue reading the original result.
 */
export function modelVisibleTextFragment(input: {
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

export function projectDirectoryEntry(value: unknown): {
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

export function projectArchiveEntry(value: unknown): {
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

export function projectContextAttachment(value: unknown): {
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

export function projectTableRow(value: unknown): {
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

export function projectGrepMatch(value: unknown): { readonly path?: string; readonly line?: number; readonly preview?: string } {
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

export function projectUnreadableDirectorySample(value: unknown): {
  readonly path?: string;
  readonly errorCode?: string;
} {
  const record = asRecord(value);
  return {
    path: stringOrUndefined(record.path),
    errorCode: stringOrUndefined(record.errorCode),
  };
}

export function projectGrepSkippedSample(value: unknown): {
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

function rawToolFieldRef(request: ToolCallRequest, field: string): string {
  return `tool:${request.callId}:raw:${request.toolName}:${field}`;
}
