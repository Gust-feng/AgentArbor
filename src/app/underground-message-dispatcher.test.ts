import assert from "node:assert/strict";
import test from "node:test";
import type { ArborMessage } from "../domain/common.js";
import type { IntelligenceChannel } from "../domain/intelligence/index.js";
import { createMessage } from "../kernel/messages/create-message.js";
import { createMinimalRuntime } from "./runtime.js";
import { runUndergroundDirectionSession } from "./underground-direction-session.js";
import {
  MessageDrivenUndergroundDispatcher,
  UndergroundMessageDispatcherError,
} from "./underground-message-dispatcher.js";

test("message-driven underground session emits stage events from handler agents", () => {
  const result = runUndergroundDirectionSession("Build a small deterministic helper.");
  const fromIdByType = new Map(result.runtime.eventLog.list().map((entry) => [entry.type, entry.message.from.id]));

  assert.equal(fromIdByType.get("goal.received"), "user");
  assert.equal(fromIdByType.get("underground.exploration_planned"), "underground-intent-core");
  assert.equal(fromIdByType.get("rootlet_cluster.started"), "underground-growth-governor");
  assert.equal(fromIdByType.get("exploration_candidate.produced"), "underground-rootlet-option");
  assert.equal(fromIdByType.get("candidate_pool.updated"), "underground-candidate-pool");
  assert.equal(fromIdByType.get("convergence_review.completed"), "underground-convergence-judge");
  assert.equal(fromIdByType.get("direction_handoff.completed"), "underground-handoff-steward");
});

test("dispatcher processes repeated goal messages once for a trace", () => {
  const runtime = createMinimalRuntime();
  const dispatcher = new MessageDrivenUndergroundDispatcher({ runtime });
  try {
    const firstGoalMessage = createGoalReceivedMessage({
      traceId: "trace-repeat",
      goalId: "goal-repeat",
      goal: "Build a small deterministic helper.",
    });
    const repeatedPhaseMessage = createGoalReceivedMessage({
      traceId: "trace-repeat",
      goalId: "goal-repeat",
      goal: "Build a small deterministic helper.",
    });

    runtime.bus.publish(firstGoalMessage);
    runtime.bus.publish(firstGoalMessage);
    runtime.bus.publish(repeatedPhaseMessage);

    const result = dispatcher.dispatchUntilIdle();

    assert.notEqual(result, undefined);
    assert.equal(result?.dispatchSteps, 6);
    assert.equal(countEvents(runtime, "goal.received"), 3);
    assert.equal(countEvents(runtime, "underground.exploration_planned"), 1);
    assert.equal(countEvents(runtime, "direction_handoff.completed"), 1);
  } finally {
    dispatcher.dispose();
  }
});

test("dispatcher max step guard stops recursive message dispatch", () => {
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
    assert.equal(countEvents(runtime, "underground.exploration_planned"), 1);
    assert.equal(countEvents(runtime, "rootlet_cluster.started"), 0);
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

test("dispatcher rejects same-trace stage messages not published by the expected handler", () => {
  const runtime = createMinimalRuntime();
  const dispatcher = new MessageDrivenUndergroundDispatcher({ runtime });
  try {
    runtime.bus.publish(
      createGoalReceivedMessage({
        traceId: "trace-forged-stage",
        goalId: "goal-forged-stage",
        goal: "Build a small deterministic helper.",
      })
    );
    runtime.bus.publish(
      createMessage({
        traceId: "trace-forged-stage",
        from: { id: "test-driver", role: "underground_center" },
        to: { group: "underground-center" },
        type: "underground.exploration_planned",
        intent: "plan_underground_exploration",
        payload: {
          goalId: "goal-forged-stage",
          planId: "forged-plan",
        },
      })
    );

    assert.throws(() => dispatcher.dispatchUntilIdle(), {
      name: "UndergroundMessageDispatcherError",
      message: /must be published by underground-intent-core/,
    });
    assert.equal(countEvents(runtime, "rootlet_cluster.started"), 0);
    assert.equal(countEvents(runtime, "direction_handoff.completed"), 0);
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
    assert.equal(countEvents(runtime, "rootlet_cluster.started"), 1);
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
