import assert from "node:assert/strict";
import test from "node:test";
import {
  contextWindowUsageFrom,
  contextWindowTokensForActiveRun,
  latestModelUsageFromEvents,
  latestModelUsageForRunFromTranscript,
} from "../src/context-window-usage.js";

test("context window usage prefers provider input tokens", () => {
  const usage = contextWindowUsageFrom({
    contextWindowTokens: 1_000,
    modelUsage: {
      inputTokens: 3_500,
      latestAgentRequest: { inputTokens: 350 },
    },
  });

  assert.equal(usage?.source, "provider_usage");
  assert.equal(usage?.usedTokens, 350);
  assert.equal(usage?.percent, 35);
  assert.equal(usage?.ringPercent, 35);
  assert.equal(usage?.tone, "normal");
  assert.equal(usage?.label, "上下文已用 35%");
});

test("context window usage waits for provider usage when no measured usage is available", () => {
  const usage = contextWindowUsageFrom({
    contextWindowTokens: 8_000,
  });

  assert.equal(usage?.source, "unavailable");
  assert.equal(usage?.usedTokens, undefined);
  assert.equal(usage?.percent, undefined);
  assert.equal(usage?.ringPercent, 0);
  assert.equal(usage?.tone, "muted");
  assert.equal(usage?.label, "上下文用量尚未可用");
});

test("context window usage clamps only the visual ring when usage exceeds the window", () => {
  const usage = contextWindowUsageFrom({
    contextWindowTokens: 1_000,
    modelUsage: {
      inputTokens: 2_500,
      latestAgentRequest: { inputTokens: 1_260 },
    },
  });

  assert.equal(Math.round(usage?.percent ?? 0), 126);
  assert.equal(usage?.ringPercent, 100);
  assert.equal(usage?.tone, "danger");
  assert.equal(usage?.label, "上下文已用 126%");
});

test("context window usage enters danger at ninety percent", () => {
  const usage = contextWindowUsageFrom({
    contextWindowTokens: 1_000,
    modelUsage: { latestAgentRequest: { inputTokens: 900 } },
  });

  assert.equal(usage?.percent, 90);
  assert.equal(usage?.ringPercent, 90);
  assert.equal(usage?.tone, "danger");
});

test("context window usage returns undefined when no context window is known", () => {
  assert.equal(contextWindowUsageFrom({
    modelUsage: { latestAgentRequest: { inputTokens: 120 } },
  }), undefined);
});

test("active run keeps the selected model context window until its capability projection arrives", () => {
  assert.equal(contextWindowTokensForActiveRun({
    selectedModelContextWindowTokens: 128_000,
  }), 128_000);
  assert.equal(contextWindowTokensForActiveRun({
    runContextWindowTokens: 256_000,
    selectedModelContextWindowTokens: 128_000,
  }), 256_000);
  assert.equal(contextWindowTokensForActiveRun({
    runContextWindowTokens: 0,
    selectedModelContextWindowTokens: 128_000,
  }), 128_000);
});

test("latest model usage helpers require the newest provider-measured Agent request", () => {
  assert.deepEqual(latestModelUsageForRunFromTranscript("run-new", [
    { runId: "run-old", modelUsage: { inputTokens: 10_000, latestAgentRequest: { inputTokens: 100 } } },
    {},
    { runId: "run-new", modelUsage: { inputTokens: 20_000, latestAgentRequest: { inputTokens: 220 } } },
  ]), { inputTokens: 20_000, latestAgentRequest: { inputTokens: 220 } });
  assert.deepEqual(latestModelUsageFromEvents([
    { detail: { modelUsage: { inputTokens: 8_000, latestAgentRequest: { inputTokens: 80 } } } },
    { detail: {} },
    { detail: { modelUsage: { inputTokens: 14_000, latestAgentRequest: { inputTokens: 140 } } } },
  ]), { inputTokens: 14_000, latestAgentRequest: { inputTokens: 140 } });
});

test("a new run never inherits provider usage from an older conversation turn", () => {
  assert.equal(latestModelUsageForRunFromTranscript("run-new", [{
    runId: "run-old",
    modelUsage: { latestAgentRequest: { inputTokens: 250_000 } },
  }]), undefined);
});

test("context window usage never falls back to cumulative run input", () => {
  const usage = contextWindowUsageFrom({
    contextWindowTokens: 256_000,
    modelUsage: { inputTokens: 411_553 },
  });

  assert.equal(usage?.source, "unavailable");
  assert.equal(usage?.ringPercent, 0);
  assert.equal(usage?.tone, "muted");
});

test("cumulative usage above the window does not override the latest request", () => {
  const usage = contextWindowUsageFrom({
    contextWindowTokens: 256_000,
    modelUsage: {
      inputTokens: 411_553,
      latestAgentRequest: { inputTokens: 60_000 },
    },
  });

  assert.equal(Math.round(usage?.percent ?? 0), 23);
  assert.equal(usage?.tone, "normal");
});
