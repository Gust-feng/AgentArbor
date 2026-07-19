import type { RequestUsage as SdkRequestUsage, Usage as SdkUsage } from "@openai/agents";
import type { ModelRequestUsage, ModelUsage } from "../../domain/intelligence/index.js";

export function modelUsageFromOpenAIAgentsSdk(input: {
  readonly usage: SdkUsage;
  readonly firstTokenLatencyTotalMs: number;
  readonly firstTokenLatencySampleCount: number;
  readonly contextMaintenanceUsage: ModelUsage;
}): ModelUsage {
  const cachedInputTokens = sumDetail(input.usage.inputTokensDetails, "cached_tokens");
  const cacheWriteInputTokens = sumDetail(input.usage.inputTokensDetails, "cache_write_tokens");
  const reasoningOutputTokens = sumDetail(input.usage.outputTokensDetails, "reasoning_tokens");
  const sdkUsage = compactUsage({
    requestCount: input.usage.requests,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    totalTokens: input.usage.totalTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    uncachedInputTokens: cachedInputTokens === undefined
      ? undefined
      : Math.max(0, input.usage.inputTokens - cachedInputTokens),
    reasoningOutputTokens,
    firstTokenLatencyMs: input.firstTokenLatencySampleCount === 0
      ? undefined
      : input.firstTokenLatencyTotalMs / input.firstTokenLatencySampleCount,
    latestAgentRequest: latestAgentRequest(input.usage.requestUsageEntries),
  });
  return mergeCumulativeModelUsage(sdkUsage, input.contextMaintenanceUsage);
}

/** Adds independent provider calls while preserving the Agent request used by the context meter. */
export function mergeCumulativeModelUsage(base: ModelUsage, additional: ModelUsage): ModelUsage {
  if (Object.keys(additional).length === 0) return base;
  return compactUsage({
    requestCount: addOptional(base.requestCount, additional.requestCount),
    inputTokens: addOptional(base.inputTokens, additional.inputTokens),
    outputTokens: addOptional(base.outputTokens, additional.outputTokens),
    totalTokens: addOptional(normalizedTotalTokens(base), normalizedTotalTokens(additional)),
    cachedInputTokens: addOptional(base.cachedInputTokens, additional.cachedInputTokens),
    cacheWriteInputTokens: addOptional(base.cacheWriteInputTokens, additional.cacheWriteInputTokens),
    uncachedInputTokens: addOptional(base.uncachedInputTokens, additional.uncachedInputTokens),
    reasoningOutputTokens: addOptional(base.reasoningOutputTokens, additional.reasoningOutputTokens),
    estimatedCostUsd: addOptional(base.estimatedCostUsd, additional.estimatedCostUsd),
    latencyMs: addOptional(base.latencyMs, additional.latencyMs),
    firstTokenLatencyMs: base.firstTokenLatencyMs,
    outputDurationMs: base.outputDurationMs,
    outputTokensPerSecond: base.outputTokensPerSecond,
    latestAgentRequest: base.latestAgentRequest,
  });
}

function latestAgentRequest(entries: readonly SdkRequestUsage[] | undefined): ModelRequestUsage | undefined {
  const entry = [...(entries ?? [])].reverse().find((candidate) => candidate.endpoint !== "responses.compact");
  if (entry === undefined) return undefined;
  const cachedInputTokens = detailValue(entry.inputTokensDetails, "cached_tokens");
  return compactRequestUsage({
    inputTokens: nonNegativeNumber(entry.inputTokens),
    outputTokens: nonNegativeNumber(entry.outputTokens),
    totalTokens: nonNegativeNumber(entry.totalTokens),
    cachedInputTokens,
    cacheWriteInputTokens: detailValue(entry.inputTokensDetails, "cache_write_tokens"),
    uncachedInputTokens: cachedInputTokens === undefined
      ? undefined
      : Math.max(0, entry.inputTokens - cachedInputTokens),
    reasoningOutputTokens: detailValue(entry.outputTokensDetails, "reasoning_tokens"),
  });
}

function normalizedTotalTokens(usage: ModelUsage): number | undefined {
  if (usage.totalTokens !== undefined) return usage.totalTokens;
  return usage.inputTokens === undefined || usage.outputTokens === undefined
    ? undefined
    : usage.inputTokens + usage.outputTokens;
}

function addOptional(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return left + right;
}

function sumDetail(details: readonly Readonly<Record<string, number>>[], key: string): number | undefined {
  let found = false;
  let total = 0;
  for (const detail of details) {
    const value = detail[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      found = true;
      total += value;
    }
  }
  return found ? total : undefined;
}

function detailValue(details: Readonly<Record<string, number>>, key: string): number | undefined {
  return nonNegativeNumber(details[key]);
}

function nonNegativeNumber(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function compactUsage(usage: ModelUsage): ModelUsage {
  return Object.fromEntries(Object.entries(usage).filter(([, value]) => value !== undefined));
}

function compactRequestUsage(usage: ModelRequestUsage): ModelRequestUsage {
  return Object.fromEntries(Object.entries(usage).filter(([, value]) => value !== undefined));
}
