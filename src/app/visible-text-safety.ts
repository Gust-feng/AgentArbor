import { friendlyFailureCopy, friendlyModelFailureKindCopy } from "./failure-copy.js";

export function sanitizeAssistantVisibleText(
  value: string,
  options?: { readonly preserveOuterWhitespace?: boolean }
): string {
  const result = String(value).replace(/\r\n?/g, "\n");
  return options?.preserveOuterWhitespace === true ? result : result.trim();
}

export function sanitizeConversationHistoryText(value: string): string {
  return sanitizeAssistantVisibleText(value)
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function friendlyUserFacingFailureText(message: string | undefined): string {
  const text = optionalFriendlyFailureMessage(message);
  if (text === undefined) {
    return "运行失败，但没有返回错误详情。";
  }
  return text;
}

export function friendlyUserFacingModelFailureText(
  payload: Readonly<Record<string, unknown>>
): string {
  const failureKind = typeof payload.failureKind === "string" ? payload.failureKind : undefined;
  const message = optionalFriendlyFailureMessage(
    typeof payload.failureMessage === "string" ? payload.failureMessage : undefined
  );
  if (failureKind === "provider_response" && message !== undefined) {
    return message;
  }
  return friendlyModelFailureKindCopy(failureKind) ?? message ?? "没有返回可用结果。";
}

function optionalFriendlyFailureMessage(message: string | undefined): string | undefined {
  const text = friendlyFailureCopy(sanitizeAssistantVisibleText(String(message ?? "")).trim());
  if (text.length === 0) {
    return undefined;
  }
  return text.length <= 1_000 ? text : `${text.slice(0, 999)}…`;
}
