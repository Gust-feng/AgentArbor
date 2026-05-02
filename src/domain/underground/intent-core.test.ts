import assert from "node:assert/strict";
import test from "node:test";
import { createMinimalSoilConstraints } from "../soil/index.js";
import {
  compareCandidatesForGoal,
  createGoalIntentProfile,
  selectRootletClusterKindsForGoalIntent,
  type ExplorationCandidateRef,
  type RootletOutput,
} from "./index.js";

const constraints = createMinimalSoilConstraints();

test("Intent Core derives profile fields from deterministic goal keywords", () => {
  const profile = createGoalIntentProfile({
    goalId: "goal-intent-test",
    rawGoal:
      "实现地下闭环，必须有验收证据；不要接 UI，不需要数据库；风险和权限边界待确认；默认使用内存实现。",
    constraints,
    createdAt: "2026-05-02T00:00:00.000Z",
  });

  assert.equal(profile.goalStatement.includes("实现地下闭环"), true);
  assert.equal(profile.keyConcepts.includes("evidence"), true);
  assert.equal(profile.nonGoals.some((item) => item.includes("不要接 UI")), true);
  assert.equal(profile.acceptanceCriteria.some((item) => item.includes("验收证据")), true);
  assert.equal(profile.assumptions.some((item) => item.includes("默认使用内存实现")), true);
  assert.equal(profile.riskHints.includes("risk"), true);
  assert.equal(profile.riskHints.includes("permission"), true);
  assert.equal(profile.constraintHints.some((hint) => hint.includes("constraint-minimal-runtime-only")), true);
  assert.equal(profile.unknowns.some((unknown) => unknown.includes("待确认")), true);
});

test("dynamic rootlet selection starts simple goals without all six clusters", () => {
  const simpleProfile = createGoalIntentProfile({
    goalId: "goal-simple",
    rawGoal: "Build a small deterministic helper.",
    constraints,
    createdAt: "2026-05-02T00:00:00.000Z",
  });
  const complexProfile = createGoalIntentProfile({
    goalId: "goal-complex",
    rawGoal: "需要风险、安全、资产、证据、约束和反驳，并且权限未知待确认。",
    constraints,
    createdAt: "2026-05-02T00:00:00.000Z",
  });

  assert.deepEqual(selectRootletClusterKindsForGoalIntent(simpleProfile), ["option"]);
  assert.deepEqual(
    selectRootletClusterKindsForGoalIntent(complexProfile),
    ["option", "risk", "asset_fit", "evidence", "constraint", "counterfactual"]
  );
});

test("candidate comparison drives convergence differently for the same cluster kind", () => {
  const riskOutput = makeRootletOutput("output-risk", "risk");
  const riskCandidate = makeCandidate("candidate-risk", riskOutput);
  const simpleProfile = createGoalIntentProfile({
    goalId: "goal-simple-comparison",
    rawGoal: "Build a deterministic helper.",
    constraints,
    createdAt: "2026-05-02T00:00:00.000Z",
  });
  const riskProfile = createGoalIntentProfile({
    goalId: "goal-risk-comparison",
    rawGoal: "Build a deterministic helper and surface safety risk.",
    constraints,
    createdAt: "2026-05-02T00:00:00.000Z",
  });

  const simpleDecision = compareCandidatesForGoal({
    goalProfile: simpleProfile,
    candidates: [riskCandidate],
    rootletOutputs: [riskOutput],
    createdAt: "2026-05-02T00:00:00.000Z",
  }).decisions[0];
  const riskDecision = compareCandidatesForGoal({
    goalProfile: riskProfile,
    candidates: [riskCandidate],
    rootletOutputs: [riskOutput],
    createdAt: "2026-05-02T00:00:00.000Z",
  }).decisions[0];

  assert.equal(simpleDecision?.status, "rejected");
  assert.equal(riskDecision?.status, "unknown");
});

function makeRootletOutput(outputId: string, kind: RootletOutput["kind"]): RootletOutput {
  return {
    outputId,
    clusterId: `rootlet-${kind.replace("_", "-")}`,
    kind,
    producedByAgentId: "underground-analyzer",
    summary: "test output",
    sourceRefs: ["goal.received"],
    evidenceRefs: [],
    soilAssetFitRefs: [],
    constraintRefs: [],
    riskRefs: [],
    status: "produced",
  };
}

function makeCandidate(id: string, output: RootletOutput): ExplorationCandidateRef {
  return {
    id,
    kind: "observation",
    producedByAgentId: "underground-analyzer",
    clusterId: output.clusterId,
    sourceRefs: [output.outputId],
    status: "candidate",
  };
}
