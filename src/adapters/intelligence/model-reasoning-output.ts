import type { ModelReasoningOutputProjection } from "../../domain/intelligence/index.js";
import { redactSensitiveText } from "../../kernel/redaction.js";

const MAX_REASONING_OUTPUT_CHARS = 12_000;

export function modelReasoningOutputFromText(input: {
  readonly source: ModelReasoningOutputProjection["source"];
  readonly content: string;
  readonly maxChars?: number;
}): ModelReasoningOutputProjection | undefined {
  const normalized = redactSensitiveText(input.content).replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return undefined;
  }
  const maxChars = input.maxChars ?? MAX_REASONING_OUTPUT_CHARS;
  const truncated = normalized.length > maxChars;
  return {
    source: input.source,
    content: truncated ? `${normalized.slice(0, Math.max(0, maxChars - 1))}…` : normalized,
    truncated,
  };
}
