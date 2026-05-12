import type { ModelFailure } from "../../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDisplayProjection,
  ToolSafeProjection,
} from "../../domain/tools/index.js";
import { redactSensitiveText } from "../../kernel/redaction.js";
import { sanitizeAssistantVisibleText } from "../visible-text-safety.js";

export function redactOrdinaryText(value: string, maxLength = 1_200): string {
  return compactSafeText(sanitizeAssistantVisibleText(redactSensitiveText(value)), maxLength) ?? "";
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
  return {
    agentContent: projectAgentToolContent(input.output),
    uiSummary: compactSafeText(summary ?? `${input.request.toolName} completed.`, input.maxPreviewChars ?? 800),
    diagnosticRef: refId ?? `tool:${input.request.callId}`,
    display: projectToolDisplay(input.request, input.output),
    truncated,
    redacted: true,
  };
}

export function projectToolFailure(input: {
  readonly request: ToolCallRequest;
  readonly error: string;
  readonly diagnosticRef?: string;
}): ToolSafeProjection {
  return {
    uiSummary: redactOrdinaryText(input.error, 500),
    diagnosticRef: input.diagnosticRef ?? `tool:${input.request.callId}:failed`,
    truncated: false,
    redacted: true,
  };
}

export function projectToolApprovalRequired(input: {
  readonly request: ToolCallRequest;
  readonly toolName: string;
  readonly operationType: string;
}): ToolSafeProjection {
  return {
    uiSummary: `工具 ${input.toolName} 需要用户确认后才能执行。`,
    diagnosticRef: `tool:${input.request.callId}:confirmation-required`,
    truncated: false,
    redacted: false,
  };
}

export function projectModelFailure(failure: ModelFailure | undefined): string {
  return redactOrdinaryText(failure?.message ?? "模型服务这次没有返回可用结果。", 600);
}

export function safeReadFileToolPreview(input: {
  readonly summary?: string;
  readonly path?: string;
  readonly bytes?: number;
  readonly maxLength?: number;
}): string | undefined {
  const bytes = typeof input.bytes === "number" ? `${input.bytes} bytes` : undefined;
  const headline = input.summary ?? [input.path, bytes].filter(isString).join(" · ");
  return compactSafeText(
    `${headline || "文件已读取。"}\n文件正文只进入本轮工具上下文；普通面板只展示路径、大小和截断状态。`,
    input.maxLength ?? 900
  );
}

export function safeCommandToolPreview(input: {
  readonly summary?: string;
  readonly command?: string;
  readonly exitCode?: number;
  readonly maxLength?: number;
}): string | undefined {
  const exit = typeof input.exitCode === "number" ? `exit ${input.exitCode}` : undefined;
  const headline = input.summary ?? [input.command, exit].filter(isString).join(" · ");
  return compactSafeText(
    `${headline || "命令已执行。"}\n命令输出只进入本轮工具上下文；普通面板不展开 stdout / stderr 原文。`,
    input.maxLength ?? 900
  );
}

export function compactSafeText(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const text = redactSensitiveText(value).trim();
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
  const action = stringOrUndefined(record.action) ?? request.toolName;
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
  if (request.toolName === "browser_snapshot") {
    return {
      kind: "browser_snapshot",
      title: stringOrUndefined(result.title),
      url: stringOrUndefined(result.url),
      text: compactSafeText(stringOrUndefined(result.text), 900),
      truncated: record.truncated === true,
    };
  }
  if (request.toolName === "write_file") {
    return {
      kind: "file_change_summary",
      path: stringOrUndefined(result.path) ?? stringOrUndefined(asRecord(request.input).path),
      bytes: numberOrUndefined(result.bytes),
      append: result.append === true,
    };
  }
  if (request.toolName === "edit_file") {
    const input = asRecord(request.input);
    return {
      kind: "file_diff_preview",
      path: stringOrUndefined(result.path) ?? stringOrUndefined(input.path),
      replacements: numberOrUndefined(result.replacements),
      previousLength: numberOrUndefined(result.previousLength),
      nextLength: numberOrUndefined(result.nextLength),
    };
  }
  if (request.toolName === "run_command" || request.toolName === "shell_command") {
    const stdout = stringOrUndefined(result.stdout);
    const stderr = stringOrUndefined(result.stderr);
    return {
      kind: "command_summary",
      command: stringOrUndefined(result.command) ?? stringOrUndefined(asRecord(request.input).command),
      args: stringArray(result.args).length > 0 ? stringArray(result.args) : stringArray(asRecord(request.input).args),
      exitCode: numberOrUndefined(result.exitCode),
      stdoutSummary: stdout === undefined ? undefined : summarizeCommandOutput(stdout),
      stderrSummary: stderr === undefined ? undefined : summarizeCommandOutput(stderr),
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

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
    url: stringOrUndefined(item.uri),
    refId: stringOrUndefined(item.refId),
    source: stringOrUndefined(item.source),
    snippet: compactSafeText(stringOrUndefined(item.snippet), 260),
  };
}

function summarizeCommandOutput(value: string): string | undefined {
  const lines = redactSensitiveText(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 4);
  return compactSafeText(lines.join("\n"), 420);
}

function projectAgentToolContent(value: unknown): unknown {
  return redactAndTruncateForAgent(value, 0);
}

function redactAndTruncateForAgent(value: unknown, depth: number): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === "string") {
    return redactSensitiveText(value).length > 20_000
      ? `${redactSensitiveText(value).slice(0, 19_999)}…`
      : redactSensitiveText(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, 40).map((item) => redactAndTruncateForAgent(item, depth + 1));
    return value.length > items.length ? [...items, "[truncated]"] : items;
  }
  if (typeof value === "object") {
    if (depth >= 6) {
      return "[truncated]";
    }
    const projected: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 40);
    for (const [key, item] of entries) {
      if (isSecretLikeKey(key) || isRawProviderKey(key)) {
        projected[key] = "[redacted]";
      } else {
        projected[key] = redactAndTruncateForAgent(item, depth + 1);
      }
    }
    if (Object.keys(value as Record<string, unknown>).length > entries.length) {
      projected.truncated = true;
    }
    return projected;
  }
  return String(value);
}

function isSecretLikeKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.includes("apikey") || normalized.includes("api_key") || normalized.includes("token") || normalized.includes("secret") || normalized === "authorization";
}

function isRawProviderKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === "raw" || normalized === "rawoutput" || normalized === "rawresponse" || normalized === "providerresponse" || normalized === "prompt" || normalized === "sanitizedmessages";
}
