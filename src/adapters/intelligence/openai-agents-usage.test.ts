import assert from "node:assert/strict";
import test from "node:test";
import { RequestUsage, Usage } from "@openai/agents";
import { modelUsageFromOpenAIAgentsSdk } from "./openai-agents-usage.js";

test("Agents SDK usage keeps cumulative totals separate from the latest non-compaction request", () => {
  const usage = modelUsageFromOpenAIAgentsSdk({
    usage: new Usage({
      requests: 11,
      inputTokens: 411_553,
      outputTokens: 3_333,
      totalTokens: 414_886,
      inputTokensDetails: [{ cached_tokens: 372_736 }],
      requestUsageEntries: [
        new RequestUsage({
          inputTokens: 40_000,
          outputTokens: 500,
          totalTokens: 40_500,
          endpoint: "responses.create",
        }),
        new RequestUsage({
          inputTokens: 200_000,
          outputTokens: 2_000,
          totalTokens: 202_000,
          endpoint: "responses.compact",
        }),
        new RequestUsage({
          inputTokens: 60_000,
          outputTokens: 1_000,
          totalTokens: 61_000,
          inputTokensDetails: { cached_tokens: 50_000 },
          endpoint: "responses.create",
        }),
      ],
    }),
    firstTokenLatencyTotalMs: 0,
    firstTokenLatencySampleCount: 0,
    contextMaintenanceUsage: {
      requestCount: 1,
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    },
  });

  assert.equal(usage.requestCount, 12);
  assert.equal(usage.inputTokens, 411_653);
  assert.equal(usage.totalTokens, 415_006);
  assert.deepEqual(usage.latestAgentRequest, {
    inputTokens: 60_000,
    outputTokens: 1_000,
    totalTokens: 61_000,
    cachedInputTokens: 50_000,
    uncachedInputTokens: 10_000,
  });
});

test("Agents SDK cumulative usage never fabricates a latest request when entries are unavailable", () => {
  const usage = modelUsageFromOpenAIAgentsSdk({
    usage: new Usage({
      requests: 11,
      inputTokens: 411_553,
      outputTokens: 3_333,
      totalTokens: 414_886,
    }),
    firstTokenLatencyTotalMs: 0,
    firstTokenLatencySampleCount: 0,
    contextMaintenanceUsage: {},
  });

  assert.equal(usage.latestAgentRequest, undefined);
});
