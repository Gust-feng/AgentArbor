const INTERNAL_SECTION_HEADING_PATTERN =
  /^#{1,6}\s*(?:当前任务|任务状态|运行诊断|内部诊断|系统诊断|调试信息|debug|diagnostics|internal)\b/i;

const INTERNAL_LINE_PATTERNS = [
  /^\s*[-*]?\s*(?:goalId|traceId|runId|requestId|responseId|contractId|providerId|outputContract|validationStatus|failureKind|currentPhase|currentStage)\s*[:：=]/i,
  /\bsanitizedMessages\b|\braw prompt\b|\bhidden reasoning\b|\braw provider response\b|\braw tool output\b/i,
  /\b(?:goal|trace|model-request|model-response|tool-call|conversation)-[A-Za-z0-9_-]+\b.*(?:当前任务|运行|诊断|contract|provider|validation|failure|模型调用|工具调用|任务)/i,
  /(?:当前任务|运行诊断|内部诊断|系统诊断)\s*[\(:：-].*\b(?:goal|trace|run|model-request|model-response)-[A-Za-z0-9_-]+\b/i,
] as const;

const INTERNAL_ID_PATTERN =
  /\b(?:goal|trace|run|model-request|model-response|tool-call|conversation)-[A-Za-z0-9_-]+\b/gi;

export function sanitizeAssistantVisibleText(value: string): string {
  const withoutControlMarkup = replaceProviderErrorText(
    String(value)
      .replace(/<\s*start_work_session\b[^>]*>[\s\S]*?<\s*\/\s*start_work_session\s*>/gi, "")
      .replace(/<\s*start_work_session\b[^>]*\/\s*>/gi, "")
      .replace(/<\s*\/?\s*(start_work_session|tool_call|function_call|use_tool|internal_action|internal_control|query|arguments)\b[^>]*>/gi, "")
  );

  const lines = withoutControlMarkup.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  let skippingInternalSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isHeading = /^#{1,6}\s+/.test(trimmed);
    if (INTERNAL_SECTION_HEADING_PATTERN.test(trimmed)) {
      skippingInternalSection = true;
      continue;
    }
    if (skippingInternalSection) {
      if (!isHeading) {
        continue;
      }
      skippingInternalSection = false;
    }
    if (shouldDropVisibleLine(trimmed)) {
      continue;
    }
    kept.push(line);
  }

  return kept
    .join("\n")
    .replace(INTERNAL_ID_PATTERN, "[内部引用]")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeConversationHistoryText(value: string): string {
  return sanitizeAssistantVisibleText(value)
    .replace(/\b(?:OpenAI-compatible|provider|outputContract|validationStatus|failureKind)\b/gi, "")
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
    return "模型返回的内容没有通过本轮格式检查。这不是你的输入问题；技术引用已放在诊断里，可以调整模型或重试。";
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
    return "模型服务暂时不可用或请求超时。请检查网络和模型配置后重试。";
  }
  if (
    lower.includes("openai-compatible provider returned http") ||
    lower.includes("provider_response") ||
    lower.includes("model_failed") ||
    lower.includes("desktop_chat_failed") ||
    lower.includes("desktop_agent_failed")
  ) {
    return "模型服务这次没有返回可用结果。请检查设置里的 Base URL、模型名和密钥，或稍后重试。详情已放在诊断里。";
  }
  return "这次没有完成。请检查设置里的模型配置、授权范围或诊断详情后重试。";
}

function replaceProviderErrorText(value: string): string {
  return value
    .replace(/OpenAI-compatible provider returned HTTP\s+\d+\.?/gi, "模型服务这次没有返回可用结果。")
    .replace(/OpenAI-compatible provider network request failed\.?/gi, "模型服务暂时不可用或请求超时。");
}

function shouldDropVisibleLine(trimmed: string): boolean {
  if (trimmed.length === 0) {
    return false;
  }
  return INTERNAL_LINE_PATTERNS.some((pattern) => pattern.test(trimmed));
}
