const INTERNAL_CONTROL_TAGS_PATTERN =
  /<\s*\/?\s*(start_work_session|tool_call|function_call|use_tool|internal_action|internal_control|query|arguments)\b[^>]*>/gi;

const INTERNAL_SECTION_HEADING_PATTERN =
  /^#{1,6}\s*(?:当前任务|任务状态|运行诊断|内部诊断|系统诊断|调试信息|debug|diagnostics|internal)(?:\s|$|[\(：:])/i;

const RAW_INTERNAL_LINE_PATTERNS = [
  /^\s*[-*]?\s*(?:requestId|responseId)\s*[:：=]/i,
  /\bsanitizedMessages\b|\braw prompt\b|\bhidden reasoning\b|\braw provider response\b|\braw tool output\b/i,
] as const;

const INTERNAL_ID_PATTERN =
  /\b(?:goal|trace|run|model-request|model-response|tool-call|conversation)-[A-Za-z0-9_-]+\b/gi;

export function sanitizeAssistantVisibleText(value: string): string {
  const cleaned = String(value)
    .replace(/<\s*start_work_session\b[^>]*>[\s\S]*?<\s*\/\s*start_work_session\s*>/gi, "")
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

  return kept
    .join("\n")
    .replace(INTERNAL_ID_PATTERN, "[运行引用]")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeConversationHistoryText(value: string): string {
  return sanitizeAssistantVisibleText(value)
    .replace(/OpenAI-compatible provider returned HTTP\s+\d+/gi, "模型服务返回 HTTP 错误")
    .replace(/\b(?:goal|trace|run|model-request|model-response|tool-call|conversation)-[A-Za-z0-9_-]+\b/gi, "[运行引用]")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function friendlyUserFacingFailureText(message: string | undefined): string {
  const text = String(message ?? "").trim();
  const lower = text.toLowerCase();
  if (text.length === 0) {
    return "这次没有完成。请检查设置里的模型配置，或稍后重试。";
  }
  if (text.includes("模型服务这次没有返回可用结果")) {
    return text;
  }
  if (
    lower.includes("output_validation") ||
    lower.includes("validation failed") ||
    lower.includes("contract")
  ) {
    return "模型返回的内容没有通过本轮格式检查。技术引用已放在诊断里，请调整模型配置或重试。";
  }
  if (lower.includes("api key") || lower.includes("missing_api_key")) {
    return "还没有可用的模型密钥。请先在设置里完成配置。";
  }
  if (
    lower.includes("missing_model") ||
    text.includes("缺少模型名") ||
    text.includes("没有可用的模型名") ||
    text.includes("还没有配置模型名")
  ) {
    return "还没有可用的模型名。请先在设置里完成配置。";
  }
  if (lower.includes("ai_disabled") || text.includes("AI 禁用")) {
    return "当前禁用了 AI，无法继续完成这次处理。";
  }
  if (lower.includes("provider_auth") || lower.includes("401") || lower.includes("403")) {
    return "模型服务鉴权失败。请检查设置里的密钥、Base URL 和账号权限。";
  }
  if (lower.includes("provider_rate_limit") || lower.includes("429")) {
    return "模型服务暂时限流。请稍后重试，或切换到可用模型。";
  }
  if (
    lower.includes("provider_network") ||
    lower.includes("provider_timeout") ||
    lower.includes("network") ||
    lower.includes("timeout")
  ) {
    return "模型服务暂时不可用。请检查网络和模型配置后重试。";
  }
  if (
    lower.includes("openai-compatible provider returned http") ||
    lower.includes("provider_response") ||
    lower.includes("model_failed") ||
    lower.includes("desktop_chat_failed") ||
    lower.includes("desktop_agent_failed")
  ) {
    return "模型服务这次没有返回可用结果。请检查设置里的 Base URL、模型名和密钥，诊断里保留了可定位的技术引用。";
  }
  return "这次没有完成。请检查设置里的模型配置、授权范围或诊断详情后重试。";
}
