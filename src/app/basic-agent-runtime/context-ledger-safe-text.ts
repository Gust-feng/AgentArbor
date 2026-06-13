import { sanitizeConversationHistoryText } from "../visible-text-safety.js";

export function safeContextText(value: string, maxLength: number): { readonly text: string; readonly truncated: boolean } {
  const text = value.trim();
  if (text.length <= maxLength) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, Math.max(0, maxLength - 1))}…`,
    truncated: true,
  };
}

export function safeUnboundedContextText(value: string): { readonly text: string; readonly truncated: false } {
  return {
    text: value.trim(),
    truncated: false,
  };
}

export function safeConversationContextText(value: string, maxLength: number): { readonly text: string; readonly truncated: boolean } {
  return safeContextText(sanitizeConversationHistoryText(value), maxLength);
}

export function safePlainContextText(value: string, maxLength: number): string {
  return safeContextText(value, maxLength).text;
}
