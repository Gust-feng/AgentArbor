import { friendlyFailureCopy } from "../../failure-copy.js";

export function sanitizeFailureCopy(value: string): string {
  const text = userVisibleAnswer(value).trim();
  const message = friendlyFailureCopy(text);
  return message.length <= 1_000 ? message : `${message.slice(0, 999)}…`;
}

export function userVisibleAnswer(text: string): string {
  return stripInternalAssistantText(text)
    .replace(/AgentArbor\s*桌面\s*Root Agent/g, "AgentArbor 桌面助手")
    .replace(/Root Agent/g, "助手");
}

export function normalizeComparableText(value: string): string {
  return userVisibleAnswer(value).replace(/\s+/g, " ").trim();
}

function stripInternalAssistantText(text: string): string {
  return text
    .replace(/<\s*(?:tool_call|function_call|use_tool|internal_action|internal_control|query|arguments)\b[^>]*>[\s\S]*?<\s*\/\s*(?:tool_call|function_call|use_tool|internal_action|internal_control|query|arguments)\s*>/gi, "")
    .replace(/<\s*\/?\s*(?:tool_call|function_call|use_tool|internal_action|internal_control|query|arguments)\b[^>]*>/gi, "");
}
