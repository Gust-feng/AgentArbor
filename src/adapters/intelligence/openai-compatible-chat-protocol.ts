import type {
  ModelReasoningControlKind,
  OpenAIModelRequestSettings,
  OpenAIReasoningEffort,
  ProviderProtocolProfileId,
} from "../../domain/config/index.js";
import type { ModelReasoningOutputProjection } from "../../domain/intelligence/index.js";
import { asRecord, isPlainRecord } from "./provider-value-utils.js";

export type OpenAICompatibleChatDialect = {
  readonly profileId: ProviderProtocolProfileId;
  readonly reasoningControl: ModelReasoningControlKind;
  readonly preserveFullAssistantMessage: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsStreamUsage: boolean;
  readonly streamDeltaMode: "incremental" | "cumulative";
};

export type OpenAICompatibleChatDecodedContent = {
  readonly textContent: string;
  readonly rawContent: string;
  readonly reasoningContent: string;
  readonly reasoningSource: ModelReasoningOutputProjection["source"];
};

const THINK_OPEN_TAG = "<think>";
const THINK_CLOSE_TAG = "</think>";

export function resolveOpenAICompatibleChatDialect(input: {
  readonly providerProfileId?: ProviderProtocolProfileId;
  readonly baseUrl: string;
  readonly model: string;
}): OpenAICompatibleChatDialect {
  const profileId = input.providerProfileId ?? inferProviderProfileId(input.baseUrl);
  switch (profileId) {
    case "openai":
      return {
        profileId,
        reasoningControl: "openai_chat_reasoning_effort",
        preserveFullAssistantMessage: false,
        supportsStreaming: true,
        supportsStreamUsage: true,
        streamDeltaMode: "incremental",
      };
    case "deepseek":
      return {
        profileId,
        reasoningControl: "deepseek_reasoning_effort",
        preserveFullAssistantMessage: true,
        supportsStreaming: true,
        supportsStreamUsage: true,
        streamDeltaMode: "incremental",
      };
    case "moonshot":
      if (isKimiK3Model(input.model)) {
        return {
          profileId,
          reasoningControl: "none",
          preserveFullAssistantMessage: true,
          supportsStreaming: true,
          supportsStreamUsage: false,
          streamDeltaMode: "incremental",
        };
      }
      return {
        profileId,
        reasoningControl: "thinking_enabled_disabled",
        preserveFullAssistantMessage: true,
        supportsStreaming: true,
        supportsStreamUsage: false,
        streamDeltaMode: "incremental",
      };
    case "glm":
      if (isModernGLMThinkingModel(input.model)) {
        return {
          profileId,
          reasoningControl: "thinking_enabled_disabled",
          preserveFullAssistantMessage: true,
          supportsStreaming: true,
          supportsStreamUsage: false,
          streamDeltaMode: "incremental",
        };
      }
      return {
        profileId,
        reasoningControl: "thinking_disabled",
        preserveFullAssistantMessage: true,
        supportsStreaming: false,
        supportsStreamUsage: false,
        streamDeltaMode: "incremental",
      };
    case "minimax":
      return {
        profileId,
        reasoningControl: "reasoning_split",
        preserveFullAssistantMessage: true,
        supportsStreaming: true,
        supportsStreamUsage: false,
        streamDeltaMode: "cumulative",
      };
    default:
      return {
        profileId: "openai_compatible",
        reasoningControl: "none",
        preserveFullAssistantMessage: false,
        supportsStreaming: true,
        supportsStreamUsage: false,
        streamDeltaMode: "incremental",
      };
  }
}

export function applyOpenAICompatibleChatRequestPolicy(input: {
  readonly fields: Record<string, unknown>;
  readonly dialect: OpenAICompatibleChatDialect;
}): Record<string, unknown> {
  const next = { ...input.fields };
  if (input.dialect.profileId === "moonshot") {
    delete next.temperature;
    delete next.top_p;
  }
  if (input.dialect.profileId === "deepseek" && requestHasThinkingEnabled(next)) {
    delete next.temperature;
    delete next.top_p;
  }
  if (
    (input.dialect.profileId === "deepseek" || input.dialect.profileId === "moonshot") &&
    requestHasThinkingEnabled(next) &&
    isPlainRecord(next.tool_choice)
  ) {
    next.tool_choice = "auto";
  }
  return next;
}

export function applyOpenAICompatibleChatDialectControls(input: {
  readonly fields: Record<string, unknown>;
  readonly dialect: OpenAICompatibleChatDialect;
  readonly settings?: OpenAIModelRequestSettings;
}): Record<string, unknown> {
  const next = { ...input.fields };
  const effort = openAIReasoningEffortOrUndefined(next.reasoning_effort);
  delete next.reasoning_effort;

  switch (input.dialect.reasoningControl) {
    case "openai_chat_reasoning_effort":
      if (effort !== undefined && effort !== "none") {
        next.reasoning_effort = effort;
      }
      return next;
    case "deepseek_reasoning_effort":
      return applyDeepSeekReasoningControls(next, effort);
    case "thinking_enabled_disabled":
      return applyThinkingEnabledControls(next, input.dialect, effort);
    case "thinking_disabled":
      return {
        ...next,
        thinking: { type: "disabled" },
      };
    case "reasoning_split":
      return {
        ...next,
        reasoning_split: true,
      };
    default:
      return next;
  }
}

export function decodeOpenAICompatibleChatMessage(input: {
  readonly message: Record<string, unknown>;
  readonly dialect: OpenAICompatibleChatDialect;
}): OpenAICompatibleChatDecodedContent {
  const rawContent = typeof input.message.content === "string" ? input.message.content : "";
  const explicitReasoning = reasoningTextFromRecord(input.message);
  const split = splitThinkTagContent(rawContent);
  const reasoningContent = joinReasoningText(explicitReasoning, split.reasoningContent);
  return {
    textContent: split.textContent,
    rawContent,
    reasoningContent,
    reasoningSource: explicitReasoning.trim().length > 0 ? "openai_chat_reasoning_content" : "provider_reasoning_content",
  };
}

export function reasoningTextFromRecord(record: Record<string, unknown>): string {
  return joinReasoningText(
    stringValue(record.reasoning_content),
    stringValue(record.reasoning),
    reasoningDetailsText(record.reasoning_details)
  );
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
      rest = "";
      break;
    }
    reasoningContent += rest.slice(0, closeIndex);
    rest = rest.slice(closeIndex + THINK_CLOSE_TAG.length);
  }

  return { textContent, reasoningContent };
}

export class OpenAICompatibleThinkTagStreamSplitter {
  private readonly openTag = THINK_OPEN_TAG;
  private readonly closeTag = THINK_CLOSE_TAG;
  private buffer = "";
  private inThinkBlock = false;

  push(delta: string): { readonly textDelta: string; readonly reasoningDelta: string } {
    this.buffer += delta;
    return this.drain(false);
  }

  flush(): { readonly textDelta: string; readonly reasoningDelta: string } {
    return this.drain(true);
  }

  private drain(flush: boolean): { readonly textDelta: string; readonly reasoningDelta: string } {
    let textDelta = "";
    let reasoningDelta = "";

    while (this.buffer.length > 0) {
      if (this.inThinkBlock) {
        const closeIndex = this.buffer.toLowerCase().indexOf(this.closeTag);
        if (closeIndex >= 0) {
          reasoningDelta += this.buffer.slice(0, closeIndex);
          this.buffer = this.buffer.slice(closeIndex + this.closeTag.length);
          this.inThinkBlock = false;
          continue;
        }
        if (flush) {
          reasoningDelta += this.buffer;
          this.buffer = "";
          break;
        }
        const safeLength = this.safeInsideThinkLength();
        if (safeLength > 0) {
          reasoningDelta += this.buffer.slice(0, safeLength);
          this.buffer = this.buffer.slice(safeLength);
        }
        break;
      }

      const openIndex = this.buffer.toLowerCase().indexOf(this.openTag);
      if (openIndex >= 0) {
        textDelta += this.buffer.slice(0, openIndex);
        this.buffer = this.buffer.slice(openIndex + this.openTag.length);
        this.inThinkBlock = true;
        continue;
      }
      if (flush) {
        textDelta += this.buffer;
        this.buffer = "";
        break;
      }
      const suffixLength = possibleTagSuffixLength(this.buffer, this.openTag);
      const safeLength = this.buffer.length - suffixLength;
      if (safeLength > 0) {
        textDelta += this.buffer.slice(0, safeLength);
        this.buffer = this.buffer.slice(safeLength);
      }
      break;
    }

    return { textDelta, reasoningDelta };
  }

  private safeInsideThinkLength(): number {
    const suffixLength = possibleTagSuffixLength(this.buffer, this.closeTag);
    return this.buffer.length - suffixLength;
  }
}

function applyDeepSeekReasoningControls(
  fields: Record<string, unknown>,
  effort: OpenAIReasoningEffort | undefined
): Record<string, unknown> {
  if (effort === "none") {
    return {
      ...fields,
      thinking: { type: "disabled" },
    };
  }
  if (effort === undefined) {
    return fields;
  }
  return {
    ...fields,
    thinking: { type: "enabled" },
    reasoning_effort: effort === "xhigh" ? "max" : "high",
  };
}

function applyThinkingEnabledControls(
  fields: Record<string, unknown>,
  dialect: OpenAICompatibleChatDialect,
  effort: OpenAIReasoningEffort | undefined,
): Record<string, unknown> {
  const thinking = { type: effort === "none" ? "disabled" : "enabled" };
  if (dialect.profileId === "moonshot") {
    return {
      ...fields,
      thinking,
    };
  }
  return {
    ...fields,
    thinking,
  };
}

function requestHasThinkingEnabled(fields: Readonly<Record<string, unknown>>): boolean {
  const thinking = asRecord(fields.thinking);
  if (thinking.type === "enabled") {
    return true;
  }
  const extraBodyThinking = asRecord(asRecord(fields.extra_body).thinking);
  return extraBodyThinking.type === "enabled";
}

function reasoningDetailsText(value: unknown): string {
  if (Array.isArray(value)) {
    return joinReasoningText(...value.map(reasoningDetailItemText));
  }
  return reasoningDetailItemText(value);
}

function reasoningDetailItemText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  const record = asRecord(value);
  return stringValue(record.text);
}

function joinReasoningText(...parts: readonly string[]): string {
  return parts
    .map((part) => part.replace(/\r\n/g, "\n"))
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}

function openAIReasoningEffortOrUndefined(value: unknown): OpenAIReasoningEffort | undefined {
  if (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }
  return undefined;
}

function inferProviderProfileId(baseUrl: string): ProviderProtocolProfileId {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "").toLowerCase();
  if (normalizedBaseUrl === "https://api.openai.com" || normalizedBaseUrl === "https://api.openai.com/v1") {
    return "openai";
  }
  if (normalizedBaseUrl.includes("deepseek")) return "deepseek";
  if (normalizedBaseUrl.includes("moonshot") || normalizedBaseUrl.includes("kimi")) return "moonshot";
  if (
    normalizedBaseUrl.includes("bigmodel") ||
    normalizedBaseUrl.includes("z.ai") ||
    normalizedBaseUrl.includes("zhipu") ||
    normalizedBaseUrl.includes("glm")
  ) {
    return "glm";
  }
  if (normalizedBaseUrl.includes("minimax") || normalizedBaseUrl.includes("minimaxi")) return "minimax";
  return "openai_compatible";
}

function isModernGLMThinkingModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.includes("glm-5.1") ||
    normalized.includes("glm-5") ||
    normalized.includes("glm-4.7");
}

function isKimiK3Model(model: string): boolean {
  return model.toLowerCase().includes("kimi-k3");
}

function possibleTagSuffixLength(value: string, tag: string): number {
  const lower = value.toLowerCase();
  const lowerTag = tag.toLowerCase();
  const max = Math.min(lower.length, lowerTag.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (lower.endsWith(lowerTag.slice(0, length))) {
      return length;
    }
  }
  return 0;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
