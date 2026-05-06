import assert from "node:assert/strict";
import test from "node:test";
import { createUndergroundAiRuntimeConfig } from "../../intelligence-channel-factory.js";
import { runUndergroundDirectionSessionWithIntelligence } from "../../underground-direction-session.js";
import { UndergroundSharedContext, UndergroundSharedContextError } from "./shared-context.js";

test("UndergroundAgentRunner records the direction handoff completion event from the cognitive manager", async () => {
  const result = await runFakeUndergroundDirectionSession("Build a small deterministic helper.");
  const eventTypes = result.runtime.eventLog.types();

  assert.equal(eventTypes.includes("direction_handoff.completed"), true);
  assert.equal(result.terminalStatus, "approved_package_created");
  assert.equal(result.undergroundReport.agentClusterRun, undefined);
});

test("UndergroundAgentRunner dynamically creates only selected rootlet kinds in the exploration plan", async () => {
  const simple = await runFakeUndergroundDirectionSession("Build a small deterministic helper.");
  const complex = await runFakeUndergroundDirectionSession("需要风险、安全、资产、证据、约束和反驳，并且权限未知待确认。");

  assert.deepEqual(simple.undergroundReport.plan.rootletClusters.map((cluster) => cluster.kind), ["option"]);
  assert.equal(simple.undergroundReport.agentClusterRun, undefined);
  assert.equal(complex.undergroundReport.agentClusterRun, undefined);
  assert.deepEqual(
    complex.undergroundReport.plan.rootletClusters.map((cluster) => cluster.kind),
    ["option", "risk", "asset_fit", "evidence", "constraint", "counterfactual"]
  );
});

test("RootletAgent produces rootlet outputs within budget without agentClusterRun", async () => {
  const result = await runFakeUndergroundDirectionSession("需要风险、安全、资产、证据、约束和反驳，并且权限未知待确认。");

  assert.equal(result.undergroundReport.agentClusterRun, undefined);
  assert.equal(
    result.undergroundReport.rootletOutputs.length > result.undergroundReport.plan.rootletClusters.length,
    true
  );
  assert.equal(
    result.undergroundReport.rootletOutputs.length <= result.undergroundReport.plan.budget.maxCandidateOutputs,
    true
  );
  assert.equal(result.undergroundReport.candidatePool.candidatesByKind.option.length, 2);
  assert.equal(result.undergroundReport.candidatePool.candidatesByKind.risk.length, 2);
  assert.equal(result.undergroundReport.candidatePool.candidatesByKind.asset_fit.length, 2);
  assert.equal(result.undergroundReport.candidatePool.candidatesByKind.evidence.length, 2);
  assert.equal(result.undergroundReport.candidatePool.candidatesByKind.constraint.length, 2);
  assert.equal(result.undergroundReport.candidatePool.candidatesByKind.counterfactual.length, 2);
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

test("UndergroundSharedContext enforces write ownership for stage fields", () => {
  const shared = new UndergroundSharedContext();

  assert.throws(
    () => shared.write("underground-intent-core", { candidatePool: {} as never }),
    UndergroundSharedContextError
  );
  assert.throws(
    () => shared.write("underground-candidate-pool", { convergenceReport: {} as never }),
    UndergroundSharedContextError
  );
  assert.throws(
    () => shared.write("underground-handoff-steward", { convergenceReport: {} as never }),
    UndergroundSharedContextError
  );
  assert.throws(
    () => shared.write("underground-handoff-steward", { autonomyReview: {} as never }),
    UndergroundSharedContextError
  );
});
