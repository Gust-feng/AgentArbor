import assert from "node:assert/strict";
import test from "node:test";
import {
  contextWindowUsageFrom,
  latestModelUsageFromEvents,
  latestModelUsageFromTranscript,
} from "../src/context-window-usage.js";

test("context window usage prefers provider input tokens", () => {
  const usage = contextWindowUsageFrom({
    contextWindowTokens: 1_000,
    modelUsage: { inputTokens: 350 },
    ledgerBudget: {
      usedInputTokens: 120,
      tokenCountSource: "openai_tiktoken",
    },
  });

  assert.equal(usage?.source, "provider_usage");
  assert.equal(usage?.usedTokens, 350);
  assert.equal(usage?.percent, 35);
  assert.equal(usage?.ringPercent, 35);
  assert.equal(usage?.tone, "normal");
  assert.equal(usage?.label, "已用35%上下文容量");
});

test("context window usage falls back to tokenizer-backed ledger budget", () => {
  const usage = contextWindowUsageFrom({
    contextWindowTokens: 8_000,
    ledgerBudget: {
      usedInputTokens: 6_200,
      tokenCountSource: "openai_tiktoken",
    },
  });

  assert.equal(usage?.source, "context_ledger");
  assert.equal(usage?.usedTokens, 6_200);
  assert.equal(Math.round(usage?.percent ?? 0), 78);
  assert.equal(usage?.tone, "warning");
  assert.equal(usage?.label, "已用78%上下文容量");
});

test("context window usage does not treat character counts as token usage", () => {
  const usage = contextWindowUsageFrom({
    contextWindowTokens: 128_000,
    ledgerBudget: {
      usedInputTokens: 16_000,
      tokenCountSource: "character_count",
    },
  });

  assert.equal(usage?.source, "unavailable");
  assert.equal(usage?.usedTokens, undefined);
  assert.equal(usage?.percent, undefined);
  assert.equal(usage?.ringPercent, 0);
  assert.equal(usage?.tone, "muted");
  assert.equal(usage?.label, "上下文容量 128K，等待模型用量");
});

test("context window usage clamps only the visual ring when usage exceeds the window", () => {
  const usage = contextWindowUsageFrom({
    contextWindowTokens: 1_000,
    modelUsage: { inputTokens: 1_260 },
  });

  assert.equal(Math.round(usage?.percent ?? 0), 126);
  assert.equal(usage?.ringPercent, 100);
  assert.equal(usage?.tone, "danger");
  assert.equal(usage?.label, "已用126%上下文容量");
});

test("context window usage returns undefined when no context window is known", () => {
  assert.equal(contextWindowUsageFrom({ modelUsage: { inputTokens: 120 } }), undefined);
});

test("latest model usage helpers read the newest available input usage", () => {
  assert.deepEqual(latestModelUsageFromTranscript([
    { modelUsage: { inputTokens: 100 } },
    {},
    { modelUsage: { inputTokens: 220 } },
  ]), { inputTokens: 220 });
  assert.deepEqual(latestModelUsageFromEvents([
    { detail: { modelUsage: { inputTokens: 80 } } },
    { detail: {} },
    { detail: { modelUsage: { inputTokens: 140 } } },
  ]), { inputTokens: 140 });
});
