import assert from "node:assert/strict";
import test from "node:test";
import {
  modelUsageWithTiming,
  openAIChatUsageFromRecord,
  openAIResponsesUsageFromRecord,
} from "./model-usage-metrics.js";

test("model usage metrics derive first-token timing and output token speed from real token counts", () => {
  const usage = modelUsageWithTiming({
    usage: {
      inputTokens: 120,
      outputTokens: 60,
      totalTokens: 180,
    },
    latencyMs: 2_500,
    firstTokenLatencyMs: 500,
  });

  assert.deepEqual(usage, {
    requestCount: 1,
    inputTokens: 120,
    outputTokens: 60,
    totalTokens: 180,
    latencyMs: 2_500,
    firstTokenLatencyMs: 500,
    outputDurationMs: 2_000,
    outputTokensPerSecond: 30,
  });
});

test("model usage metrics do not invent token speed without output token counts", () => {
  const usage = modelUsageWithTiming({
    latencyMs: 1_200,
    firstTokenLatencyMs: 300,
  });

  assert.deepEqual(usage, {
    requestCount: 1,
    latencyMs: 1_200,
    firstTokenLatencyMs: 300,
    outputDurationMs: 900,
  });
});

test("model usage metrics normalize OpenAI Chat and Responses usage fields", () => {
  assert.deepEqual(openAIChatUsageFromRecord({
    prompt_tokens: 11,
    completion_tokens: 7,
    total_tokens: 18,
    prompt_cache_hit_tokens: 5,
    prompt_cache_miss_tokens: 6,
    completion_tokens_details: {
      reasoning_tokens: 2,
    },
  }), {
    inputTokens: 11,
    outputTokens: 7,
    totalTokens: 18,
    cachedInputTokens: 5,
    uncachedInputTokens: 6,
    reasoningOutputTokens: 2,
  });
  assert.deepEqual(openAIResponsesUsageFromRecord({
    input_tokens: 20,
    output_tokens: 10,
    total_tokens: 30,
    input_tokens_details: {
      cached_tokens: 8,
      cache_write_tokens: 4,
    },
    output_tokens_details: {
      reasoning_tokens: 3,
    },
  }), {
    inputTokens: 20,
    outputTokens: 10,
    totalTokens: 30,
    cachedInputTokens: 8,
    cacheWriteInputTokens: 4,
    uncachedInputTokens: 12,
    reasoningOutputTokens: 3,
  });
});

test("model usage metrics read official OpenAI Chat cache details", () => {
  assert.deepEqual(openAIChatUsageFromRecord({
    prompt_tokens: 2_006,
    completion_tokens: 300,
    total_tokens: 2_306,
    prompt_tokens_details: {
      cached_tokens: 1_920,
      cache_write_tokens: 64,
    },
  }), {
    inputTokens: 2_006,
    outputTokens: 300,
    totalTokens: 2_306,
    cachedInputTokens: 1_920,
    cacheWriteInputTokens: 64,
    uncachedInputTokens: 86,
  });
});
