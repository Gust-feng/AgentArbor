import type { ModelFailure } from "../../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
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
    agentContent: input.output,
    uiSummary: compactSafeText(summary ?? `${input.request.toolName} completed.`, input.maxPreviewChars ?? 800),
    diagnosticRef: refId ?? `tool:${input.request.callId}`,
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

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
