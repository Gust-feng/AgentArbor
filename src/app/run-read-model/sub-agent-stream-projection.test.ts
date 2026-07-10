import assert from "node:assert/strict";
import test from "node:test";
import { createSubAgentBatchCompletedMessage } from "../sub-agents/sub-agent-events.js";
import {
  subAgentStreamDetailFromPayload,
  subAgentStreamStatusFromDetail,
  subAgentStreamStatusFromPayload,
} from "./sub-agent-stream-projection.js";

test("sub-agent batch stream status reflects pending approval instead of completed", () => {
  const payload = createSubAgentBatchCompletedMessage({
    traceId: "trace-sub-agent-batch",
    runId: "run-sub-agent-batch",
    batchId: "batch-approval",
    results: [{
      subAgentId: "review-expert",
      subAgentName: "review-expert",
      status: "approval_required",
      summary: "Waiting for command confirmation.",
    }],
    successCount: 0,
    failedCount: 0,
    cancelledCount: 0,
    approvalRequiredCount: 1,
    notStartedCount: 1,
    totalDurationMs: 32,
    timestamp: "2026-07-06T00:00:00.000Z",
  }).payload;
  const record = payload as unknown as Readonly<Record<string, unknown>>;
  const detail = subAgentStreamDetailFromPayload("sub_agent_batch.completed", record);

  assert.equal(payload.status, "approval_required");
  assert.equal(subAgentStreamStatusFromPayload("sub_agent_batch.completed", record), "approval_needed");
  assert.equal(detail.subAgentStatus, "approval_required");
  assert.equal(subAgentStreamStatusFromDetail("sub_agent_batch.completed", detail), "approval_needed");
});

test("sub-agent batch stream status can derive failure from legacy count-only payloads", () => {
  const legacyPayload = {
    batchId: "batch-failed",
    successCount: 1,
    failedCount: 1,
    cancelledCount: 0,
    approvalRequiredCount: 0,
    notStartedCount: 0,
    totalDurationMs: 64,
  };
  const detail = subAgentStreamDetailFromPayload("sub_agent_batch.completed", legacyPayload);

  assert.equal(subAgentStreamStatusFromPayload("sub_agent_batch.completed", legacyPayload), "failed");
  assert.equal(detail.subAgentStatus, undefined);
  assert.equal(subAgentStreamStatusFromDetail("sub_agent_batch.completed", detail), "failed");
});
