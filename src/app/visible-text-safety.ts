import { redactSensitiveText } from "../kernel/redaction.js";

const INTERNAL_CONTROL_BLOCK_PATTERN =
  /<\s*(start_work_session|tool_call|function_call|use_tool|internal_action|internal_control|query|arguments)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;

const INTERNAL_CONTROL_TAGS_PATTERN =
  /<\s*\/?\s*(start_work_session|tool_call|function_call|use_tool|internal_action|internal_control|query|arguments)\b[^>]*>/gi;

const INTERNAL_SECTION_HEADING_PATTERN =
  /^#{1,6}\s*(?:当前任务|任务状态|运行诊断|内部诊断|系统诊断|调试信息|debug|diagnostics|internal)(?:\s|$|[\(：:])/i;

const RAW_INTERNAL_LINE_PATTERNS = [
  /^\s*[-*]?\s*(?:requestId|responseId)\s*[:：=]/i,
  /\bsanitizedMessages\b|\braw prompt\b|\bhidden reasoning\b|\braw provider response\b|\braw tool output\b|\binternal loop\b/i,
] as const;

const INTERNAL_ID_PATTERN =
  /\b(?:goal|trace|run|model-request|model-response|tool-call|conversation)-[A-Za-z0-9_-]+\b/gi;

export function sanitizeAssistantVisibleText(
  value: string,
  options?: { readonly preserveOuterWhitespace?: boolean }
): string {
  const cleaned = String(value)
    .replace(INTERNAL_CONTROL_BLOCK_PATTERN, "")
    .replace(/<\s*start_work_session\b[^>]*\/\s*>/gi, "")
    .replace(INTERNAL_CONTROL_TAGS_PATTERN, "");

  const lines = cleaned.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (INTERNAL_SECTION_HEADING_PATTERN.test(trimmed)) {
      continue;
    }
    if (RAW_INTERNAL_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      continue;
    }
    kept.push(line);
  }

  const result = redactSensitiveText(kept
    .join("\n")
    .replace(INTERNAL_ID_PATTERN, "[运行引用]")
    .replace(/\n{3,}/g, "\n\n"));
  return options?.preserveOuterWhitespace === true ? result : result.trim();
}

export function sanitizeConversationHistoryText(value: string): string {
  return sanitizeAssistantVisibleText(value)
    .replace(/\b(?:goal|trace|run|model-request|model-response|tool-call|conversation)-[A-Za-z0-9_-]+\b/gi, "[运行引用]")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function friendlyUserFacingFailureText(message: string | undefined): string {
  const text = sanitizeAssistantVisibleText(String(message ?? "")).trim();
  if (text.length === 0) {
    return "这次没有完成。";
  }
  return text.length <= 1_000 ? text : `${text.slice(0, 999)}…`;
}
