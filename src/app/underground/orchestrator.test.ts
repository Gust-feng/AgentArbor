import assert from "node:assert/strict";
import test from "node:test";
import { createId } from "../../kernel/id.js";
import { createMessage } from "../../kernel/messages/create-message.js";
import { createMinimalRuntime } from "../runtime.js";
import { createUndergroundAiRuntimeConfig } from "../intelligence-channel-factory.js";
import { runUndergroundDirectionSessionWithIntelligence } from "../underground-direction-session.js";
import { UndergroundAgentOrchestrator } from "./orchestrator.js";

test("UndergroundAgentOrchestrator stops instead of approving when no AgentTurnRuntime is available", async () => {
  const runtime = createMinimalRuntime();
  const traceId = createId("trace");
  const goalId = createId("goal");
  const orchestrator = new UndergroundAgentOrchestrator({ runtime });
  const result = await orchestrator.run(
    createMessage({
      traceId,
      from: { id: "user", role: "user" },
      to: { role: "underground_center" },
      type: "goal.received",
      intent: "receive_user_goal",
      payload: { goalId, goal: "Build a small deterministic helper." },
    })
  );

  assert.equal(result.terminalStatus, "stopped");
  assert.equal(result.orchestratorRun.route, "cognitive_manager");
  assert.equal(result.orchestratorRun.managerDecisions.includes("stop"), true);
  assert.equal(result.orchestratorRun.agentLoopIds.length >= 6, true);
  assert.equal(result.orchestratorRun.agentLoopIds[0], "underground-intent-core");
  assert.equal(typeof result.orchestratorRun.guardedStatuses["underground-intent-core"], "string");
  assert.equal(runtime.eventLog.types().includes("direction_handoff.completed"), false);
});

test("runUndergroundDirectionSession exposes the ADR-0021 orchestrator trace while preserving compatibility output", async () => {
  const result = await runFakeUndergroundDirectionSession("Build a small deterministic helper.");

  assert.equal(result.terminalStatus, "approved_package_created");
  assert.equal(result.undergroundOrchestratorRun.route, "cognitive_manager");
  assert.equal(result.loadedDirectionHandoffPackage.validation.passed, true);
});

test("UndergroundAgentOrchestrator creates a distinct run trace for each invocation", async () => {
  const orchestrator = new UndergroundAgentOrchestrator({ runtime: createMinimalRuntime() });
  const firstTraceId = createId("trace");
  const secondTraceId = createId("trace");

  const first = await orchestrator.run(
    createMessage({
      traceId: firstTraceId,
      from: { id: "user", role: "user" },
      to: { role: "underground_center" },
      type: "goal.received",
      intent: "receive_user_goal",
      payload: { goalId: createId("goal"), goal: "First direction." },
    })
  );
  const second = await orchestrator.run(
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

async function runFakeUndergroundDirectionSession(goal: string) {
  const aiConfig = createUndergroundAiRuntimeConfig({ mode: "fake" });
  if (!aiConfig.enabled) {
    throw new Error("Expected fake AI runtime config to be enabled.");
  }
  return runUndergroundDirectionSessionWithIntelligence(goal, {
    createIntelligenceChannel: aiConfig.createIntelligenceChannel,
    createToolCenter: aiConfig.createToolCenter,
  });
}
