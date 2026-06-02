import { redactSensitiveText } from "../../kernel/redaction.js";
import { sanitizeConversationHistoryText } from "../visible-text-safety.js";

export function safeContextText(value: string, maxLength: number): { readonly text: string; readonly truncated: boolean } {
  const redacted = redactSensitiveText(value).replace(/\b(runtime|store|secret):[^\s]+/gi, "[redacted-ref]").trim();
  if (redacted.length <= maxLength) {
    return { text: redacted, truncated: false };
  }
  return {
    text: `${redacted.slice(0, Math.max(0, maxLength - 1))}…`,
    truncated: true,
  };
}

export function safeUnboundedContextText(value: string): { readonly text: string; readonly truncated: false } {
  return {
    text: redactSensitiveText(value).replace(/\b(runtime|store|secret):[^\s]+/gi, "[redacted-ref]").trim(),
    truncated: false,
  };
}

export function safeConversationContextText(value: string, maxLength: number): { readonly text: string; readonly truncated: boolean } {
  return safeContextText(
    sanitizeConversationHistoryText(value)
      .replace(/\binternal loop\b/gi, "[redacted-internal]"),
    maxLength
  );
}

export function safePlainContextText(value: string, maxLength: number): string {
  return safeContextText(value, maxLength).text;
}
