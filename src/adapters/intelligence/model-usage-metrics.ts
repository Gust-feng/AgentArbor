import type { ModelUsage } from "../../domain/intelligence/index.js";
import { numberOrUndefined } from "./provider-value-utils.js";

export function openAIChatUsageFromRecord(value: unknown): Pick<
  ModelUsage,
  "inputTokens" | "outputTokens" | "totalTokens" | "cachedInputTokens" | "uncachedInputTokens" | "reasoningOutputTokens"
> {
  const usage = asUsageRecord(value);
  const completionDetails = asUsageRecord(usage.completion_tokens_details);
  return {
    inputTokens: numberOrUndefined(usage.prompt_tokens),
    outputTokens: numberOrUndefined(usage.completion_tokens),
    totalTokens: numberOrUndefined(usage.total_tokens),
    cachedInputTokens: numberOrUndefined(usage.prompt_cache_hit_tokens),
    uncachedInputTokens: numberOrUndefined(usage.prompt_cache_miss_tokens),
    reasoningOutputTokens: numberOrUndefined(completionDetails.reasoning_tokens),
  };
}

export function openAIResponsesUsageFromRecord(value: unknown): Pick<
  ModelUsage,
  "inputTokens" | "outputTokens" | "totalTokens" | "cachedInputTokens" | "reasoningOutputTokens"
> {
  const usage = asUsageRecord(value);
  const inputDetails = asUsageRecord(usage.input_tokens_details);
  const outputDetails = asUsageRecord(usage.output_tokens_details);
  return {
    inputTokens: numberOrUndefined(usage.input_tokens),
    outputTokens: numberOrUndefined(usage.output_tokens),
    totalTokens: numberOrUndefined(usage.total_tokens),
    cachedInputTokens: numberOrUndefined(inputDetails.cached_tokens),
    reasoningOutputTokens: numberOrUndefined(outputDetails.reasoning_tokens),
  };
}

export function modelUsageWithTiming(input: {
  readonly usage?: Pick<
    ModelUsage,
    "inputTokens" | "outputTokens" | "totalTokens" | "cachedInputTokens" | "uncachedInputTokens" | "reasoningOutputTokens"
  >;
  readonly latencyMs: number;
  readonly firstTokenLatencyMs?: number;
}): ModelUsage {
  const latencyMs = normalizeDuration(input.latencyMs);
  const firstTokenLatencyMs = normalizeDuration(input.firstTokenLatencyMs);
  const outputDurationMs =
    firstTokenLatencyMs === undefined || latencyMs === undefined
      ? undefined
      : Math.max(0, latencyMs - firstTokenLatencyMs);
  return compactUsage({
    inputTokens: normalizeTokenCount(input.usage?.inputTokens),
    outputTokens: normalizeTokenCount(input.usage?.outputTokens),
    totalTokens: normalizeTokenCount(input.usage?.totalTokens),
    cachedInputTokens: normalizeTokenCount(input.usage?.cachedInputTokens),
    uncachedInputTokens: normalizeTokenCount(input.usage?.uncachedInputTokens),
    reasoningOutputTokens: normalizeTokenCount(input.usage?.reasoningOutputTokens),
    latencyMs,
    firstTokenLatencyMs,
    outputDurationMs,
    outputTokensPerSecond: outputTokensPerSecond({
      outputTokens: input.usage?.outputTokens,
      durationMs: outputDurationMs,
    }),
  });
}

function outputTokensPerSecond(input: {
  readonly outputTokens?: number;
  readonly durationMs?: number;
}): number | undefined {
  const outputTokens = normalizeTokenCount(input.outputTokens);
  const durationMs = normalizeDuration(input.durationMs);
  if (outputTokens === undefined || durationMs === undefined || durationMs <= 0) {
    return undefined;
  }
  return Number((outputTokens / (durationMs / 1_000)).toFixed(2));
}

function normalizeTokenCount(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

function normalizeDuration(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.round(value);
}

function compactUsage(usage: ModelUsage): ModelUsage {
  return Object.fromEntries(
    Object.entries(usage).filter(([, value]) => value !== undefined)
  ) as ModelUsage;
}

function asUsageRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}
