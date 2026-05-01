import assert from "node:assert/strict";
import test from "node:test";
import type { GrowthPlan, TaskSpec } from "../../domain/aboveground/contracts.js";
import type { Constraint } from "../../domain/constraints.js";
import type { DirectionHandoff } from "../../domain/underground/contracts.js";
import {
  ConstraintBlockedError,
  StateGuardError,
  UserConfirmationRequiredError,
  assignTask,
  enterPlanning,
} from "./task-state-machine.js";

test("does not enter Planning with an unapproved DirectionHandoff", () => {
  const draftHandoff: DirectionHandoff = {
    ...minimalDirectionHandoff(),
    status: "draft",
  };

  assert.throws(() => enterPlanning(draftHandoff), StateGuardError);
});

test("does not assign a task without a GrowthPlan", () => {
  assert.throws(() => assignTask(minimalTaskSpec(), undefined, [activeHardConstraint()]), StateGuardError);
});

test("hard constraints block task assignment", () => {
  const violatedHardConstraint: Constraint = {
    id: "constraint-minimal-runtime-only",
    source: "user",
    type: "scope",
    level: "hard",
    statement: "This hard constraint is intentionally violated for test coverage.",
    owner: "user",
    appliesTo: ["minimal-runtime-kernel"],
    evidenceRefs: ["test"],
    enforcementGate: "task_assignment",
    conflictPolicy: "block",
    status: "violated",
  };

  assert.throws(
    () => assignTask(minimalTaskSpec(), minimalGrowthPlan(), [violatedHardConstraint]),
    ConstraintBlockedError
  );
});

test("hard constraints can require user confirmation", () => {
  const unapprovedHardConstraint: Constraint = {
    id: "constraint-minimal-runtime-only",
    source: "user",
    type: "human_approval",
    level: "hard",
    statement: "This hard constraint intentionally requires user confirmation for test coverage.",
    owner: "user",
    appliesTo: ["minimal-runtime-kernel"],
    evidenceRefs: ["test"],
    enforcementGate: "task_assignment",
    conflictPolicy: "ask_user",
    status: "proposed",
  };

  assert.throws(
    () => assignTask(minimalTaskSpec(), minimalGrowthPlan(), [unapprovedHardConstraint]),
    UserConfirmationRequiredError
  );
});

test("proposed hard constraints block task assignment for non-user conflict policies", () => {
  for (const conflictPolicy of [
    "block",
    "aboveground_center_decides",
    "verification_reviews",
    "governance_review",
  ] as const) {
    const proposedHardConstraint: Constraint = {
      id: "constraint-minimal-runtime-only",
      source: "user",
      type: "scope",
      level: "hard",
      statement: `This hard constraint is proposed and uses ${conflictPolicy}.`,
      owner: "user",
      appliesTo: ["minimal-runtime-kernel"],
      evidenceRefs: ["test"],
      enforcementGate: "task_assignment",
      conflictPolicy,
      status: "proposed",
    };

    assert.throws(
      () => assignTask(minimalTaskSpec(), minimalGrowthPlan(), [proposedHardConstraint]),
      ConstraintBlockedError,
      `${conflictPolicy} must not default to Assigned while proposed`
    );
  }
});

test("governance_review hard constraints require approval before assignment", () => {
  const governanceReviewConstraint: Constraint = {
    id: "constraint-minimal-runtime-only",
    source: "governance",
    type: "asset_governance",
    level: "hard",
    statement: "Governance review must approve this hard constraint before assignment.",
    owner: "governance",
    appliesTo: ["minimal-runtime-kernel"],
    evidenceRefs: ["test"],
    enforcementGate: "task_assignment",
    conflictPolicy: "governance_review",
    status: "proposed",
  };

  assert.throws(
    () => assignTask(minimalTaskSpec(), minimalGrowthPlan(), [governanceReviewConstraint]),
    ConstraintBlockedError
  );
});

function minimalDirectionHandoff(): DirectionHandoff {
  return {
    id: "direction-test",
    version: 1,
    sourceGoalId: "goal-test",
    rawUserInputRef: "goal.received",
    clarifiedGoal: "test goal",
    nonGoals: [],
    assumptions: [],
    missingInformation: [],
    soilRefs: [],
    evidenceRefs: [],
    constraintRefs: [],
    candidateConstraintRefs: [],
    risks: [],
    options: [
      {
        optionId: "option-test",
        directionSummary: "test option",
        supportingEvidenceRefs: [],
        soilAssetFitRefs: [],
        constraintImpact: [],
        riskProfile: [],
        costProfile: [],
        unknowns: [],
        whyNot: [],
        doNotChooseWhen: [],
      },
    ],
    decisionRecord: {
      retainedOptionId: "option-test",
      mergedOptionIds: [],
      rejectedOptionIds: [],
      userDecisionRequired: [],
      abovegroundReferenceOptionIds: ["option-test"],
      rationaleEvidenceRefs: [],
      rationaleConstraintRefs: [],
      rationaleRiskRefs: [],
    },
    riskRegister: [],
    sourceCandidateRefs: [
      {
        id: "candidate-test",
        kind: "claim_candidate",
        producedByAgentId: "underground-analyzer",
        clusterId: "rootlet-option",
        sourceRefs: ["rootlet-output-test"],
        status: "accepted",
      },
    ],
    convergenceReviewRef: "convergence-test",
    recommendedOptionId: "option-test",
    growthEntry: {
      allowedRuntimeShapes: ["single_agent"],
      suggestedFirstWorkflowNodes: ["generate"],
      escalationRules: [],
    },
    status: "approved",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

function minimalGrowthPlan(): GrowthPlan {
  return {
    id: "growth-plan-test",
    version: 1,
    goalId: "goal-test",
    directionHandoffId: "direction-test",
    directionHandoffVersion: 1,
    selectedOptionId: "option-test",
    pathBiasDecision: "none",
    pathBiasRationale: "test",
    workflowId: "workflow-test",
    runtimeShape: "single_agent",
    tasks: [minimalTaskSpec()],
    reuseStrategy: [],
    sedimentationStrategy: [],
    constraintRefs: [hardConstraintRef()],
    constraintDistribution: [{ taskId: "task-test", constraintRefs: [hardConstraintRef()] }],
    verificationGates: ["test"],
    nutrientRequestTriggers: [],
    createdAt: "2026-05-01T00:00:00.000Z",
  };
}

function minimalTaskSpec(): TaskSpec {
  return {
    id: "task-test",
    goalId: "goal-test",
    growthPlanId: "growth-plan-test",
    title: "Test task",
    description: "A minimal task-state-machine fixture.",
    requiredCapabilities: ["test"],
    acceptanceCriteria: ["passes"],
    constraintRefs: [hardConstraintRef()],
    status: "Draft",
    createdAt: "2026-05-01T00:00:00.000Z",
  };
}

function hardConstraintRef() {
  return {
    constraintId: "constraint-minimal-runtime-only",
    requiredLevel: "hard" as const,
    enforcementGate: "task_assignment" as const,
  };
}

function activeHardConstraint(): Constraint {
  return {
    id: "constraint-minimal-runtime-only",
    source: "user",
    type: "scope",
    level: "hard",
    statement: "This hard constraint is active for baseline assignment.",
    owner: "user",
    appliesTo: ["minimal-runtime-kernel"],
    evidenceRefs: ["test"],
    enforcementGate: "task_assignment",
    conflictPolicy: "block",
    status: "active",
  };
}
