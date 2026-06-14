import type { ModelFailure } from "../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolDisplayProjection,
  ToolSafeProjection,
} from "../domain/tools/index.js";
import { toolDisplayName } from "../domain/tools/index.js";
import {
  projectToolResultEnvelope as projectKernelToolResultEnvelope,
  projectToolStatusEnvelope,
} from "../kernel/tools/index.js";
import { commandProgramFromToolResult, commandTextFromToolResult } from "./command-text.js";
import { sanitizeAssistantVisibleText } from "./visible-text-safety.js";
import { cleanOrdinaryToolText } from "./ordinary-tool-copy.js";

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

function redactOrdinaryFileFragment(value: string, maxLength = 1_200): string {
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ");
  if (text.trim().length === 0 && !text.includes("\n")) {
    return "";
  }
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
}): ToolSafeProjection {
  const diagnosticRef = input.diagnosticRef ?? `tool:${input.request.callId}:failed`;
  return {
    uiSummary: redactOrdinaryText(input.error, 500),
    diagnosticRef,
    envelope: projectToolStatusEnvelope({
      request: input.request,
      status: "failed",
      summary: input.error,
      diagnosticRef,
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
      results: record.results.slice(0, 8).map(searchDisplayItem).filter((item): item is NonNullable<ReturnType<typeof searchDisplayItem>> => item !== undefined),
      truncated: record.results.length > 8 || record.truncated === true,
    };
  }
  if (request.toolName === "read") {
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
  if (record.result !== undefined && isMcpToolName(request.toolName)) {
    const text = stringOrUndefined(result.text);
    const multimodal = Array.isArray(result.multimodal)
      ? result.multimodal
          .slice(0, 6)
          .map(mcpMultimodalSummary)
          .filter((item): item is string => item !== undefined)
      : [];
    return {
      kind: "generic_tool_summary",
      action,
      summary: summary ?? compactSafeText(text, 500),
      items: [
        ...(text === undefined ? [] : [text]),
        ...multimodal,
      ].map((item) => redactOrdinaryText(item, 500)).slice(0, 8),
    };
  }
  if (request.toolName === "write_file" || request.toolName === "create_file" || request.toolName === "delete_file") {
    const input = asRecord(request.input);
    const preview = request.toolName === "delete_file" ? undefined : fileWriteDiffPreview({
      content: stringOrUndefined(input.content),
      mode: request.toolName === "create_file" ? "create" : result.append === true ? "append" : "write",
    });
    return {
      kind: "file_change_summary",
      path: stringOrUndefined(result.path) ?? stringOrUndefined(asRecord(request.input).path),
      bytes: numberOrUndefined(result.bytes),
      append: result.append === true,
      preview: preview?.text,
      truncated: record.truncated === true || preview?.truncated === true,
    };
  }
  if (request.toolName === "edit_file") {
    const input = asRecord(request.input);
    const preview = fileEditDiffPreview(input.edits);
    return {
      kind: "file_diff_preview",
      path: stringOrUndefined(result.path) ?? stringOrUndefined(input.path),
      replacements: numberOrUndefined(result.replacements),
      previousLength: numberOrUndefined(result.previousLength),
      nextLength: numberOrUndefined(result.nextLength),
      preview: preview?.text,
      truncated: record.truncated === true || preview?.truncated === true,
    };
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
      logPath: stringOrUndefined(result.logPath),
      stopCommand: stringOrUndefined(result.stopCommand),
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
        return [stringOrUndefined(item.kind), stringOrUndefined(item.name)].filter(isString).join(" ");
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
  return {
    kind: "generic_tool_summary",
    action,
    summary,
  };
}

function projectToolAgentContent(request: ToolCallRequest, output: unknown, truncated: boolean): unknown {
  const record = asRecord(output);
  const result = asRecord(record.result);
  const summary = stringOrUndefined(record.summary);
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
  if (request.toolName === "list_dir") {
    return {
      summary,
      path: stringOrUndefined(result.path),
      entries: Array.isArray(result.entries) ? result.entries.slice(0, 200).map(projectDirectoryEntry) : undefined,
      totalEntries: numberOrUndefined(result.totalEntries),
      truncated,
    };
  }
  if (request.toolName === "grep_files") {
    return {
      summary,
      query: stringOrUndefined(result.query),
      path: stringOrUndefined(result.path),
      matches: Array.isArray(result.matches) ? result.matches.slice(0, 80).map(projectGrepMatch) : undefined,
      truncated,
    };
  }
  if (request.toolName === "read") {
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
      truncated: result.truncated === true || truncated || contentPreview?.truncated === true,
      contentPreview: contentPreview?.text,
      rawContentPreviewRef: contentPreview?.rawRef,
      metadata: asRecord(result.metadata),
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
      logPath: stringOrUndefined(result.logPath),
      stopCommand: stringOrUndefined(result.stopCommand),
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

function projectDirectoryEntry(value: unknown): { readonly name?: string; readonly kind?: string; readonly bytes?: number } {
  const record = asRecord(value);
  return {
    name: stringOrUndefined(record.name),
    kind: stringOrUndefined(record.kind),
    bytes: numberOrUndefined(record.bytes),
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
  const safe = redactOrdinaryFileFragment(value, 1_200);
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

function displayActionForTool(action: string | undefined, toolName: string): string {
  if (action === undefined || action === toolName || /^[a-z][a-z0-9_:-]*$/i.test(action)) {
    return toolDisplayName(action ?? toolName);
  }
  return action;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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
  ].filter(isString).join("，");
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
