import type {
  ToolDisplayProjection,
  ToolErrorFacts,
  ToolFileDisplayOperation,
} from "../../domain/tools/index.js";
import { toolDisplayName } from "../../domain/tools/index.js";

export type ToolDisplayNormalizationInput = {
  readonly toolName: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly existingDisplay?: unknown;
  readonly truncated?: boolean;
};

export function normalizeToolDisplayForOperation(input: ToolDisplayNormalizationInput): ToolDisplayProjection {
  const output = asRecord(input.output);
  const existing = normalizedExistingDisplay(input.toolName, input.existingDisplay ?? output.display);
  if (existing !== undefined && existing.kind !== "generic_tool_summary" && !isFileDisplay(existing)) {
    return existing;
  }
  const fileDisplay = fileToolDisplayForOperation(input, existing);
  if (fileDisplay !== undefined) {
    return fileDisplay;
  }
  const structuredDisplay = structuredToolDisplayForOperation(input);
  if (structuredDisplay !== undefined) {
    return structuredDisplay;
  }
  if (existing !== undefined) {
    return existing;
  }
  return genericToolDisplayForOperation(input);
}

function normalizedExistingDisplay(toolName: string, value: unknown): ToolDisplayProjection | undefined {
  const existing = toolDisplayProjectionOrUndefined(value);
  if (existing?.kind !== "generic_tool_summary") {
    return existing;
  }
  return {
    ...existing,
    action: displayActionForTool(existing.action, toolName),
  };
}

export function toolDisplayProjectionOrUndefined(value: unknown): ToolDisplayProjection | undefined {
  const record = asRecord(value);
  const kind = stringOrUndefined(record.kind);
  if (kind === "search_results") {
    return {
      kind,
      query: stringOrUndefined(record.query),
      status: stringOrUndefined(record.status),
      message: stringOrUndefined(record.message),
      results: Array.isArray(record.results)
        ? record.results.map(searchResultItem).filter((item): item is NonNullable<ReturnType<typeof searchResultItem>> => item !== undefined)
        : [],
      resultsReturned: numberOrUndefined(record.resultsReturned),
      truncated: booleanOrUndefined(record.truncated),
    };
  }
  if (kind === "read_result") {
    return {
      kind,
      ref: stringOrUndefined(record.ref),
      source: stringOrUndefined(record.source),
      status: stringOrUndefined(record.status),
      title: stringOrUndefined(record.title),
      url: stringOrUndefined(record.url),
      uri: stringOrUndefined(record.uri),
      sourceSearchRef: stringOrUndefined(record.sourceSearchRef),
      contentPreview: stringOrUndefined(record.contentPreview),
      summary: stringOrUndefined(record.summary),
      preview: stringOrUndefined(record.preview),
      error: stringOrUndefined(record.error),
      errorFacts: errorFactsOrUndefined(record.errorFacts),
      truncated: booleanOrUndefined(record.truncated),
    };
  }
  if (kind === "directory_listing") {
    return {
      kind,
      path: stringOrUndefined(record.path),
      depth: numberOrUndefined(record.depth),
      entriesReturned: numberOrUndefined(record.entriesReturned),
      totalEntries: numberOrUndefined(record.totalEntries),
      unreadableDirectories: numberOrUndefined(record.unreadableDirectories),
      unreadableSamples: Array.isArray(record.unreadableSamples)
        ? record.unreadableSamples
          .map(unreadableDirectorySample)
          .filter((item): item is NonNullable<ReturnType<typeof unreadableDirectorySample>> => item !== undefined)
        : undefined,
      entries: Array.isArray(record.entries)
        ? record.entries
          .map(directoryEntryDisplayItem)
          .filter((item): item is NonNullable<ReturnType<typeof directoryEntryDisplayItem>> => item !== undefined)
        : [],
      truncated: booleanOrUndefined(record.truncated),
    };
  }
  if (kind === "file_search_results") {
    return {
      kind,
      query: stringOrUndefined(record.query),
      path: stringOrUndefined(record.path),
      engine: stringOrUndefined(record.engine),
      searchedFiles: numberOrUndefined(record.searchedFiles),
      skippedFactsAvailable: booleanOrUndefined(record.skippedFactsAvailable),
      skippedFiles: numberOrUndefined(record.skippedFiles),
      skippedBinaryFiles: numberOrUndefined(record.skippedBinaryFiles),
      skippedTooLargeFiles: numberOrUndefined(record.skippedTooLargeFiles),
      skippedUnreadableFiles: numberOrUndefined(record.skippedUnreadableFiles),
      skippedDirectories: numberOrUndefined(record.skippedDirectories),
      skippedOtherEntries: numberOrUndefined(record.skippedOtherEntries),
      skippedSamples: Array.isArray(record.skippedSamples)
        ? record.skippedSamples
          .map(fileSearchSkippedSample)
          .filter((item): item is NonNullable<ReturnType<typeof fileSearchSkippedSample>> => item !== undefined)
        : undefined,
      matches: Array.isArray(record.matches)
        ? record.matches
          .map(fileSearchMatchDisplayItem)
          .filter((item): item is NonNullable<ReturnType<typeof fileSearchMatchDisplayItem>> => item !== undefined)
        : [],
      matchesReturned: numberOrUndefined(record.matchesReturned),
      truncated: booleanOrUndefined(record.truncated),
    };
  }
  if (kind === "browser_snapshot") {
    return {
      kind,
      title: stringOrUndefined(record.title),
      url: stringOrUndefined(record.url),
      text: stringOrUndefined(record.text),
      truncated: booleanOrUndefined(record.truncated),
    };
  }
  if (kind === "http_response") {
    return {
      kind,
      method: stringOrUndefined(record.method),
      url: stringOrUndefined(record.url),
      statusCode: numberOrUndefined(record.statusCode),
      statusText: stringOrUndefined(record.statusText),
      durationMs: numberOrUndefined(record.durationMs),
      bodyPreview: stringOrUndefined(record.bodyPreview),
      truncated: booleanOrUndefined(record.truncated),
    };
  }
  if (kind === "file_change_summary") {
    return {
      kind,
      path: stringOrUndefined(record.path),
      operation: fileDisplayOperationOrUndefined(record.operation),
      bytes: numberOrUndefined(record.bytes),
      append: booleanOrUndefined(record.append),
      replacements: numberOrUndefined(record.replacements),
      previousLength: numberOrUndefined(record.previousLength),
      nextLength: numberOrUndefined(record.nextLength),
      preview: stringOrUndefined(record.preview),
      truncated: booleanOrUndefined(record.truncated),
    };
  }
  if (kind === "file_diff_preview") {
    return {
      kind,
      path: stringOrUndefined(record.path),
      operation: fileDisplayOperationOrUndefined(record.operation),
      replacements: numberOrUndefined(record.replacements),
      previousLength: numberOrUndefined(record.previousLength),
      nextLength: numberOrUndefined(record.nextLength),
      preview: stringOrUndefined(record.preview),
      truncated: booleanOrUndefined(record.truncated),
    };
  }
  if (kind === "command_summary") {
    return value as ToolDisplayProjection;
  }
  if (kind === "generic_tool_summary") {
    return {
      kind,
      action: stringOrUndefined(record.action),
      summary: stringOrUndefined(record.summary),
      items: stringArray(record.items).length === 0 ? undefined : stringArray(record.items),
    };
  }
  return undefined;
}

function structuredToolDisplayForOperation(input: ToolDisplayNormalizationInput): ToolDisplayProjection | undefined {
  const toolName = input.toolName.trim().toLowerCase();
  const output = asRecord(input.output);
  const result = asRecord(output.result);
  const truncated = booleanOrUndefined(result.truncated) ??
    booleanOrUndefined(output.truncated) ??
    (input.truncated === true ? true : undefined);
  if (isDirectoryListingTool(toolName, output) && Array.isArray(result.entries)) {
    const entries = result.entries
      .map(directoryEntryDisplayItem)
      .filter((item): item is NonNullable<ReturnType<typeof directoryEntryDisplayItem>> => item !== undefined);
    const entriesReturned = numberOrUndefined(result.entriesReturned) ?? entries.length;
    return {
      kind: "directory_listing",
      path: stringOrUndefined(result.path) ?? stringOrUndefined(asRecord(input.input).path),
      depth: numberOrUndefined(result.depth) ?? numberOrUndefined(asRecord(input.input).depth),
      entriesReturned,
      totalEntries: numberOrUndefined(result.totalEntries) ?? (truncated === true ? undefined : entriesReturned),
      unreadableDirectories: numberOrUndefined(result.unreadableDirectories),
      unreadableSamples: Array.isArray(result.unreadableSamples)
        ? result.unreadableSamples
          .map(unreadableDirectorySample)
          .filter((item): item is NonNullable<ReturnType<typeof unreadableDirectorySample>> => item !== undefined)
        : undefined,
      entries,
      truncated,
    };
  }
  if (isFileSearchTool(toolName, output) && Array.isArray(result.matches)) {
    const matches = result.matches
      .map(fileSearchMatchDisplayItem)
      .filter((item): item is NonNullable<ReturnType<typeof fileSearchMatchDisplayItem>> => item !== undefined);
    return {
      kind: "file_search_results",
      query: stringOrUndefined(result.query) ?? stringOrUndefined(asRecord(input.input).query),
      path: stringOrUndefined(result.path) ?? stringOrUndefined(asRecord(input.input).path),
      engine: stringOrUndefined(result.engine),
      searchedFiles: numberOrUndefined(result.searchedFiles),
      skippedFactsAvailable: booleanOrUndefined(result.skippedFactsAvailable),
      skippedFiles: numberOrUndefined(result.skippedFiles),
      skippedBinaryFiles: numberOrUndefined(result.skippedBinaryFiles),
      skippedTooLargeFiles: numberOrUndefined(result.skippedTooLargeFiles),
      skippedUnreadableFiles: numberOrUndefined(result.skippedUnreadableFiles),
      skippedDirectories: numberOrUndefined(result.skippedDirectories),
      skippedOtherEntries: numberOrUndefined(result.skippedOtherEntries),
      skippedSamples: Array.isArray(result.skippedSamples)
        ? result.skippedSamples
          .map(fileSearchSkippedSample)
          .filter((item): item is NonNullable<ReturnType<typeof fileSearchSkippedSample>> => item !== undefined)
        : undefined,
      matches,
      matchesReturned: numberOrUndefined(result.matchesReturned) ?? matches.length,
      truncated,
    };
  }
  return undefined;
}

function isDirectoryListingTool(toolName: string, output: Readonly<Record<string, unknown>>): boolean {
  const action = stringOrUndefined(output.action)?.toLowerCase();
  return toolName === "list_dir" ||
    toolName === "list_files" ||
    toolName === "list_context_attachment_files" ||
    action === "list_dir" ||
    action === "list_files" ||
    action === "list_context_attachment_files";
}

function isFileSearchTool(toolName: string, output: Readonly<Record<string, unknown>>): boolean {
  const action = stringOrUndefined(output.action)?.toLowerCase();
  return toolName === "grep_files" ||
    toolName === "search_context_attachment_files" ||
    action === "grep_files" ||
    action === "search_context_attachment_files";
}

function fileToolDisplayForOperation(
  input: ToolDisplayNormalizationInput,
  existing: ToolDisplayProjection | undefined
): ToolDisplayProjection | undefined {
  const toolName = input.toolName.trim().toLowerCase();
  const inputRecord = asRecord(input.input);
  const outputRecord = asRecord(input.output);
  const result = asRecord(outputRecord.result);
  const action = (stringOrUndefined(outputRecord.action) ?? "").trim().toLowerCase();
  const operation = fileOperationKind(toolName, action, inputRecord, outputRecord, result, existing);
  if (operation === undefined) {
    return undefined;
  }
  const path = stringOrUndefined(result.path) ??
    stringOrUndefined(outputRecord.path) ??
    stringOrUndefined(inputRecord.path);
  const existingPath = existing?.kind === "file_change_summary" || existing?.kind === "file_diff_preview"
    ? existing.path
    : undefined;
  if (path === undefined && existingPath === undefined) {
    return undefined;
  }
  if (operation.kind === "edit") {
    return fileDiffDisplay(input, inputRecord, outputRecord, result, existing, operation.operation);
  }
  return fileChangeDisplay(input, inputRecord, outputRecord, result, existing, operation.operation);
}

function fileChangeDisplay(
  input: ToolDisplayNormalizationInput,
  inputRecord: Readonly<Record<string, unknown>>,
  outputRecord: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
  existing: ToolDisplayProjection | undefined,
  operation: ToolFileDisplayOperation
): ToolDisplayProjection {
  const existingChange = existing?.kind === "file_change_summary" ? existing : undefined;
  const content = stringOrUndefined(inputRecord.content);
  const append = booleanOrUndefined(result.append) ?? booleanOrUndefined(outputRecord.append) ?? booleanOrUndefined(inputRecord.append);
  const allowDerivedPreview = isBuiltInFileToolName(input.toolName);
  const preview = operation === "delete" || !allowDerivedPreview
    ? undefined
    : fileWriteDiffPreview({
        content,
        mode: operation === "create" ? "create" : operation === "append" ? "append" : "write",
      });
  return {
    kind: "file_change_summary",
    path: existingChange?.path ?? stringOrUndefined(result.path) ?? stringOrUndefined(outputRecord.path) ?? stringOrUndefined(inputRecord.path),
    operation: existingChange?.operation ?? operation,
    bytes: existingChange?.bytes ?? numberOrUndefined(result.bytes) ?? numberOrUndefined(outputRecord.bytes) ?? contentByteLength(content),
    append: existingChange?.append ?? append,
    replacements: existingChange?.replacements ?? numberOrUndefined(result.replacements) ?? numberOrUndefined(outputRecord.replacements),
    previousLength: existingChange?.previousLength ?? numberOrUndefined(result.previousLength) ?? numberOrUndefined(outputRecord.previousLength),
    nextLength: existingChange?.nextLength ?? numberOrUndefined(result.nextLength) ?? numberOrUndefined(outputRecord.nextLength) ?? content?.length,
    preview: existingChange?.preview ?? (allowDerivedPreview ? stringOrUndefined(outputRecord.preview) ?? stringOrUndefined(result.preview) ?? preview?.text : undefined),
    truncated: existingChange?.truncated ?? booleanOrUndefined(result.truncated) ?? booleanOrUndefined(outputRecord.truncated) ?? (input.truncated === true || preview?.truncated === true ? true : undefined),
  };
}

function fileDiffDisplay(
  input: ToolDisplayNormalizationInput,
  inputRecord: Readonly<Record<string, unknown>>,
  outputRecord: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
  existing: ToolDisplayProjection | undefined,
  operation: ToolFileDisplayOperation
): ToolDisplayProjection {
  const existingDiff = existing?.kind === "file_diff_preview" ? existing : undefined;
  const allowDerivedPreview = isBuiltInFileToolName(input.toolName);
  const preview = allowDerivedPreview
    ? fileEditDiffPreview(inputRecord) ?? directDiffPreview(outputRecord) ?? directDiffPreview(result) ?? diffSummaryPreview(result.diffSummary)
    : directDiffPreview(outputRecord) ?? directDiffPreview(result) ?? diffSummaryPreview(result.diffSummary);
  return {
    kind: "file_diff_preview",
    path: existingDiff?.path ?? stringOrUndefined(result.path) ?? stringOrUndefined(outputRecord.path) ?? stringOrUndefined(inputRecord.path),
    operation: existingDiff?.operation ?? operation,
    replacements: existingDiff?.replacements ?? numberOrUndefined(result.replacements) ?? numberOrUndefined(outputRecord.replacements) ?? numberOrUndefined(result.wouldReplace) ?? editCount(inputRecord.edits),
    previousLength: existingDiff?.previousLength ?? numberOrUndefined(result.previousLength) ?? numberOrUndefined(outputRecord.previousLength),
    nextLength: existingDiff?.nextLength ?? numberOrUndefined(result.nextLength) ?? numberOrUndefined(outputRecord.nextLength),
    preview: existingDiff?.preview ?? preview?.text,
    truncated: existingDiff?.truncated ?? booleanOrUndefined(result.truncated) ?? booleanOrUndefined(outputRecord.truncated) ?? (input.truncated === true || preview?.truncated === true ? true : undefined),
  };
}

function genericToolDisplayForOperation(input: ToolDisplayNormalizationInput): ToolDisplayProjection {
  const output = asRecord(input.output);
  const result = asRecord(output.result);
  const action = displayActionForTool(stringOrUndefined(output.action), input.toolName);
  const text = stringOrUndefined(result.text) ?? stringOrUndefined(output.text);
  const items = [
    ...stringArray(output.items),
    ...stringArray(result.items),
    ...(text === undefined ? [] : [text]),
    ...mcpMultimodalItems(result.multimodal),
  ]
    .map((item) => compactText(item, 500))
    .filter((item): item is string => item !== undefined)
    .slice(0, 8);
  return {
    kind: "generic_tool_summary",
    action,
    summary: compactText(stringOrUndefined(output.summary) ?? stringOrUndefined(result.summary) ?? text, 500),
    items: items.length === 0 ? undefined : items,
  };
}

function fileOperationKind(
  toolName: string,
  action: string,
  inputRecord: Readonly<Record<string, unknown>>,
  outputRecord: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
  existing: ToolDisplayProjection | undefined
): {
  readonly kind: "write" | "edit";
  readonly operation: ToolFileDisplayOperation;
  readonly explicit: boolean;
} | undefined {
  const explicitOperation =
    fileDisplayOperationOrUndefined(result.operation) ??
    fileDisplayOperationOrUndefined(outputRecord.operation) ??
    fileDisplayOperationOrUndefined(inputRecord.operation);
  if (explicitOperation !== undefined) {
    return {
      kind: explicitOperation === "edit" ? "edit" : "write",
      operation: explicitOperation,
      explicit: true,
    };
  }
  if (existing !== undefined && isFileDisplay(existing) && existing.operation !== undefined) {
    return {
      kind: existing.kind === "file_diff_preview" || existing.operation === "edit" ? "edit" : "write",
      operation: existing.operation,
      explicit: true,
    };
  }
  const marker = `${toolName} ${action}`;
  const hasPath = stringOrUndefined(result.path) !== undefined ||
    stringOrUndefined(outputRecord.path) !== undefined ||
    stringOrUndefined(inputRecord.path) !== undefined;
  if (toolName === "edit_file" || marker.includes("edit_file")) {
    return { kind: "edit", operation: "edit", explicit: true };
  }
  if (toolName === "create_file" || marker.includes("create_file") || marker.includes("创建文件")) {
    return { kind: "write", operation: "create", explicit: true };
  }
  if (toolName === "delete_file" || marker.includes("delete_file") || marker.includes("remove_file") || marker.includes("删除文件")) {
    return { kind: "write", operation: "delete", explicit: true };
  }
  if (
    toolName === "write_file" ||
    marker.includes("write_file") ||
    marker.includes("写入文件")
  ) {
    return {
      kind: "write",
      operation: booleanOrUndefined(result.append) ?? booleanOrUndefined(outputRecord.append) ?? booleanOrUndefined(inputRecord.append) ? "append" : "write",
      explicit: true,
    };
  }
  if ((marker.includes("create") || marker.includes("创建")) && marker.includes("file")) {
    return { kind: "write", operation: "create", explicit: false };
  }
  if ((marker.includes("delete") || marker.includes("remove") || marker.includes("删除")) && marker.includes("file")) {
    return { kind: "write", operation: "delete", explicit: false };
  }
  if ((marker.includes("write") || marker.includes("写入")) && marker.includes("file")) {
    return {
      kind: "write",
      operation: booleanOrUndefined(result.append) ?? booleanOrUndefined(outputRecord.append) ?? booleanOrUndefined(inputRecord.append) ? "append" : "write",
      explicit: false,
    };
  }
  if (hasPath && (action === "create" || action === "created")) {
    return { kind: "write", operation: "create", explicit: false };
  }
  if (hasPath && (action === "delete" || action === "deleted" || action === "remove" || action === "removed")) {
    return { kind: "write", operation: "delete", explicit: false };
  }
  if (hasPath && (action === "append" || action === "appended")) {
    return { kind: "write", operation: "append", explicit: false };
  }
  if (hasPath && (action === "write" || action === "written")) {
    return { kind: "write", operation: "write", explicit: false };
  }
  if (hasPath && (action === "edit" || action === "edited" || action === "patch" || action === "patched" || action === "replace" || action === "replaced")) {
    return { kind: "edit", operation: "edit", explicit: false };
  }
  if (
    ((marker.includes("edit") || marker.includes("patch") || marker.includes("replace")) && marker.includes("file")) ||
    marker.includes("编辑文件") ||
    marker.includes("修改文件")
  ) {
    return { kind: "edit", operation: "edit", explicit: false };
  }
  return undefined;
}

function isFileDisplay(
  display: ToolDisplayProjection
): display is Extract<ToolDisplayProjection, { readonly kind: "file_change_summary" | "file_diff_preview" }> {
  return display.kind === "file_change_summary" || display.kind === "file_diff_preview";
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
  if (normalized === "created") return "create";
  if (normalized === "written" || normalized === "overwrite" || normalized === "overwritten") return "write";
  if (normalized === "appended") return "append";
  if (normalized === "edited" || normalized === "patch" || normalized === "patched" || normalized === "replace" || normalized === "replaced") return "edit";
  if (normalized === "deleted" || normalized === "remove" || normalized === "removed") return "delete";
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

function fileEditDiffPreview(inputRecord: Readonly<Record<string, unknown>>): FilePreviewResult | undefined {
  const edits = normalizedEditPreviewRecords(inputRecord);
  if (edits.length === 0) return undefined;
  const chunks: string[] = [];
  let truncated = edits.length > 6;
  for (const record of edits.slice(0, 6)) {
    const oldText = editBeforeText(record);
    const replacement = editAfterText(record);
    if (oldText === undefined && replacement === undefined) continue;
    const hint = editTargetLabel(record);
    if (hint !== undefined) chunks.push(`@@ ${hint}`);
    const before = boundedDiffPreview(oldText ?? "", "-", "原内容");
    const after = boundedDiffPreview(replacement ?? "", "+", "新内容");
    if (before !== undefined) {
      chunks.push(before.text);
      truncated = truncated || before.truncated;
    }
    if (after !== undefined) {
      chunks.push(after.text);
      truncated = truncated || after.truncated;
    }
  }
  const joined = chunks.join("\n");
  const compacted = compactDiffText(joined, 2_400);
  if (compacted === undefined) return undefined;
  return { text: compacted.text, truncated: truncated || compacted.truncated };
}

function normalizedEditPreviewRecords(
  inputRecord: Readonly<Record<string, unknown>>
): readonly Readonly<Record<string, unknown>>[] {
  const edits = Array.isArray(inputRecord.edits) ? inputRecord.edits.map(asRecord) : [];
  if (edits.length > 0) {
    return edits;
  }
  if (topLevelEditBeforeText(inputRecord) !== undefined || topLevelEditAfterText(inputRecord) !== undefined) {
    return [inputRecord];
  }
  return [];
}

function editBeforeText(record: Readonly<Record<string, unknown>>): string | undefined {
  return stringOrUndefined(record.oldText) ??
    stringOrUndefined(record.oldString) ??
    stringOrUndefined(record.old_text) ??
    stringOrUndefined(record.before) ??
    stringOrUndefined(record.anchor);
}

function editAfterText(record: Readonly<Record<string, unknown>>): string | undefined {
  return stringOrUndefined(record.newText) ??
    stringOrUndefined(record.newString) ??
    stringOrUndefined(record.new_text) ??
    stringOrUndefined(record.after) ??
    stringOrUndefined(record.replacement);
}

function topLevelEditBeforeText(record: Readonly<Record<string, unknown>>): string | undefined {
  return stringOrUndefined(record.oldString) ??
    stringOrUndefined(record.old_string) ??
    stringOrUndefined(record.before) ??
    stringOrUndefined(record.anchor);
}

function topLevelEditAfterText(record: Readonly<Record<string, unknown>>): string | undefined {
  return stringOrUndefined(record.newString) ??
    stringOrUndefined(record.new_string) ??
    stringOrUndefined(record.after) ??
    stringOrUndefined(record.replacement);
}

function directDiffPreview(record: Readonly<Record<string, unknown>>): FilePreviewResult | undefined {
  const value = [
    stringOrUndefined(record.preview),
    stringOrUndefined(record.diff),
    stringOrUndefined(record.patch),
    stringOrUndefined(record.unifiedDiff),
    stringOrUndefined(record.unified_diff),
  ].find((item): item is string => item !== undefined && looksLikeDiffText(item));
  if (value === undefined) {
    return undefined;
  }
  return compactDiffText(value, 2_400);
}

function looksLikeDiffText(value: string): boolean {
  return value
    .split(/\r?\n/)
    .some((line) => line.startsWith("@@") || line.startsWith("+") || line.startsWith("-") || line.startsWith("diff --git"));
}

function diffSummaryPreview(value: unknown): FilePreviewResult | undefined {
  const lines = stringArray(value)
    .map(diffSummaryLinePreview)
    .filter((line): line is string => line !== undefined);
  if (lines.length === 0) {
    return undefined;
  }
  const compacted = compactDiffText(lines.join("\n"), 2_400);
  return compacted === undefined ? undefined : { ...compacted, truncated: compacted.truncated || lines.length > 12 };
}

function diffSummaryLinePreview(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const arrow = /^(.*?)(?:\s*->\s*| → )(.*)$/u.exec(trimmed);
  if (arrow === null) {
    return `@@ ${trimmed}`;
  }
  const before = arrow[1]?.replace(/^line\s+\d+:\s*/iu, "").trim();
  const after = arrow[2]?.trim();
  return [
    `@@ ${trimmed.match(/^line\s+\d+/iu)?.[0] ?? "change"}`,
    before === undefined || before.length === 0 ? undefined : `- ${before}`,
    after === undefined || after.length === 0 ? undefined : `+ ${after}`,
  ].filter((line): line is string => line !== undefined).join("\n");
}

function editTargetLabel(record: Readonly<Record<string, unknown>>): string | undefined {
  const occurrence = numberOrUndefined(record.occurrence);
  const start = numberOrUndefined(record.startLine) ??
    numberOrUndefined(record.startLineHint) ??
    numberOrUndefined(record.start_line);
  const end = numberOrUndefined(record.endLine) ??
    numberOrUndefined(record.endLineHint) ??
    numberOrUndefined(record.end_line);
  const parts: string[] = [];
  if (occurrence !== undefined) {
    parts.push(`occurrence ${occurrence}`);
  }
  if (start !== undefined || end !== undefined) {
    parts.push(`line ${start ?? "?"}${end !== undefined && end !== start ? `-${end}` : ""}`);
  }
  return parts.length === 0 ? undefined : parts.join(" · ");
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

function mcpMultimodalItems(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .slice(0, 6)
    .map(mcpMultimodalSummary)
    .filter((item): item is string => item !== undefined);
}

function mcpMultimodalSummary(value: unknown): string | undefined {
  const record = asRecord(value);
  const type = stringOrUndefined(record.type);
  const mimeType = stringOrUndefined(record.mimeType);
  const bytesApprox = numberOrUndefined(record.bytesApprox);
  if (type === undefined) {
    return undefined;
  }
  return [
    `非文本内容：${type}`,
    mimeType === undefined ? undefined : `MIME：${mimeType}`,
    bytesApprox === undefined ? undefined : `约 ${bytesApprox} 字节`,
  ].filter((item): item is string => item !== undefined).join("，");
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

function searchResultItem(value: unknown): { readonly title: string; readonly url?: string; readonly refId?: string; readonly source?: string; readonly snippet?: string } | undefined {
  const record = asRecord(value);
  const title = stringOrUndefined(record.title);
  if (title === undefined) return undefined;
  return {
    title,
    url: stringOrUndefined(record.url),
    refId: stringOrUndefined(record.refId),
    source: stringOrUndefined(record.source),
    snippet: stringOrUndefined(record.snippet),
  };
}

function displayActionForTool(action: string | undefined, toolName: string): string {
  if (action === undefined || action === toolName || /^[a-z][a-z0-9_:-]*$/i.test(action)) {
    return toolDisplayName(action ?? toolName);
  }
  return action;
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

function errorFactsOrUndefined(value: unknown): ToolErrorFacts | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as ToolErrorFacts
    : undefined;
}

function contentByteLength(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Buffer.byteLength(value, "utf8");
}

function editCount(value: unknown): number | undefined {
  return Array.isArray(value) && value.length > 0 ? value.length : undefined;
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
