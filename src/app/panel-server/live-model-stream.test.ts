import assert from "node:assert/strict";
import test from "node:test";
import type { ModelOutputDelta } from "../../domain/intelligence/index.js";
import type { PanelRunJob } from "../panel-run-jobs.js";
import type { PanelRunStreamEvent } from "../panel-run-read-model.js";
import { appendLiveModelOutputDelta } from "./live-model-stream.js";

test("live model stream preserves long output deltas without low UI truncation", () => {
  const runId = "run-live-long";
  const longDelta = `开头\n${"模型输出片段".repeat(220)}\n结尾`;
  const events: PanelRunStreamEvent[] = [];
  const job = {
    runId,
  } as PanelRunJob;

  appendLiveModelOutputDelta({
    runJobs: {
      get(candidateRunId) {
        return candidateRunId === runId ? job : undefined;
      },
      appendStreamEvent(_runId, event) {
        const next = { ...event, sequence: events.length + 1 } as PanelRunStreamEvent;
        events.push(next);
        return next;
      },
    },
    runExecutor: {
      syncRunEvents() {
        return [];
      },
    },
  }, runId, delta({
    text: longDelta,
  }));

  assert.equal(events[0]?.delta, longDelta);
});

function delta(input: {
  readonly text: string;
}): ModelOutputDelta {
  return {
    kind: "output",
    requestId: "model-call-live-long",
    purpose: "desktop_agent",
    providerId: "provider-test",
    model: "model-test",
    delta: input.text,
    index: 1,
    createdAt: "2026-06-04T00:00:00.000Z",
  };
}
