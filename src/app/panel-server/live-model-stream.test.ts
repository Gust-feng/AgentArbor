import assert from "node:assert/strict";
import test from "node:test";
import type { ModelOutputDelta, ModelPurpose } from "../../domain/intelligence/index.js";
import type { PanelRunJob } from "./run-jobs.js";
import type { PanelRunStreamEvent } from "../panel-run-read-model.js";
import { appendLiveModelOutputDelta } from "./live-model-stream.js";

test("live model stream preserves long output deltas without low UI truncation", () => {
  const runId = "run-live-long";
  const longDelta = `开头\n${"模型输出片段".repeat(220)}\n结尾`;
  const events: PanelRunStreamEvent[] = [];
  const job = testJob({ runId, runMode: "agent" });

  appendLiveModelOutputDelta({
    runJobs: {
      recordActivity() {},
      get(candidateRunId) {
        return candidateRunId === runId ? job : undefined;
      },
      appendStreamEvent(_runId, event) {
        const next = { ...event, sequence: events.length + 1 } as PanelRunStreamEvent;
        events.push(next);
        return next;
      },
    },
  }, runId, delta({
    text: longDelta,
  }));

  assert.equal(events[0]?.delta, longDelta);
});

test("ordinary agent live stream ignores every legacy work-session purpose", () => {
  const runId = "run-live-agent";
  for (const purpose of [
    "work_session_decision",
    "work_session_child_material",
    "work_session_synthesis",
    "work_session_direct_answer",
  ] as const) {
    const events = appendDeltaToJob(
      testJob({ runId, runMode: "agent" }),
      delta({
        text: `legacy output for ${purpose}`,
        purpose,
      })
    );

    assert.equal(events.length, 0, `${purpose} must not stream into ordinary agent output`);
  }
});

test("deep compatibility live stream keeps legacy work-session output", () => {
  const runId = "run-live-deep";
  const events = appendDeltaToJob(
    testJob({ runId, runMode: "deep" }),
    delta({
      text: "legacy work-session output",
      purpose: "work_session_synthesis",
    })
  );

  assert.equal(events[0]?.delta, "legacy work-session output");
});

function appendDeltaToJob(job: PanelRunJob, modelDelta: ModelOutputDelta): readonly PanelRunStreamEvent[] {
  const events: PanelRunStreamEvent[] = [];
  appendLiveModelOutputDelta({
    runJobs: {
      recordActivity() {},
      get(candidateRunId) {
        return candidateRunId === job.runId ? job : undefined;
      },
      appendStreamEvent(_runId, event) {
        const next = { ...event, sequence: events.length + 1 } as PanelRunStreamEvent;
        events.push(next);
        return next;
      },
    },
  }, job.runId, modelDelta);
  return events;
}

function testJob(input: {
  readonly runId: string;
  readonly runMode: "agent" | "deep";
}): PanelRunJob {
  return {
    runId: input.runId,
    runMode: input.runMode,
  } as PanelRunJob;
}

function delta(input: {
  readonly text: string;
  readonly purpose?: ModelPurpose;
}): ModelOutputDelta {
  return {
    kind: "output",
    requestId: "model-call-live-long",
    purpose: input.purpose ?? "desktop_agent",
    providerId: "provider-test",
    model: "model-test",
    delta: input.text,
    index: 1,
    createdAt: "2026-06-04T00:00:00.000Z",
  };
}
