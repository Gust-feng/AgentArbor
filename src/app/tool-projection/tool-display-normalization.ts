import type { ToolDisplayProjection } from "../../domain/observation/index.js";
import type { ToolFileDisplayOperation } from "../../domain/tools/index.js";
import { toolDisplayName } from "../../domain/tools/index.js";

export type ToolDisplayNormalizationInput = {
  readonly toolName: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly truncated?: boolean;
};

export function normalizeToolDisplayForOperation(input: ToolDisplayNormalizationInput): ToolDisplayProjection {
  const structuredDisplay = structuredToolDisplayForOperation(input);
  if (structuredDisplay !== undefined) {
    return structuredDisplay;
  }
  const fileGroupDisplay = fileChangeGroupDisplayForOperation(input);
  if (fileGroupDisplay !== undefined) {
    return fileGroupDisplay;
  }
  const fileDisplay = fileToolDisplayForOperation(input);
  if (fileDisplay !== undefined) {
    return fileDisplay;
  }
  return genericToolDisplayForOperation(input);
}

function fileChangeGroupDisplayForOperation(
  input: ToolDisplayNormalizationInput,
): Extract<ToolDisplayProjection, { readonly kind: "file_change_group" }> | undefined {
  const output = asRecord(input.output);
  const candidates = Array.isArray(output.files)
    ? output.files
    : Array.isArray(output.changes)
      ? output.changes
      : undefined;
  if (candidates === undefined || candidates.length < 2) {
    return undefined;
  }
  const files = candidates
    .map(fileChangeGroupItem)
    .filter((item): item is NonNullable<ReturnType<typeof fileChangeGroupItem>> => item !== undefined);
  if (files.length < 2) {
    return undefined;
  }
  return {
    kind: "file_change_group",
    files,
    truncated: booleanOrUndefined(output.truncated) ??
      (input.truncated === true || files.some((file) => file.truncated === true) ? true : undefined),
  };
}

function fileChangeGroupItem(value: unknown): {
  readonly path: string;
  readonly operation?: ToolFileDisplayOperation;
  readonly preview?: string;
  readonly replacements?: number;
  readonly truncated?: boolean;
} | undefined {
  const item = asRecord(value);
  const path = stringOrUndefined(item.path);
  if (path === undefined) {
    return undefined;
  }
  const canonicalDiff = canonicalEditFileDiffPreview(item.diff);
  const preview = canonicalDiff ?? compactDiffPreview(stringOrUndefined(item.preview));
  return {
    path,
    operation: fileDisplayOperationOrUndefined(item.operation) ?? (canonicalDiff === undefined ? undefined : "edit"),
    preview: preview?.text,
    replacements: numberOrUndefined(item.replacements),
    truncated: booleanOrUndefined(item.truncated) ?? (preview?.truncated === true ? true : undefined),
  };
}

function structuredToolDisplayForOperation(input: ToolDisplayNormalizationInput): ToolDisplayProjection | undefined {
  const toolName = input.toolName.trim().toLowerCase();
  const output = asRecord(input.output);
  const inputRecord = asRecord(input.input);
  const truncated = booleanOrUndefined(output.truncated) ??
    (input.truncated === true ? true : undefined);
  if (isDirectoryListingTool(toolName) && Array.isArray(output.entries)) {
    const entries = output.entries
      .map(directoryEntryDisplayItem)
      .filter((item): item is NonNullable<ReturnType<typeof directoryEntryDisplayItem>> => item !== undefined);
    const entriesReturned = numberOrUndefined(output.entriesReturned) ?? entries.length;
    return {
      kind: "directory_listing",
      path: stringOrUndefined(output.path) ?? stringOrUndefined(inputRecord.path),
      depth: numberOrUndefined(output.depth) ?? numberOrUndefined(inputRecord.depth),
      entriesReturned,
      totalEntries: numberOrUndefined(output.totalEntries) ?? (truncated === true ? undefined : entriesReturned),
      unreadableDirectories: numberOrUndefined(output.unreadableDirectories),
      unreadableSamples: Array.isArray(output.unreadableSamples)
        ? output.unreadableSamples
          .map(unreadableDirectorySample)
          .filter((item): item is NonNullable<ReturnType<typeof unreadableDirectorySample>> => item !== undefined)
        : undefined,
      entries,
      truncated,
    };
  }
  if (isFileSearchTool(toolName) && Array.isArray(output.matches)) {
    const matches = output.matches
      .map(fileSearchMatchDisplayItem)
      .filter((item): item is NonNullable<ReturnType<typeof fileSearchMatchDisplayItem>> => item !== undefined);
    return {
      kind: "file_search_results",
      query: stringOrUndefined(output.query) ?? stringOrUndefined(inputRecord.query),
      path: stringOrUndefined(output.path) ?? stringOrUndefined(inputRecord.path),
      engine: stringOrUndefined(output.engine),
      searchedFiles: numberOrUndefined(output.searchedFiles),
      skippedFactsAvailable: booleanOrUndefined(output.skippedFactsAvailable),
      skippedFiles: numberOrUndefined(output.skippedFiles),
      skippedBinaryFiles: numberOrUndefined(output.skippedBinaryFiles),
      skippedTooLargeFiles: numberOrUndefined(output.skippedTooLargeFiles),
      skippedUnreadableFiles: numberOrUndefined(output.skippedUnreadableFiles),
      skippedDirectories: numberOrUndefined(output.skippedDirectories),
      skippedOtherEntries: numberOrUndefined(output.skippedOtherEntries),
      skippedSamples: Array.isArray(output.skippedSamples)
        ? output.skippedSamples
          .map(fileSearchSkippedSample)
          .filter((item): item is NonNullable<ReturnType<typeof fileSearchSkippedSample>> => item !== undefined)
        : undefined,
      matches,
      matchesReturned: numberOrUndefined(output.matchesReturned) ?? matches.length,
      truncated,
    };
  }
  return undefined;
}

function isDirectoryListingTool(toolName: string): boolean {
  return toolName === "list_dir" ||
    toolName === "list_files" ||
    toolName === "list_context_attachment_files" ||
    toolName === "inspect_context_attachment_archive";
}

function isFileSearchTool(toolName: string): boolean {
  return toolName === "grep_files" ||
    toolName === "search_context_attachment_files";
}

function fileToolDisplayForOperation(
  input: ToolDisplayNormalizationInput
): ToolDisplayProjection | undefined {
  const toolName = input.toolName.trim().toLowerCase();
  const inputRecord = asRecord(input.input);
  const outputRecord = asRecord(input.output);
  const operation = fileOperationKind(toolName, inputRecord, outputRecord);
  if (operation === undefined) {
    return undefined;
  }
  const path = stringOrUndefined(outputRecord.path) ??
    stringOrUndefined(inputRecord.path);
  if (path === undefined) {
    return undefined;
  }
  if (operation.kind === "edit") {
    return fileDiffDisplay(input, inputRecord, outputRecord, operation.operation);
  }
  return fileChangeDisplay(input, inputRecord, outputRecord, operation.operation);
}

function fileChangeDisplay(
  input: ToolDisplayNormalizationInput,
  inputRecord: Readonly<Record<string, unknown>>,
  outputRecord: Readonly<Record<string, unknown>>,
  operation: ToolFileDisplayOperation
): ToolDisplayProjection {
  const content = stringOrUndefined(inputRecord.content);
  const append = booleanOrUndefined(outputRecord.append) ?? booleanOrUndefined(inputRecord.append);
  const allowDerivedPreview = isBuiltInFileToolName(input.toolName);
  const preview = operation === "delete" || !allowDerivedPreview
    ? undefined
    : fileWriteDiffPreview({
        content,
        mode: operation === "create" ? "create" : operation === "append" ? "append" : "write",
      });
  return {
    kind: "file_change_summary",
    path: stringOrUndefined(outputRecord.path) ?? stringOrUndefined(inputRecord.path),
    operation,
    bytes: numberOrUndefined(outputRecord.bytes) ?? contentByteLength(content),
    append,
    replacements: numberOrUndefined(outputRecord.replacements),
    previousLength: numberOrUndefined(outputRecord.previousLength),
    nextLength: numberOrUndefined(outputRecord.nextLength) ?? content?.length,
    preview: allowDerivedPreview ? stringOrUndefined(outputRecord.preview) ?? preview?.text : undefined,
    truncated: booleanOrUndefined(outputRecord.truncated) ?? (input.truncated === true || preview?.truncated === true ? true : undefined),
  };
}

function fileDiffDisplay(
  input: ToolDisplayNormalizationInput,
  inputRecord: Readonly<Record<string, unknown>>,
  outputRecord: Readonly<Record<string, unknown>>,
  operation: ToolFileDisplayOperation
): ToolDisplayProjection {
  const preview = canonicalEditFileDiffPreview(outputRecord.diff);
  return {
    kind: "file_diff_preview",
    path: stringOrUndefined(outputRecord.path) ?? stringOrUndefined(inputRecord.path),
    operation,
    replacements: numberOrUndefined(outputRecord.replacements) ?? numberOrUndefined(outputRecord.wouldReplace),
    previousLength: numberOrUndefined(outputRecord.previousLength),
    nextLength: numberOrUndefined(outputRecord.nextLength),
    preview: preview?.text,
    truncated: booleanOrUndefined(outputRecord.truncated) ?? (input.truncated === true || preview?.truncated === true ? true : undefined),
  };
}

function genericToolDisplayForOperation(input: ToolDisplayNormalizationInput): ToolDisplayProjection {
  const output = asRecord(input.output);
  const text = stringOrUndefined(output.text) ?? stringOrUndefined(output.content);
  const items = [
    ...stringArray(output.items),
    ...(text === undefined ? [] : [text]),
    ...mcpContentItems(output.content),
    ...structuredContentItems(output.structuredContent),
  ]
    .map((item) => compactText(item, 500))
    .filter((item): item is string => item !== undefined)
    .slice(0, 8);
  return {
    kind: "generic_tool_summary",
    action: toolDisplayName(input.toolName),
    summary: genericFactSummary(output),
    items: items.length === 0 ? undefined : items,
  };
}

function fileOperationKind(
  toolName: string,
  inputRecord: Readonly<Record<string, unknown>>,
  outputRecord: Readonly<Record<string, unknown>>
): {
  readonly kind: "write" | "edit";
  readonly operation: ToolFileDisplayOperation;
} | undefined {
  const explicitOperation =
    fileDisplayOperationOrUndefined(outputRecord.operation) ??
    fileDisplayOperationOrUndefined(inputRecord.operation);
  if (explicitOperation !== undefined) {
    return {
      kind: explicitOperation === "edit" ? "edit" : "write",
      operation: explicitOperation,
    };
  }
  if (toolName === "edit_file") {
    return { kind: "edit", operation: "edit" };
  }
  if (toolName === "create_file") {
    return { kind: "write", operation: "create" };
  }
  if (toolName === "delete_file") {
    return { kind: "write", operation: "delete" };
  }
  if (toolName === "write_file") {
    return {
      kind: "write",
      operation: booleanOrUndefined(outputRecord.append) ?? booleanOrUndefined(inputRecord.append) ? "append" : "write",
    };
  }
  return undefined;
}

function isBuiltInFileToolName(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  return normalized === "write_file" ||
    normalized === "create_file" ||
    normalized === "delete_file" ||
    normalized === "edit_file";
}

function fileDisplayOperationOrUndefined(value: unknown): ToolFileDisplayOperation | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "create" ||
    normalized === "write" ||
    normalized === "append" ||
    normalized === "edit" ||
    normalized === "delete"
  ) {
    return normalized;
  }
  return undefined;
}

type FilePreviewResult = {
  readonly text: string;
  readonly truncated: boolean;
};

function fileWriteDiffPreview(input: {
  readonly content: string | undefined;
  readonly mode: "create" | "write" | "append";
}): FilePreviewResult | undefined {
  if (input.content === undefined) return undefined;
  return boundedDiffPreview(input.content, "+", input.mode === "append" ? "追加内容" : input.mode === "create" ? "新增内容" : "写入内容");
}

function canonicalEditFileDiffPreview(value: unknown): FilePreviewResult | undefined {
  const diff = asRecord(value);
  if (diff.status !== "available") {
    return undefined;
  }
  const unifiedDiff = stringOrUndefined(diff.unifiedDiff);
  return unifiedDiff === undefined ? undefined : compactDiffText(unifiedDiff, 2_400);
}

function compactDiffPreview(value: string | undefined): FilePreviewResult | undefined {
  return value === undefined ? undefined : compactDiffText(value, 2_400);
}

function boundedDiffPreview(value: string, marker: "+" | "-", fallbackLabel: string): FilePreviewResult | undefined {
  const safe = fileFragment(value, 1_200);
  if (safe.trim().length === 0 && !safe.includes("\n")) {
    return { text: `${marker} ${fallbackLabel}`, truncated: false };
  }
  const lines = safe.replace(/\r\n?/g, "\n").split("\n");
  const visibleLines = lines.slice(0, 14);
  const text = visibleLines.map((line) => `${marker} ${line.length === 0 ? " " : line}`).join("\n");
  const truncated = lines.length > visibleLines.length || safe.length < value.length;
  return { text, truncated };
}

function compactDiffText(value: string, maxLength: number): FilePreviewResult | undefined {
  const text = value.trimEnd();
  if (text.trim().length === 0) return undefined;
  if (text.length <= maxLength) return { text, truncated: false };
  return { text: `${text.slice(0, Math.max(0, maxLength - 15)).trimEnd()}\n... diff truncated`, truncated: true };
}

function fileFragment(value: string, maxLength: number): string {
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ");
  if (text.trim().length === 0 && !text.includes("\n")) {
    return "";
  }
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function mcpContentItems(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .slice(0, 8)
    .map(mcpContentSummary)
    .filter((item): item is string => item !== undefined);
}

function mcpContentSummary(value: unknown): string | undefined {
  const record = asRecord(value);
  const type = stringOrUndefined(record.type);
  if (type === "text") {
    return stringOrUndefined(record.text);
  }
  if (type === "resource_link") {
    return compactText([
      stringOrUndefined(record.title) ?? stringOrUndefined(record.name),
      stringOrUndefined(record.uri),
      stringOrUndefined(record.mimeType),
      numberOrUndefined(record.size) === undefined ? undefined : `${numberOrUndefined(record.size)} bytes`,
    ].filter((item): item is string => item !== undefined).join(" · "), 500);
  }
  if (type === "resource") {
    const resource = asRecord(record.resource);
    const resourceText = stringOrUndefined(resource.text);
    return resourceText ?? compactText([
      stringOrUndefined(resource.uri),
      stringOrUndefined(resource.mimeType),
      numberOrUndefined(resource.byteLength) === undefined ? undefined : `${numberOrUndefined(resource.byteLength)} bytes`,
    ].filter((item): item is string => item !== undefined).join(" · "), 500);
  }
  const mimeType = stringOrUndefined(record.mimeType);
  const byteLength = numberOrUndefined(record.byteLength);
  if (type === undefined) {
    return undefined;
  }
  return [
    `非文本内容：${type}`,
    mimeType === undefined ? undefined : `MIME：${mimeType}`,
    byteLength === undefined ? undefined : `${byteLength} 字节`,
  ].filter((item): item is string => item !== undefined).join("，");
}

function structuredContentItems(value: unknown): readonly string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 8)
      .map(structuredFactText)
      .filter((item): item is string => item !== undefined);
  }
  const item = structuredFactText(value);
  return item === undefined ? [] : [item];
}

function structuredFactText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const record = asRecord(value);
  const parts = uniqueStrings([
    stringOrUndefined(record.title) ?? stringOrUndefined(record.name),
    stringOrUndefined(record.path) ?? stringOrUndefined(record.url) ?? stringOrUndefined(record.uri),
    stringOrUndefined(record.status) ?? stringOrUndefined(record.researchStatus),
    countFact("results", record.resultsReturned, record.results),
    countFact("entries", record.entriesReturned, record.entries),
    countFact("matches", record.matchesReturned, record.matches),
  ]);
  return compactText(parts.join(" · "), 500);
}

function genericFactSummary(output: Readonly<Record<string, unknown>>): string | undefined {
  const parts = uniqueStrings([
    stringOrUndefined(output.title) ?? stringOrUndefined(output.name),
    stringOrUndefined(output.path) ?? stringOrUndefined(output.url) ?? stringOrUndefined(output.uri),
    stringOrUndefined(output.refId) ?? stringOrUndefined(output.ref),
    stringOrUndefined(output.status) ?? stringOrUndefined(output.researchStatus),
    numberOrUndefined(output.statusCode) === undefined ? undefined : `HTTP ${numberOrUndefined(output.statusCode)}`,
    numberOrUndefined(output.bytes) === undefined ? undefined : `${numberOrUndefined(output.bytes)} bytes`,
    countFact("results", output.resultsReturned, output.results),
    countFact("entries", output.entriesReturned, output.entries),
    countFact("matches", output.matchesReturned, output.matches),
    countFact("rows", output.rowsReturned, output.rows),
  ]);
  if (parts.length > 0) {
    return compactText(parts.join(" · "), 500);
  }
  return compactText(stringOrUndefined(output.message), 500);
}

function countFact(label: string, explicitCount: unknown, values: unknown): string | undefined {
  const count = numberOrUndefined(explicitCount) ?? (Array.isArray(values) ? values.length : undefined);
  return count === undefined ? undefined : `${count} ${label}`;
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined))];
}

function directoryEntryDisplayItem(value: unknown): {
  readonly path: string;
  readonly name?: string;
  readonly kind?: string;
  readonly bytes?: number;
  readonly depth?: number;
} | undefined {
  const record = asRecord(value);
  const path = stringOrUndefined(record.path) ?? stringOrUndefined(record.name);
  if (path === undefined) {
    return undefined;
  }
  return {
    path,
    name: stringOrUndefined(record.name),
    kind: stringOrUndefined(record.kind),
    bytes: numberOrUndefined(record.bytes),
    depth: numberOrUndefined(record.depth),
  };
}

function unreadableDirectorySample(value: unknown): {
  readonly path?: string;
  readonly errorCode?: string;
} | undefined {
  const record = asRecord(value);
  const path = stringOrUndefined(record.path);
  const errorCode = stringOrUndefined(record.errorCode);
  if (path === undefined && errorCode === undefined) {
    return undefined;
  }
  return {
    path,
    errorCode,
  };
}

function fileSearchMatchDisplayItem(value: unknown): {
  readonly path: string;
  readonly line?: number;
  readonly preview?: string;
} | undefined {
  const record = asRecord(value);
  const path = stringOrUndefined(record.path);
  if (path === undefined) {
    return undefined;
  }
  return {
    path,
    line: numberOrUndefined(record.line),
    preview: compactText(stringOrUndefined(record.preview), 500),
  };
}

function fileSearchSkippedSample(value: unknown): {
  readonly path?: string;
  readonly reason?: string;
  readonly bytes?: number;
  readonly errorCode?: string;
} | undefined {
  const record = asRecord(value);
  const path = stringOrUndefined(record.path);
  const reason = stringOrUndefined(record.reason);
  const bytes = numberOrUndefined(record.bytes);
  const errorCode = stringOrUndefined(record.errorCode);
  if (path === undefined && reason === undefined && bytes === undefined && errorCode === undefined) {
    return undefined;
  }
  return {
    path,
    reason,
    bytes,
    errorCode,
  };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  if (value === true) return true;
  if (value === false) return false;
  return undefined;
}

function contentByteLength(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Buffer.byteLength(value, "utf8");
}

function compactText(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const text = value.trim();
  if (text.length === 0) {
    return undefined;
  }
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}...`;
}
