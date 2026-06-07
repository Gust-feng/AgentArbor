import assert from "node:assert/strict";
import test from "node:test";
import {
  immediateRunForStartedConversation,
  liveRunForObservedReplay,
  mergeObservedRunEvents,
  optimisticConversationForSubmit,
  runIdToObserveAfterStart,
  type StartedConversationRun,
  type SubmitFlowBasicRun,
  type SubmitFlowConversation,
} from "./panel-ui-submit-flow.js";

test("submit flow observes the new run when it has started", () => {
  const conversation: SubmitFlowConversation = {
    conversationId: "conversation-1",
    title: "任务",
    activeRunId: "run-current",
    queuedRunIds: ["run-new"],
    turns: [],
  };

  assert.equal(runIdToObserveAfterStart({
    conversation,
    responseRunId: "run-new",
    responseStatus: "pending",
    fetchedStatus: undefined,
    previousObservedRunId: "run-current",
  }), "run-current");
  assert.equal(runIdToObserveAfterStart({
    conversation,
    responseRunId: "run-new",
    responseStatus: "pending",
    fetchedStatus: "running",
    previousObservedRunId: "run-current",
  }), "run-new");
});

test("submit flow observes a just-created pending run unless it is explicitly queued", () => {
  const conversation: SubmitFlowConversation = {
    conversationId: "conversation-1",
    title: "任务",
    activeRunId: "run-new",
    turns: [],
  };

  assert.equal(runIdToObserveAfterStart({
    conversation,
    responseRunId: "run-new",
    responseStatus: "pending",
    fetchedStatus: undefined,
    previousObservedRunId: undefined,
  }), "run-new");
});

test("submit flow keeps the active run while a follow-up is queued", () => {
  const previousRun = basicRun("run-current");
  const immediate = immediateRunForStartedConversation({
    previousRun,
    responseRun: { runId: "run-new", status: "pending" },
    observedRunId: "run-current",
    goal: "继续",
    now: "2026-06-03T00:00:00.000Z",
  });

  assert.equal(immediate, previousRun);
});

test("submit flow creates an immediate run shell for a new active run", () => {
  const immediate = immediateRunForStartedConversation({
    previousRun: undefined,
    responseRun: {
      runId: "run-new",
      status: "running",
      runMode: "agent",
      eventCursor: { lastSequence: 3, eventCount: 3 },
    },
    observedRunId: "run-new",
    goal: "写一段说明",
    now: "2026-06-03T00:00:00.000Z",
  });

  assert.equal(immediate?.runId, "run-new");
  assert.equal(immediate?.status, "running");
  assert.equal(immediate?.goalSummary, "写一段说明");
  assert.equal(immediate?.eventCursor.lastSequence, 3);
});

test("submit flow keeps a just-created active pending run queued until backend advances it", () => {
  const immediate = immediateRunForStartedConversation({
    previousRun: undefined,
    responseRun: {
      runId: "run-new",
      status: "pending",
      runMode: "agent",
    },
    observedRunId: "run-new",
    goal: "写一段说明",
    now: "2026-06-03T00:00:00.000Z",
  });

  assert.equal(immediate?.runId, "run-new");
  assert.equal(immediate?.status, "queued");
});

test("submit flow never propagates deep run mode into the ordinary conversation shell", () => {
  const unexpectedDeepResponse = {
    runId: "run-new",
    status: "running",
    runMode: "deep",
  } as unknown as StartedConversationRun;

  const immediate = immediateRunForStartedConversation({
    previousRun: undefined,
    responseRun: unexpectedDeepResponse,
    observedRunId: "run-new",
    goal: "写一段说明",
    now: "2026-06-03T00:00:00.000Z",
  });

  assert.equal(immediate?.runMode, "agent");
});

test("submit flow appends optimistic user turn without fabricating assistant content", () => {
  const conversation = optimisticConversationForSubmit(undefined, "你好", "2026-06-03T00:00:00.000Z");

  assert.equal(conversation.title, "你好");
  assert.equal(conversation.turns.length, 2);
  assert.equal(conversation.turns[0]?.role, "user");
  assert.equal(conversation.turns[0]?.content, "你好");
  assert.equal(conversation.turns[1]?.role, "assistant");
  assert.equal(conversation.turns[1]?.content, "");
  assert.equal(conversation.turns[1]?.status, "running");
});

test("submit flow does not keep completed replay text as a live stream", () => {
  const live = liveRunForObservedReplay({
    observedRunId: "run-1",
    observedRun: { ...basicRun("run-1"), status: "completed" },
    previousLive: undefined,
    replayEvents: [
      {
        id: "event-1",
        runId: "run-1",
        sequence: 1,
        type: "model.output.delta",
        delta: "完整答案",
        refs: [{ kind: "model_call", id: "model-1" }],
      },
      {
        id: "event-2",
        runId: "run-1",
        sequence: 2,
        type: "final.result",
        summary: "完成",
        refs: [],
      },
    ],
  });

  assert.equal(live, undefined);
});

test("submit flow merges replay with already streamed events for the same run", () => {
  const merged = mergeObservedRunEvents({
    previousRunId: "run-1",
    observedRunId: "run-1",
    previousEvents: [
      { id: "event-2", sequence: 2 },
      { id: "event-3", sequence: 3 },
    ],
    replayEvents: [
      { id: "event-1", sequence: 1 },
      { id: "event-2", sequence: 2 },
    ],
  });

  assert.deepEqual(merged.map((event) => event.id), ["event-1", "event-2", "event-3"]);
});

function basicRun(runId: string): SubmitFlowBasicRun {
  return {
    runId,
    title: "任务",
    goalSummary: "任务",
    status: "running",
    runMode: "agent",
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
    requiresUserAction: false,
    eventCursor: { lastSequence: 0, eventCount: 0 },
  };
}
