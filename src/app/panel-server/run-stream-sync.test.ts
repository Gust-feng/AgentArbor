import assert from "node:assert/strict";
import test from "node:test";
import type { ArborMessage } from "../../domain/common.js";
import type {
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import { createMinimalRuntime } from "../runtime.js";
import type { PanelRunStreamEvent } from "../panel-run-read-model.js";
import { PanelRunJobStore } from "./run-jobs.js";
import {
  PanelRunStreamProjectionOwner,
  persistentPanelRunStreamEvents,
  projectPanelRunStreamEventsForJob,
} from "./run-stream-sync.js";

test("persistent panel stream events omit volatile live model deltas only", () => {
  const events = persistentPanelRunStreamEvents([
    streamEvent({
      eventId: "run-1:live:model.output.delta:model-1:1",
      type: "model.output.delta",
      delta: "live output",
    }),
    streamEvent({
      eventId: "run-1:live:model.reasoning.delta:model-1:2",
      type: "model.reasoning.delta",
      delta: "live reasoning",
    }),
    streamEvent({
      eventId: "run-1:event:10:model.output.delta:1",
      type: "model.output.delta",
      delta: "persisted replay output",
    }),
    streamEvent({
      eventId: "run-1:event:11:tool.completed",
      type: "tool.completed",
      summary: "tool completed",
    }),
  ]);

  assert.deepEqual(events.map((event) => event.eventId), [
    "run-1:event:10:model.output.delta:1",
    "run-1:event:11:tool.completed",
  ]);
});

test("panel run projection publishes only newly available events from write-side facts", () => {
  const runJobs = new PanelRunJobStore();
  const projectionOwner = new PanelRunStreamProjectionOwner();
  const runtime = createMinimalRuntime();
  const eventLogListCursors: number[] = [];
  const listEvents = runtime.eventLog.list.bind(runtime.eventLog);
  Object.defineProperty(runtime.eventLog, "list", {
    value: (afterSequence = 0) => {
      eventLogListCursors.push(afterSequence);
      return listEvents(afterSequence);
    },
  });
  const job = runJobs.create({
    runKind: "underground",
    runMode: "deep",
    goal: "project incrementally",
    aiMode: "fake",
    config: modelConfig(),
    informationAccess: informationAccess(),
  });
  runJobs.attachRuntime({
    runId: job.runId,
    runtime,
    traceId: "trace-incremental-sync",
    goalId: "goal-incremental-sync",
  });

  const started = projectPanelRunStreamEventsForJob({ runJobs }, job, projectionOwner);
  const duplicateStarted = projectPanelRunStreamEventsForJob({ runJobs }, job, projectionOwner);
  runtime.bus.publish(toolRequestedMessage(job.runId));
  const tool = projectPanelRunStreamEventsForJob({ runJobs }, job, projectionOwner);
  const duplicateTool = projectPanelRunStreamEventsForJob({ runJobs }, job, projectionOwner);
  runJobs.fail(job.runId, {
    config: job.config,
    informationAccess: job.informationAccess,
    error: { code: "projection_test_failed", message: "Projection test failed." },
  });
  const failed = projectPanelRunStreamEventsForJob({ runJobs }, job, projectionOwner);
  const duplicateFailed = projectPanelRunStreamEventsForJob({ runJobs }, job, projectionOwner);

  assert.deepEqual(started.map((event) => event.type), ["run.started"]);
  assert.deepEqual(tool.map((event) => event.type), ["tool.requested"]);
  assert.deepEqual(failed.map((event) => event.type), ["run.failed"]);
  assert.deepEqual(duplicateStarted, []);
  assert.deepEqual(duplicateTool, []);
  assert.deepEqual(duplicateFailed, []);
  assert.deepEqual(job.streamEvents.map((event) => event.sequence), [1, 2, 3]);
  assert.equal(new Set(job.streamEvents.map((event) => event.eventId)).size, 3);
  assert.deepEqual(eventLogListCursors.slice(2, 5), [0, 1, 1]);
});

test("panel stream projector is the only owner of cancelled and blocked transport events", () => {
  for (const terminalStatus of ["cancelled", "blocked"] as const) {
    const runJobs = new PanelRunJobStore();
    const projectionOwner = new PanelRunStreamProjectionOwner();
    const job = runJobs.create({
      runKind: "underground",
      runMode: "deep",
      goal: `project ${terminalStatus}`,
      aiMode: "fake",
      config: modelConfig(),
      informationAccess: informationAccess(),
    });
    projectPanelRunStreamEventsForJob({ runJobs }, job, projectionOwner);

    const payload = {
      config: job.config,
      informationAccess: job.informationAccess,
      reason: { code: terminalStatus, message: `Run ${terminalStatus}.` },
    };
    terminalStatus === "cancelled"
      ? runJobs.cancel(job.runId, payload)
      : runJobs.block(job.runId, payload);

    assert.equal(job.streamEvents.some((event) => event.type === `run.${terminalStatus}`), false);
    const projected = projectPanelRunStreamEventsForJob({ runJobs }, job, projectionOwner);
    assert.deepEqual(projected.map((event) => event.type), [`run.${terminalStatus}`]);
    assert.equal(job.streamEvents.filter((event) => event.type === `run.${terminalStatus}`).length, 1);
  }
});

function streamEvent(input: {
  readonly eventId: string;
  readonly type: PanelRunStreamEvent["type"];
  readonly delta?: string;
  readonly summary?: string;
}): PanelRunStreamEvent {
  return {
    eventId: input.eventId,
    runId: "run-1",
    sequence: 1,
    type: input.type,
    createdAt: "2026-06-15T00:00:00.000Z",
    agentLabel: "助手",
    delta: input.delta,
    summary: input.summary,
    status: "running",
    sourceRefs: [],
    modelCallRefs: ["model-1"],
    toolCallRefs: [],
  };
}

function toolRequestedMessage(runId: string): ArborMessage {
  return {
    id: "message-tool-requested",
    traceId: "trace-incremental-sync",
    from: { id: "desktop-agent", role: "desktop_agent" },
    to: { group: "underground-center" },
    type: "tool.requested",
    intent: "request_tool",
    payload: {
      runId,
      callId: "tool-call-incremental-sync",
      toolName: "read_file",
      input: { path: "README.md" },
    },
    createdAt: "2026-06-15T00:00:01.000Z",
  };
}

function modelConfig(): SanitizedModelProviderConfig {
  return {
    profileId: "default",
    defaultAiMode: "fake",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://example.test",
    model: "test-model",
    secretRef: "secret:model-provider:default",
    secretConfigured: false,
    updatedAt: "2026-06-15T00:00:00.000Z",
  };
}

function informationAccess(): SanitizedInformationAccessConfig {
  return {
    web: {
      provider: "none",
      providerKind: "tavily",
      maxResults: 5,
      secretRef: "secret:tavily",
      secretConfigured: false,
      status: "disabled",
      updatedAt: "2026-06-15T00:00:00.000Z",
    },
    sourcePreference: ["web"],
    stubs: {
      docs: "readonly_stub",
      packages: "readonly_stub",
      github: "readonly_stub",
      run_memory: "readonly_stub",
    },
  };
}
