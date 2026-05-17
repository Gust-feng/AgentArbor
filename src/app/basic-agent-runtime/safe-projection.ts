import type { ModelFailure } from "../../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolDisplayProjection,
  ToolSafeProjection,
} from "../../domain/tools/index.js";
import {
  projectToolResultEnvelope as projectKernelToolResultEnvelope,
  projectToolStatusEnvelope,
} from "../../kernel/tools/index.js";
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
  const display = projectToolDisplay(input.request, input.output);
  const diagnosticRef = refId ?? `tool:${input.request.callId}`;
  const envelope = projectKernelToolResultEnvelope({
    request: input.request,
    display,
    summary,
    diagnosticRef,
    truncated,
  });
  return {
    agentContent: {
      summary: envelope.agentSummary,
      evidenceRefs: envelope.evidenceRefs,
      truncated: envelope.truncated,
      redacted: envelope.redacted,
      diagnosticRef: envelope.diagnosticRef,
    },
    uiSummary: compactSafeText(summary ?? `${input.request.toolName} completed.`, input.maxPreviewChars ?? 800),
    diagnosticRef,
    display,
    envelope,
    truncated,
    redacted: true,
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
    redacted: true,
  };
}

export function projectToolApprovalRequired(input: {
  readonly request: ToolCallRequest;
  readonly toolName: string;
  readonly operationType: string;
}): ToolSafeProjection {
  const diagnosticRef = `tool:${input.request.callId}:confirmation-required`;
  const summary = `工具 ${input.toolName} 需要用户确认后才能执行。`;
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
    `${headline || "命令已执行。"}\n命令输出只进入本轮工具上下文；普通面板只展示安全摘要。`,
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
  if (request.toolName === "write_file" || request.toolName === "create_file" || request.toolName === "delete_file") {
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
    url: stringOrUndefined(item.url) ?? stringOrUndefined(item.uri),
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
