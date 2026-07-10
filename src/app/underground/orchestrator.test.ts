/**
 * @deprecated 测试废弃候选（T4-1 / ADR-0025 deep 一期）— 随被测 ①/②/②' 废弃候选代码一并退役。
 *
 * 闭环4 §8.1 阶段②：被测代码迁移到 DeepRuntime 后，本测试随之迁移或退役；
 * 当前保持运行不阻塞构建。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createId } from "../../kernel/id.js";
import { createMessage } from "../../kernel/messages/create-message.js";
import { createMinimalRuntime } from "../runtime.js";
import { createUndergroundAiRuntimeConfig } from "../underground-ai-runtime.js";
import { runUndergroundDirectionSessionWithIntelligence } from "./compat/underground-direction-session.js";
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
  assert.equal(result.orchestratorRun.route, "underground_cognitive_runtime");
  assert.equal(result.orchestratorRun.managerDecisions.includes("stop"), true);
  assert.equal(result.orchestratorRun.agentLoopIds.length >= 6, true);
  assert.equal(result.orchestratorRun.agentLoopIds[0], "underground-intent-core");
  assert.equal(result.orchestratorRun.agentRunTree.rootAgentId, "underground-center-manager");
  assert.equal(result.orchestratorRun.parentSynthesisRefs.length >= 1, true);
  assert.equal(typeof result.orchestratorRun.guardedStatuses["underground-intent-core"], "string");
  assert.equal(runtime.eventLog.types().includes("direction_handoff.completed"), false);
});

test("runUndergroundDirectionSession exposes the ADR-0021 orchestrator trace while preserving compatibility output", async () => {
  const result = await runFakeUndergroundDirectionSession("Build a small deterministic helper.");

  assert.equal(result.terminalStatus, "approved_package_created");
  assert.equal(result.undergroundOrchestratorRun.route, "underground_cognitive_runtime");
  assert.equal(result.loadedDirectionHandoffPackage.validation.passed, true);
  assert.equal(result.undergroundReport.agentRunTree?.rootAgentId, "underground-center-manager");
  assert.equal(
    result.undergroundReport.agentRunTree?.childRuns.length,
    result.undergroundReport.plan.rootletClusters.length
  );
  assert.equal(result.undergroundReport.agentRunTree?.parentSyntheses.length, 1);
  assert.equal(result.observationSnapshot.underground.agentRunTree?.childRuns.length, result.undergroundReport.plan.rootletClusters.length);
  assert.equal(result.eventTypes.includes("agent.delegation.planned"), true);
  assert.equal(result.eventTypes.includes("agent.child.started"), true);
  assert.equal(result.eventTypes.includes("agent.child.completed"), true);
  assert.equal(result.eventTypes.includes("agent.parent_synthesis.completed"), true);
  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.requested").length >= 5, true);
  const purposes = modelRequestPurposes(result.runtime.eventLog.list());
  assert.deepEqual(purposes.slice(0, 2), [
    "intent_profile",
    "growth_governance",
  ]);
  assert.equal(purposes.includes("handoff_narrative"), true);
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

function modelRequestPurposes(
  entries: ReturnType<ReturnType<typeof createMinimalRuntime>["eventLog"]["list"]>
): string[] {
  return entries
    .filter((entry) => entry.type === "model.requested")
    .map((entry) => {
      const payload = entry.message.payload as { purpose?: string };
      return payload.purpose ?? "unknown";
    });
}
