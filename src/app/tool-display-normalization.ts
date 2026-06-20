import type {
  ToolDisplayProjection,
  ToolErrorFacts,
  ToolFileDisplayOperation,
} from "../domain/tools/index.js";
import { toolDisplayName } from "../domain/tools/index.js";

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
  if (existing !== undefined && !isFileDisplay(existing)) {
    return existing;
  }
  const fileDisplay = fileToolDisplayForOperation(input, existing);
  if (fileDisplay !== undefined) {
    return fileDisplay;
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
  if (path === undefined && !operation.explicit) {
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
  const preview = allowDerivedPreview ? fileEditDiffPreview(inputRecord.edits) : undefined;
  return {
    kind: "file_diff_preview",
    path: existingDiff?.path ?? stringOrUndefined(result.path) ?? stringOrUndefined(outputRecord.path) ?? stringOrUndefined(inputRecord.path),
    operation: existingDiff?.operation ?? operation,
    replacements: existingDiff?.replacements ?? numberOrUndefined(result.replacements) ?? numberOrUndefined(outputRecord.replacements) ?? numberOrUndefined(result.wouldReplace) ?? editCount(inputRecord.edits),
    previousLength: existingDiff?.previousLength ?? numberOrUndefined(result.previousLength) ?? numberOrUndefined(outputRecord.previousLength),
    nextLength: existingDiff?.nextLength ?? numberOrUndefined(result.nextLength) ?? numberOrUndefined(outputRecord.nextLength),
    preview: existingDiff?.preview ?? (allowDerivedPreview ? stringOrUndefined(outputRecord.preview) ?? stringOrUndefined(result.preview) ?? preview?.text : undefined),
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

function fileEditDiffPreview(value: unknown): FilePreviewResult | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const chunks: string[] = [];
  let truncated = value.length > 6;
  for (const item of value.slice(0, 6)) {
    const record = asRecord(item);
    const oldText = stringOrUndefined(record.oldText) ?? stringOrUndefined(record.anchor);
    const replacement = typeof record.newText === "string"
      ? record.newText
      : typeof record.replacement === "string"
        ? record.replacement
        : undefined;
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

function editTargetLabel(record: Readonly<Record<string, unknown>>): string | undefined {
  const occurrence = numberOrUndefined(record.occurrence);
  const start = numberOrUndefined(record.startLine) ?? numberOrUndefined(record.startLineHint);
  const end = numberOrUndefined(record.endLine) ?? numberOrUndefined(record.endLineHint);
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
