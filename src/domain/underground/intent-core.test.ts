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

test("Intent Core extracts richer Chinese product concepts and derived acceptance criteria", () => {
  const profile = createGoalIntentProfile({
    goalId: "goal-product-concepts",
    rawGoal: "构建任务管理平台，支持用户管理和任务管理，包含测试和监控；不接数据库；默认使用内存实现。",
    constraints,
    createdAt: "2026-05-02T00:00:00.000Z",
  });

  assert.equal(profile.keyConcepts.includes("task_management"), true);
  assert.equal(profile.keyConcepts.includes("user_management"), true);
  assert.equal(profile.domainConcepts.includes("task_management"), true);
  assert.equal(profile.keyConcepts.includes("monitoring"), true);
  assert.equal(profile.nonGoals.some((item) => item.includes("不接数据库")), true);
  assert.equal(profile.acceptanceCriteria.includes("The system must be built and functional."), true);
  assert.equal(profile.acceptanceCriteria.includes("All specified features must be supported."), true);
  assert.equal(profile.acceptanceCriteria.includes("Tests must pass and verification must succeed."), true);
  assert.equal(profile.riskHints.includes("data_persistence"), false);
});

test("Intent Core handles English casing in derived criteria and risk hints", () => {
  const profile = createGoalIntentProfile({
    goalId: "goal-english-casing",
    rawGoal: "Build an Authentication service with Security checks and Deployment verification.",
    constraints,
    createdAt: "2026-05-02T00:00:00.000Z",
  });

  assert.equal(profile.acceptanceCriteria.includes("The system must be built and functional."), true);
  assert.equal(profile.acceptanceCriteria.includes("The system must be deployable."), true);
  assert.equal(profile.riskHints.includes("authentication"), true);
  assert.equal(profile.riskHints.includes("security"), true);
});

test("dynamic rootlet selection follows richer asset, evidence, and counterfactual signals", () => {
  const profile = createGoalIntentProfile({
    goalId: "goal-richer-rootlets",
    rawGoal: "复用模板组件，补充验证证据，并给出备选方案。",
    constraints,
    createdAt: "2026-05-02T00:00:00.000Z",
  });

  assert.deepEqual(selectRootletClusterKindsForGoalIntent(profile), [
    "option",
    "asset_fit",
    "evidence",
    "counterfactual",
  ]);
});

test("Intent Core shapes Chinese meeting-minutes agent goals into a full handoff profile", () => {
  const profile = createGoalIntentProfile({
    goalId: "goal-meeting-minutes",
    rawGoal: "帮我做一个会议纪要整理 agent，需要读取会议文本、提取行动项、生成待办并保留证据。",
    constraints,
    createdAt: "2026-05-05T00:00:00.000Z",
  });

  assert.equal(profile.domainConcepts.includes("meeting_minutes"), true);
  assert.equal(profile.domainConcepts.includes("action_items"), true);
  assert.equal(profile.domainConcepts.includes("todo_items"), true);
  assert.equal(profile.domainConcepts.includes("evidence_traceability"), true);
  assert.equal(profile.keyConcepts.includes("agent"), true);
  assert.equal(
    profile.acceptanceCriteria.some((criterion) => criterion.includes("transcript ingestion")),
    true
  );
  assert.equal(
    profile.acceptanceCriteria.some((criterion) => criterion.includes("Evidence references")),
    true
  );
  assert.deepEqual(selectRootletClusterKindsForGoalIntent(profile), [
    "option",
    "risk",
    "asset_fit",
    "evidence",
    "constraint",
    "counterfactual",
  ]);
});

test("Intent Core keeps short Chinese agent goals narrow but explicit about unknowns", () => {
  const profile = createGoalIntentProfile({
    goalId: "goal-customer-qa",
    rawGoal: "做个客服质检 agent",
    constraints,
    createdAt: "2026-05-05T00:00:00.000Z",
  });

  assert.equal(profile.domainConcepts.includes("customer_service_quality_review"), true);
  assert.equal(profile.unknowns.some((unknown) => unknown.includes("客服质检规则")), true);
  assert.deepEqual(selectRootletClusterKindsForGoalIntent(profile), [
    "option",
    "risk",
    "evidence",
    "constraint",
  ]);
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

test("candidate comparison rejects candidates unrelated to the source goal", () => {
  const profile = createGoalIntentProfile({
    goalId: "goal-relevance",
    rawGoal: "帮我做一个会议纪要整理 agent，需要读取会议文本、提取行动项、生成待办并保留证据。",
    constraints,
    createdAt: "2026-05-05T00:00:00.000Z",
  });
  const unrelatedOutput = {
    ...makeRootletOutput("output-unrelated", "option"),
    summary: "Weather forecast dashboard with map layers and temperature alerts.",
  };
  const unrelatedCandidate = makeCandidate("candidate-unrelated", unrelatedOutput);

  const result = compareCandidatesForGoal({
    goalProfile: profile,
    candidates: [unrelatedCandidate],
    rootletOutputs: [unrelatedOutput],
    createdAt: "2026-05-05T00:00:01.000Z",
  });

  assert.equal(result.comparisons[0]?.conclusion, "reject");
  assert.equal(result.decisions[0]?.status, "rejected");
  assert.equal(result.comparisons[0]?.goalMatch, "blocking");
});

test("candidate comparison rejects generic candidates with no goal concept match", () => {
  const profile = createGoalIntentProfile({
    goalId: "goal-generic-relevance",
    rawGoal: "做个客服质检 agent",
    constraints,
    createdAt: "2026-05-05T00:00:00.000Z",
  });
  const genericOutput = {
    ...makeRootletOutput("output-generic", "option"),
    summary: "Create a useful agent workflow with clear steps and helpful outputs.",
  };
  const genericCandidate = makeCandidate("candidate-generic", genericOutput);

  const result = compareCandidatesForGoal({
    goalProfile: profile,
    candidates: [genericCandidate],
    rootletOutputs: [genericOutput],
    createdAt: "2026-05-05T00:00:01.000Z",
  });

  assert.equal(result.comparisons[0]?.conclusion, "reject");
  assert.equal(result.decisions[0]?.status, "rejected");
});

test("candidate comparison accepts legitimate Chinese goal concept matches", () => {
  const profile = createGoalIntentProfile({
    goalId: "goal-chinese-relevance",
    rawGoal: "帮我做一个会议纪要整理 agent，需要读取会议文本、提取行动项、生成待办并保留证据。",
    constraints,
    createdAt: "2026-05-05T00:00:00.000Z",
  });
  const relevantOutput = {
    ...makeRootletOutput("output-chinese-relevant", "option"),
    summary: "会议纪要整理方向：读取会议文本，提取行动项，生成待办，并保留证据引用。",
  };
  const relevantCandidate = makeCandidate("candidate-chinese-relevant", relevantOutput);

  const result = compareCandidatesForGoal({
    goalProfile: profile,
    candidates: [relevantCandidate],
    rootletOutputs: [relevantOutput],
    createdAt: "2026-05-05T00:00:01.000Z",
  });

  assert.equal(result.comparisons[0]?.conclusion, "accept");
  assert.equal(result.decisions[0]?.status, "accepted");
});

function makeRootletOutput(outputId: string, kind: RootletOutput["kind"]): RootletOutput {
  return {
    outputId,
    invocationId: `invocation-${outputId}`,
    clusterId: `rootlet-${kind.replace("_", "-")}`,
    kind,
    producedByAgentId: "underground-analyzer",
    summary: "Build a deterministic helper risk output.",
    sourceRefs: ["goal.received"],
    evidenceRefs: [],
    soilAssetFitRefs: [],
    constraintRefs: [],
    riskRefs: [],
    status: "produced",
    source: "deterministic_fallback",
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
