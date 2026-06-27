/**
 * @deprecated 测试废弃候选（T4-1 / ADR-0025 deep 一期）— 随被测 ①/②/②' 废弃候选代码一并退役。
 *
 * 闭环4 §8.1 阶段②：被测代码迁移到 DeepRuntime 后，本测试随之迁移或退役；
 * 当前保持运行不阻塞构建。
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Constraint } from "../../domain/contracts.js";
import { ROOTLET_CLUSTER_KINDS, type GoalIntentProfile, type RootletClusterKind } from "../../domain/underground/index.js";
import { buildUndergroundRootletCandidateAdviceMessages } from "./intelligence-prompts.js";

const KIND_MARKERS: Record<RootletClusterKind, readonly string[]> = {
  option: ["tradeoffs", "applicability"],
  risk: ["impactScope", "severity", "mitigation"],
  asset_fit: ["assetRefs", "fitConditions", "doNotApplyWhen"],
  evidence: ["evidenceType", "confidence"],
  constraint: ["constraintLevel", "enforcementGate"],
  counterfactual: ["alternativeDirection", "whyNotChosen"],
};

test("rootlet AI prompts include goal profile, constraints, budget, and kind-specific instructions", () => {
  for (const kind of ROOTLET_CLUSTER_KINDS) {
    const messages = buildUndergroundRootletCandidateAdviceMessages({
      goal: "Build a task platform with tests, monitoring, no database, and counterfactual alternatives.",
      goalIntentProfile: makeGoalIntentProfile(),
      cluster: makeCluster(kind),
      constraints: [makeConstraint()],
    });
    const content = messages.map((message) => message.content).join("\n");

    assert.match(content, /Raw goal:/);
    assert.match(content, /GoalIntentProfile:/);
    assert.match(content, /goalStatement: Build a task platform/);
    assert.match(content, /keyConcepts: task_management; testing; monitoring/);
    assert.match(content, /domainConcepts: task_management/);
    assert.match(content, /nonGoals: Do not use a database/);
    assert.match(content, /acceptanceCriteria: Tests pass/);
    assert.match(content, /assumptions: Current runtime is in-memory/);
    assert.match(content, /unknowns: Deployment boundary is unknown/);
    assert.match(content, /ConstraintRef constraint-no-db/);
    assert.match(content, /gate=direction_handoff/);
    assert.match(content, new RegExp(`kind: ${kind}`));
    assert.match(content, /cluster budget maxCandidateOutputs: 3/);
    assert.match(content, /exitCriteria: Rootlet must return bounded candidates/);
    assert.match(content, /candidate advice only/i);
    assert.match(content, /Approve or finalize a Plan/);
    assert.match(content, /search.*read.*gather real evidence/);
    assert.match(content, /Research workflow:/);
    assert.match(content, /always search before speculating/i);
    assert.match(content, /search/);
    assert.match(content, /read/);
    assert.match(content, /real-world cases/);
    assert.match(content, /historical similar runs/);
    assert.match(content, /QUALITY REQUIREMENTS/);
    assert.match(content, /NON-GOALS/);
    assert.match(content, /ACCEPTANCE CRITERIA/);
    for (const marker of KIND_MARKERS[kind]) {
      assert.match(content, new RegExp(marker));
    }
  }
});

function makeGoalIntentProfile(): GoalIntentProfile {
  return {
    goalId: "goal-test",
    rawGoal: "Build a task platform with tests, monitoring, no database, and counterfactual alternatives.",
    goalStatement: "Build a task platform.",
    keyConcepts: ["task_management", "testing", "monitoring"],
    domainConcepts: ["task_management"],
    nonGoals: ["Do not use a database."],
    acceptanceCriteria: ["Tests pass."],
    assumptions: ["Current runtime is in-memory."],
    riskHints: ["data_persistence"],
    constraintHints: ["goal:non_goal"],
    unknowns: ["Deployment boundary is unknown."],
    createdAt: "2026-05-03T00:00:00.000Z",
  };
}

function makeCluster(kind: RootletClusterKind) {
  return {
    clusterId: `rootlet-${kind}`,
    kind,
    stewardRole: "intent_core" as const,
    objective: `Run ${kind} rootlet.`,
    inputRefs: ["goal-test"],
    exitCriteria: ["Rootlet must return bounded candidates."],
    status: "started" as const,
    budget: { maxCandidateOutputs: 3 },
  };
}

function makeConstraint(): Constraint {
  return {
    id: "constraint-no-db",
    source: "user",
    type: "technical",
    level: "hard",
    statement: "Do not use a database.",
    owner: "user",
    appliesTo: ["direction_handoff"],
    enforcementGate: "direction_handoff",
    status: "active",
    conflictPolicy: "block",
    evidenceRefs: ["goal.received"],
  };
}
