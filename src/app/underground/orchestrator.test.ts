import assert from "node:assert/strict";
import test from "node:test";
import { createId } from "../../kernel/id.js";
import { createMessage } from "../../kernel/messages/create-message.js";
import { createMinimalRuntime } from "../runtime.js";
import { runUndergroundDirectionSession } from "../underground-direction-session.js";
import { UndergroundAgentOrchestrator } from "./orchestrator.js";

test("UndergroundAgentOrchestrator routes a representative direction flow through the AgentLoop adapter", () => {
  const runtime = createMinimalRuntime();
  const traceId = createId("trace");
  const goalId = createId("goal");
  const orchestrator = new UndergroundAgentOrchestrator({ runtime });
  const result = orchestrator.run(
    createMessage({
      traceId,
      from: { id: "user", role: "user" },
      to: { role: "underground_center" },
      type: "goal.received",
      intent: "receive_user_goal",
      payload: { goalId, goal: "Build a small deterministic helper." },
    })
  );

  assert.equal(result.terminalStatus, "approved_package_created");
  assert.equal(result.orchestratorRun.route, "agent_loop_compatibility_adapter");
  assert.equal(result.orchestratorRun.compatibilityPathUsed, true);
  assert.deepEqual(result.orchestratorRun.agentLoopIds, ["underground-direction-session-compatibility-adapter"]);
  assert.equal(result.orchestratorRun.guardedStatus, "accepted");
  assert.equal(runtime.eventLog.types().includes("direction_handoff.completed"), true);
});

test("runUndergroundDirectionSession exposes the ADR-0021 orchestrator trace while preserving compatibility output", () => {
  const result = runUndergroundDirectionSession("Build a small deterministic helper.");

  assert.equal(result.terminalStatus, "approved_package_created");
  assert.equal(result.undergroundOrchestratorRun.route, "agent_loop_compatibility_adapter");
  assert.equal(result.undergroundOrchestratorRun.compatibilityPathUsed, true);
  assert.equal(result.loadedDirectionHandoffPackage.validation.passed, true);
});

test("UndergroundAgentOrchestrator creates a distinct run trace for each invocation", () => {
  const orchestrator = new UndergroundAgentOrchestrator({ runtime: createMinimalRuntime() });
  const firstTraceId = createId("trace");
  const secondTraceId = createId("trace");

  const first = orchestrator.run(
    createMessage({
      traceId: firstTraceId,
      from: { id: "user", role: "user" },
      to: { role: "underground_center" },
      type: "goal.received",
      intent: "receive_user_goal",
      payload: { goalId: createId("goal"), goal: "First direction." },
    })
  );
  const second = orchestrator.run(
    createMessage({
      traceId: secondTraceId,
      from: { id: "user", role: "user" },
      to: { role: "underground_center" },
      type: "goal.received",
      intent: "receive_user_goal",
      payload: { goalId: createId("goal"), goal: "Second direction." },
    })
  );

  assert.notEqual(first.orchestratorRun.orchestratorRunId, second.orchestratorRun.orchestratorRunId);
});
