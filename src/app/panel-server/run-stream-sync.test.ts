import assert from "node:assert/strict";
import test from "node:test";
import type { PanelRunStreamEvent } from "../panel-run-read-model.js";
import { persistentPanelRunStreamEvents } from "./run-stream-sync.js";

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
