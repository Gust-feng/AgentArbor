import assert from "node:assert/strict";
import test from "node:test";
import { OrdinaryToolMetricsCollector } from "./tool-runtime-metrics.js";

test("OrdinaryToolMetricsCollector aggregates definition, execution and scheduling without raw content", () => {
  const metrics = new OrdinaryToolMetricsCollector();
  metrics.recordDefinitionRequest(2, 600);
  metrics.record({
    kind: "definition",
    toolName: "read_file",
    operationType: "read-only",
    definitionHash: "abc123",
    definitionTokens: 240,
    totalDefinitionTokens: 600,
    toolCount: 2,
  });
  metrics.record({
    kind: "execution",
    toolName: "read_file",
    operationType: "read-only",
    status: "completed",
    inputTokens: 12,
    rawBodyTokens: 5_200,
    rawEnvelopeTokens: 5_700,
    finalEnvelopeTokens: 5_700,
    outputChars: 18_000,
    outputBytes: 18_000,
    durationMs: 20,
    continuation: { kind: "native", offered: true, completed: false, chainHash: "chain-1", pageChars: 18_000 },
  });
  metrics.record({
    kind: "execution",
    toolName: "read_file",
    operationType: "read-only",
    status: "completed",
    finalEnvelopeTokens: 200,
    continuation: { kind: "native", offered: false, completed: true, chainHash: "chain-1", pageChars: 120 },
    retentionFailure: "capacity_failure",
    retentionMs: 7,
  });
  metrics.record({
    kind: "scheduling",
    toolName: "read_file",
    operationType: "read-only",
    queueWaitMs: 4,
    executionMs: 20,
    activeCount: 3,
    cancelledWhileQueued: true,
  });
  metrics.recordDropped();

  const snapshot = metrics.snapshot();
  const tool = snapshot.tools[0]!;
  assert.equal(snapshot.schemaVersion, "ordinary-tool-metrics/v1");
  assert.equal(snapshot.definitionRequestCount, 1);
  assert.equal(tool.calls, 2);
  assert.equal(tool.rawBodyTokens.count, 1);
  assert.equal(tool.finalEnvelopeTokens.max, 5_700);
  assert.equal(tool.continuationsOffered, 1);
  assert.equal(tool.continuationPages.max, 2);
  assert.equal(tool.continuationChars, 18_120);
  assert.equal(tool.retentionFailures, 1);
  assert.equal(tool.retentionReasons.capacity_failure, 1);
  assert.equal(tool.retentionMs.max, 7);
  assert.equal(tool.maxActive, 3);
  assert.equal(tool.queuedCancelled, 1);
  assert.equal(snapshot.metricsDroppedCount, 1);
  assert.equal(JSON.stringify(snapshot).includes("18_000"), false);
});
