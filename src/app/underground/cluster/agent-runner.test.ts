import assert from "node:assert/strict";
import test from "node:test";
import { runUndergroundDirectionSession } from "../../underground-direction-session.js";
import { UndergroundSharedContext, UndergroundSharedContextError } from "./shared-context.js";

test("UndergroundAgentRunner records public stage events from independent runtime units", () => {
  const result = runUndergroundDirectionSession("Build a small deterministic helper.");
  const fromIdByType = new Map(result.runtime.eventLog.list().map((entry) => [entry.type, entry.message.from.id]));
  const handoffInvocation = result.undergroundReport.agentClusterRun?.invocations.find(
    (invocation) => invocation.role === "handoff_steward"
  );

  assert.equal(fromIdByType.get("underground.exploration_planned"), "underground-intent-core");
  assert.equal(fromIdByType.get("rootlet_cluster.started"), "underground-growth-governor");
  assert.equal(fromIdByType.get("exploration_candidate.produced"), "underground-rootlet-option");
  assert.equal(fromIdByType.get("candidate_pool.updated"), "underground-candidate-pool");
  assert.equal(fromIdByType.get("convergence_review.completed"), "underground-convergence-judge");
  assert.equal(fromIdByType.get("direction_handoff.completed"), "underground-handoff-steward");
  assert.equal(handoffInvocation?.agentId, "underground-handoff-steward");
  assert.equal(handoffInvocation?.status, "completed");
  assert.equal(handoffInvocation?.inputRefs.includes(result.undergroundReport.convergenceReport.reviewId), true);
  assert.equal(handoffInvocation?.outputRefs.includes(result.directionHandoffPackageRef.packageId), true);
});

test("UndergroundAgentRunner dynamically creates only selected rootlet runtime units", () => {
  const simple = runUndergroundDirectionSession("Build a small deterministic helper.");
  const complex = runUndergroundDirectionSession("需要风险、安全、资产、证据、约束和反驳，并且权限未知待确认。");

  const simpleRootletInvocations = simple.undergroundReport.agentClusterRun?.invocations.filter(
    (invocation) => invocation.role === "rootlet_agent"
  );
  const complexRootletInvocations = complex.undergroundReport.agentClusterRun?.invocations.filter(
    (invocation) => invocation.role === "rootlet_agent"
  );

  assert.equal(simpleRootletInvocations?.length, 1);
  assert.deepEqual(simple.undergroundReport.plan.rootletClusters.map((cluster) => cluster.kind), ["option"]);
  assert.equal(complexRootletInvocations?.length, 6);
  assert.deepEqual(
    complexRootletInvocations?.map((invocation) => invocation.agentId),
    [
      "underground-rootlet-option",
      "underground-rootlet-risk",
      "underground-rootlet-asset-fit",
      "underground-rootlet-evidence",
      "underground-rootlet-constraint",
      "underground-rootlet-counterfactual",
    ]
  );
});

test("RootletAgent runs from an explicit internal invocation request without adding public EventLog steps", () => {
  const result = runUndergroundDirectionSession("需要风险、安全、资产、证据、约束和反驳，并且权限未知待确认。");
  const eventTypes = result.runtime.eventLog.types();

  assert.equal(eventTypes.filter((type) => type === "rootlet_cluster.started").length, 1);
  assert.equal(eventTypes.filter((type) => type === "exploration_candidate.produced").length, 1);
  assert.equal(result.undergroundReport.rootletOutputs.length, result.undergroundReport.plan.rootletClusters.length);
  assert.equal(
    result.undergroundReport.rootletOutputs.every((output) =>
      output.sourceRefs.some((sourceRef) => sourceRef.startsWith("rootlet-invocation-request")) &&
      output.sourceRefs.includes("rootlet.invocation_requested")
    ),
    true
  );
});

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
});
