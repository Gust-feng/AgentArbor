import assert from "node:assert/strict";
import test from "node:test";
import type { ArborMessage } from "../domain/common.js";
import type { IntelligenceChannel } from "../domain/intelligence/index.js";
import { createMessage } from "../kernel/messages/create-message.js";
import { createUndergroundAiRuntimeConfig } from "./underground-ai-runtime.js";
import { createMinimalRuntime } from "./runtime.js";
import { runUndergroundDirectionSession } from "./underground-direction-session.js";
import {
  MessageDrivenUndergroundDispatcher,
  UndergroundMessageDispatcherError,
} from "./underground-message-dispatcher.js";

test("message-driven underground session without AgentTurnRuntime stops before direction handoff completion", async () => {
  const result = await runUndergroundDirectionSession("Build a small deterministic helper.");
  const eventTypes = result.runtime.eventLog.types();

  assert.equal(eventTypes.includes("direction_handoff.completed"), false);
  assert.equal(result.terminalStatus, "stopped");
  assert.equal(result.undergroundReport.convergenceReport.stopReason, "ai_required_for_autonomy");
  assert.equal(result.undergroundReport.agentClusterRun, undefined);
});

test("dispatcher processes repeated goal messages once for a trace with fake AI", async () => {
  const runtime = createMinimalRuntime();
  const aiConfig = createUndergroundAiRuntimeConfig({ mode: "fake" });
  if (!aiConfig.enabled) {
    throw new Error("Expected fake AI runtime config to be enabled.");
  }
  const dispatcher = new MessageDrivenUndergroundDispatcher({
    runtime,
    intelligenceChannel: aiConfig.createIntelligenceChannel(runtime),
    toolCenter: aiConfig.createToolCenter(runtime),
  });
  try {
    const goalMessage = createGoalReceivedMessage({
      traceId: "trace-repeat",
      goalId: "goal-repeat",
      goal: "Build a small deterministic helper.",
    });

    runtime.bus.publish(goalMessage);
    runtime.bus.publish(goalMessage);

    const result = await dispatcher.dispatchUntilIdleAsync();

    assert.notEqual(result, undefined);
    assert.equal((result?.dispatchSteps ?? 0) > 0, true);
    assert.equal(countEvents(runtime, "goal.received"), 2);
    assert.equal(result?.terminalStatus, "approved_package_created");
    assert.equal(countEvents(runtime, "direction_handoff.completed"), 1);
    assert.equal(countEvents(runtime, "model.requested") > 0, true);
    assert.equal(await dispatcher.dispatchUntilIdleAsync(), undefined);
    assert.equal(countEvents(runtime, "direction_handoff.completed"), 1);
  } finally {
    dispatcher.dispose();
  }
});

test("dispatcher max step guard rejects sync full dispatch", () => {
  const runtime = createMinimalRuntime();
  const dispatcher = new MessageDrivenUndergroundDispatcher({ runtime, maxDispatchSteps: 1 });
  try {
    runtime.bus.publish(
      createGoalReceivedMessage({
        traceId: "trace-step-guard",
        goalId: "goal-step-guard",
        goal: "Build a small deterministic helper.",
      })
    );

    assert.throws(() => dispatcher.dispatchUntilIdle(), {
      name: "UndergroundMessageDispatcherError",
      message: /maxDispatchSteps=1/,
    });
    assert.equal(countEvents(runtime, "underground.exploration_planned"), 0);
  } finally {
    dispatcher.dispose();
  }
});

test("dispatcher rejects later stage messages without prior goal context", () => {
  const runtime = createMinimalRuntime();
  const dispatcher = new MessageDrivenUndergroundDispatcher({ runtime });
  try {
    assert.equal(dispatcher.dispatchUntilIdle(), undefined);
    assert.deepEqual(runtime.eventLog.types(), []);

    runtime.bus.publish(
      createMessage({
        traceId: "trace-skip",
        from: { id: "test-driver", role: "underground_center" },
        to: { group: "underground-center" },
        type: "candidate_pool.updated",
        intent: "update_candidate_pool",
        payload: {},
      })
    );

    assert.throws(() => dispatcher.dispatchUntilIdle(), UndergroundMessageDispatcherError);
    assert.equal(countEvents(runtime, "convergence_review.completed"), 0);
    assert.equal(countEvents(runtime, "direction_handoff.completed"), 0);
    assert.equal(countEvents(runtime, "user_approval.requested"), 0);
  } finally {
    dispatcher.dispose();
  }
});

test("sync dispatch with an intelligence channel fails before model side effects", () => {
  const runtime = createMinimalRuntime();
  const dispatcher = new MessageDrivenUndergroundDispatcher({
    runtime,
    intelligenceChannel: neverCalledIntelligenceChannel(),
  });
  try {
    runtime.bus.publish(
      createGoalReceivedMessage({
        traceId: "trace-sync-intelligence",
        goalId: "goal-sync-intelligence",
        goal: "Build a small deterministic helper.",
      })
    );

    assert.throws(() => dispatcher.dispatchUntilIdle(), {
      name: "UndergroundMessageDispatcherError",
      message: /dispatchUntilIdleAsync/,
    });
    assert.equal(countEvents(runtime, "model.requested"), 0);
    assert.equal(countEvents(runtime, "exploration_candidate.produced"), 0);
  } finally {
    dispatcher.dispose();
  }
});

function createGoalReceivedMessage(input: {
  readonly traceId: string;
  readonly goalId: string;
  readonly goal: string;
}): ArborMessage<{ goalId: string; goal: string }> {
  return createMessage({
    traceId: input.traceId,
    from: { id: "user", role: "user" },
    to: { role: "underground_center" },
    type: "goal.received",
    intent: "receive_user_goal",
    payload: {
      goalId: input.goalId,
      goal: input.goal,
    },
  });
}

function countEvents(runtime: ReturnType<typeof createMinimalRuntime>, type: ArborMessage["type"]): number {
  return runtime.eventLog.types().filter((candidate) => candidate === type).length;
}

function neverCalledIntelligenceChannel(): IntelligenceChannel {
  return {
    async request() {
      throw new Error("The sync dispatcher must not enter the asynchronous intelligence handler.");
    },
    validateResponse() {
      return {
        status: "failed",
        checkedAt: "never-called",
        issues: [],
      };
    },
  };
}
