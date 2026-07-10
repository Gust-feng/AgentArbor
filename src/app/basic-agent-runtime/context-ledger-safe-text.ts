import { normalizeModelFacingText } from "../text-projection/visible-text-safety.js";

/**
 * Model-facing context text helpers for the Basic Agent Context Ledger.
 *
 * FR-CTX-001/002 (装配保真地基): every text that lands in a
 * {@link BasicAgentContextItem} (visibility "model" or "diagnostic") must be
 * routed through {@link normalizeModelFacingText}. That normalizer only folds
 * `\r\n` -> `\n` and trims outer whitespace; it deliberately does NOT collapse
 * internal whitespace, blank lines, or indentation, so code blocks, command
 * stdout, JSON, and file fragments keep the structure the model needs to
 * continue the task. This is the model-facing channel of the dual-channel
 * design: UI projections use their own sanitizers (e.g.
 * `sanitizeConversationHistoryText`) and may collapse whitespace, but model
 * context must stay high-fidelity.
 *
 * Truncation here is by volume (character budget per item), never a signal to
 * drop an entire history entry. Dropping history is governed by the ledger's
 * token budget and retention priority, not by character thresholds.
 */
export function safeContextText(value: string, maxLength: number): { readonly text: string; readonly truncated: boolean } {
  const text = normalizeModelFacingText(value);
  if (text.length <= maxLength) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, Math.max(0, maxLength - 1))}…`,
    truncated: true,
  };
}

/**
 * Unbounded model-facing text for the current user message. The current user
 * message is a required context item (never dropped by the ledger budget), so
 * it does not get a character cap; it still goes through
 * {@link normalizeModelFacingText} to keep the model-facing channel consistent.
 */
export function safeUnboundedContextText(value: string): { readonly text: string; readonly truncated: false } {
  return {
    text: normalizeModelFacingText(value),
    truncated: false,
  };
}

/**
 * Conversation history feeding the model context pack. Preserves internal
 * whitespace/indentation/blank lines via {@link normalizeModelFacingText} so
 * code/stdout/JSON in earlier turns keep their structure; only line endings
 * and outer whitespace are normalized.
 */
export function safeConversationContextText(value: string, maxLength: number): { readonly text: string; readonly truncated: boolean } {
  return safeContextText(value, maxLength);
}

export function safePlainContextText(value: string, maxLength: number): string {
  return safeContextText(value, maxLength).text;
}
