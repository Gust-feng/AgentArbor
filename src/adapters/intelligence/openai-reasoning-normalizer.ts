import type { ModelReasoningOutputProjection } from "../../domain/intelligence/index.js";
import { asRecord } from "./provider-value-utils.js";

export type OpenAIReasoningProtocol =
  | "openai_responses"
  | "openai_compatible_chat_completions";

export type OpenAICompatibleChatDecodedContent = {
  readonly textContent: string;
  readonly rawContent: string;
  readonly reasoningContent: string;
  readonly reasoningSource: ModelReasoningOutputProjection["source"];
};

export type NormalizedReasoningStreamDelta = {
  readonly reasoningDelta: string;
  readonly textDelta: string;
};

const THINK_OPEN_TAG = "<think>";
const THINK_CLOSE_TAG = "</think>";

/**
 * Normalizes the supported provider wire families into answer and reasoning
 * deltas. Vendor-specific request controls remain in the Chat dialect; neither
 * the agent feature nor the UI consumes private provider fields.
 */
export class OpenAIReasoningStreamNormalizer {
  private thinkTagSplitter = new OpenAICompatibleThinkTagStreamSplitter();

  constructor(private readonly protocol: OpenAIReasoningProtocol) {}

  push(rawEvent: unknown): NormalizedReasoningStreamDelta {
    const event = asRecord(rawEvent);
    if (this.protocol === "openai_responses") {
      return normalizeResponsesStreamEvent(event);
    }

    const choice = asRecord(Array.isArray(event.choices) ? event.choices[0] : undefined);
    const delta = asRecord(choice.delta);
    const split = this.thinkTagSplitter.push(stringValue(delta.content));
    const normalized = {
      reasoningDelta: joinReasoningDeltas(reasoningDeltaTextFromRecord(delta), split.reasoningDelta),
      textDelta: split.textDelta,
    };
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
      const flushed = this.thinkTagSplitter.flush();
      this.thinkTagSplitter = new OpenAICompatibleThinkTagStreamSplitter();
      return {
        reasoningDelta: joinReasoningDeltas(normalized.reasoningDelta, flushed.reasoningDelta),
        textDelta: `${normalized.textDelta}${flushed.textDelta}`,
      };
    }
    return normalized;
  }

  flush(): NormalizedReasoningStreamDelta {
    const flushed = this.thinkTagSplitter.flush();
    this.thinkTagSplitter = new OpenAICompatibleThinkTagStreamSplitter();
    return flushed;
  }
}

export function decodeOpenAICompatibleChatMessage(
  message: Record<string, unknown>,
): OpenAICompatibleChatDecodedContent {
  const rawContent = stringValue(message.content);
  const explicitReasoning = reasoningTextFromRecord(message);
  const split = splitThinkTagContent(rawContent);
  return {
    textContent: split.textContent,
    rawContent,
    reasoningContent: joinReasoningText(explicitReasoning, split.reasoningContent),
    reasoningSource: explicitReasoning.trim().length > 0
      ? "openai_chat_reasoning_content"
      : "provider_reasoning_content",
  };
}

/** Common OpenAI-compatible reasoning aliases; this is not an OpenAI standard. */
export function reasoningTextFromRecord(record: Record<string, unknown>): string {
  return mergeReasoningCandidates([
    stringValue(record.reasoning_content),
    stringValue(record.reasoning),
    reasoningDetailsText(record.reasoning_details),
  ]);
}

/** Streaming deltas are protocol fragments, so their boundary whitespace is significant. */
export function reasoningDeltaTextFromRecord(record: Record<string, unknown>): string {
  for (const candidate of [
    stringValue(record.reasoning_content),
    stringValue(record.reasoning),
  ]) {
    if (candidate.length > 0) return candidate.replace(/\r\n/g, "\n");
  }
  return reasoningDetailsText(record.reasoning_details);
}

export function splitThinkTagContent(content: string): {
  readonly textContent: string;
  readonly reasoningContent: string;
} {
  if (!content.toLowerCase().includes(THINK_OPEN_TAG)) {
    return { textContent: content, reasoningContent: "" };
  }

  let rest = content;
  let textContent = "";
  let reasoningContent = "";
  while (rest.length > 0) {
    const openIndex = rest.toLowerCase().indexOf(THINK_OPEN_TAG);
    if (openIndex < 0) {
      textContent += rest;
      break;
    }
    textContent += rest.slice(0, openIndex);
    rest = rest.slice(openIndex + THINK_OPEN_TAG.length);
    const closeIndex = rest.toLowerCase().indexOf(THINK_CLOSE_TAG);
    if (closeIndex < 0) {
      reasoningContent += rest;
      break;
    }
    reasoningContent += rest.slice(0, closeIndex);
    rest = rest.slice(closeIndex + THINK_CLOSE_TAG.length);
  }
  return { textContent, reasoningContent };
}

export class OpenAICompatibleThinkTagStreamSplitter {
  private buffer = "";
  private inThinkBlock = false;

  push(delta: string): NormalizedReasoningStreamDelta {
    this.buffer += delta;
    return this.drain(false);
  }

  flush(): NormalizedReasoningStreamDelta {
    return this.drain(true);
  }

  private drain(flush: boolean): NormalizedReasoningStreamDelta {
    let textDelta = "";
    let reasoningDelta = "";
    while (this.buffer.length > 0) {
      if (this.inThinkBlock) {
        const closeIndex = this.buffer.toLowerCase().indexOf(THINK_CLOSE_TAG);
        if (closeIndex >= 0) {
          reasoningDelta += this.buffer.slice(0, closeIndex);
          this.buffer = this.buffer.slice(closeIndex + THINK_CLOSE_TAG.length);
          this.inThinkBlock = false;
          continue;
        }
        if (flush) {
          reasoningDelta += this.buffer;
          this.buffer = "";
          break;
        }
        const safeLength = this.buffer.length - possibleTagSuffixLength(this.buffer, THINK_CLOSE_TAG);
        if (safeLength > 0) {
          reasoningDelta += this.buffer.slice(0, safeLength);
          this.buffer = this.buffer.slice(safeLength);
        }
        break;
      }

      const openIndex = this.buffer.toLowerCase().indexOf(THINK_OPEN_TAG);
      if (openIndex >= 0) {
        textDelta += this.buffer.slice(0, openIndex);
        this.buffer = this.buffer.slice(openIndex + THINK_OPEN_TAG.length);
        this.inThinkBlock = true;
        continue;
      }
      if (flush) {
        textDelta += this.buffer;
        this.buffer = "";
        break;
      }
      const suffixLength = possibleTagSuffixLength(this.buffer, THINK_OPEN_TAG);
      const safeLength = this.buffer.length - suffixLength;
      if (safeLength > 0) {
        textDelta += this.buffer.slice(0, safeLength);
        this.buffer = this.buffer.slice(safeLength);
      }
      break;
    }
    return { textDelta, reasoningDelta };
  }
}

export function mergeReasoningCandidates(candidates: readonly string[]): string {
  const merged: string[] = [];
  for (const raw of candidates) {
    const candidate = raw.replace(/\r\n/g, "\n").trim();
    if (candidate.length === 0 || merged.some((current) => current.includes(candidate))) continue;
    const containingIndex = merged.findIndex((current) => candidate.includes(current));
    if (containingIndex >= 0) {
      merged[containingIndex] = candidate;
    } else {
      merged.push(candidate);
    }
  }
  return merged.join("\n\n");
}

function normalizeResponsesStreamEvent(event: Record<string, unknown>): NormalizedReasoningStreamDelta {
  if (
    (event.type === "response.reasoning_summary_text.delta" ||
      event.type === "response.reasoning_text.delta") &&
    typeof event.delta === "string"
  ) {
    return { reasoningDelta: event.delta, textDelta: "" };
  }
  return event.type === "response.output_text.delta" && typeof event.delta === "string"
    ? { reasoningDelta: "", textDelta: event.delta }
    : { reasoningDelta: "", textDelta: "" };
}

function reasoningDetailsText(value: unknown): string {
  if (Array.isArray(value)) {
    return mergeReasoningCandidates(value.map(reasoningDetailItemText));
  }
  return reasoningDetailItemText(value);
}

function reasoningDetailItemText(value: unknown): string {
  if (typeof value === "string") return value;
  return stringValue(asRecord(value).text);
}

function joinReasoningText(...parts: readonly string[]): string {
  return parts
    .map((part) => part.replace(/\r\n/g, "\n"))
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}

function joinReasoningDeltas(...parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join("");
}

function possibleTagSuffixLength(value: string, tag: string): number {
  const lower = value.toLowerCase();
  const lowerTag = tag.toLowerCase();
  const max = Math.min(lower.length, lowerTag.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (lower.endsWith(lowerTag.slice(0, length))) return length;
  }
  return 0;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
