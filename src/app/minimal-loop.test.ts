import assert from "node:assert/strict";
import test from "node:test";
import {
  createApprovedDirectionHandoff,
  DirectionHandoffConvergenceError,
} from "../domain/agentarbor/direction-handoff.js";
import type { Constraint, ConvergenceReview, DirectionHandoff, ExplorationCandidateRef } from "../domain/contracts.js";
import { createMessage } from "../kernel/messages/create-message.js";
import { MessageBusPolicyError } from "../kernel/messages/in-memory-message-bus.js";
import {
  ConstraintBlockedError,
  StateGuardError,
  UserConfirmationRequiredError,
  assignTask,
  enterPlanning,
} from "../kernel/state-machine/task-state-machine.js";
import { AbovegroundPlanner } from "./agents.js";
import { EXPECTED_DEMO_EVENTS, runMinimalLoop } from "./minimal-loop.js";
import { createMinimalRuntime } from "./runtime.js";

test("runs the fixed minimal event sequence in order", () => {
  const result = runMinimalLoop();

  assert.deepEqual(result.eventTypes, EXPECTED_DEMO_EVENTS);
  assert.deepEqual(
    result.runtime.eventLog.replay().map((message) => message.type),
    EXPECTED_DEMO_EVENTS
  );
});

test("produces an artifact and stores its content", () => {
  const result = runMinimalLoop();

  assert.equal(result.artifact.ref.type, "document");
  assert.equal(result.runtime.artifactStore.get(result.artifact.ref.id).content.includes("Minimal AgentApp"), true);
});

test("generates a passed verification report", () => {
  const result = runMinimalLoop();

  assert.equal(result.verification.status, "passed");
  assert.equal(result.verification.checks.every((check) => check.status === "passed"), true);
});

test("captures RunMemory, ExperienceCandidate, and PathBias", () => {
  const result = runMinimalLoop();

  assert.equal(result.runMemory.sourceGoalId, result.directionHandoff.sourceGoalId);
  assert.deepEqual(result.runMemory.artifactIds, [result.artifact.ref.id]);
  assert.deepEqual(result.runMemory.actualPath, EXPECTED_DEMO_EVENTS);
  assert.equal(result.experienceCandidate.sourceRunMemoryId, result.runMemory.id);
  assert.equal(result.pathBias.sourceExperienceCandidateId, result.experienceCandidate.id);
  assert.deepEqual(result.pathBias.requiredVerificationGates, result.growthPlan.verificationGates);
});

test("does not enter Planning with an unapproved DirectionHandoff", () => {
  const result = runMinimalLoop();
  const draftHandoff: DirectionHandoff = {
    ...result.directionHandoff,
    status: "draft",
  };

  assert.throws(() => enterPlanning(draftHandoff), StateGuardError);
});

test("does not assign a task without a GrowthPlan", () => {
  const result = runMinimalLoop();

  assert.throws(() => assignTask(result.task, undefined, result.runtime.constraints), StateGuardError);
});

test("rejects a DirectionHandoff that keeps unconverged candidates", () => {
  const candidate: ExplorationCandidateRef = {
    id: "candidate-unconverged",
    kind: "claim_candidate",
    producedByAgentId: "underground-analyzer",
    clusterId: "cluster-test",
    sourceRefs: ["goal.received"],
    status: "candidate",
  };
  const review: ConvergenceReview = {
    reviewId: "review-test",
    reviewedByAgentIds: ["underground-analyzer"],
    leadAgentId: "underground-analyzer",
    crossCheckedCandidateRefs: [candidate.id],
    deduplicatedCandidateRefs: [candidate.id],
    acceptedCandidateRefs: [candidate.id],
    rejectedCandidateRefs: [],
    conflictResolutionRefs: [],
    provenanceRefs: ["goal.received"],
  };

  assert.throws(
    () =>
      createApprovedDirectionHandoff(minimalDirectionHandoff(candidate, review.reviewId), review),
    DirectionHandoffConvergenceError
  );
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

  assert.throws(() => runMinimalLoop(undefined, { constraints: [violatedHardConstraint] }), ConstraintBlockedError);
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

  assert.throws(() => runMinimalLoop(undefined, { constraints: [unapprovedHardConstraint] }), UserConfirmationRequiredError);
});

test("aboveground planner cannot create direction exploration candidates", () => {
  const planner = new AbovegroundPlanner();

  assert.throws(() => planner.createExplorationCandidate(), StateGuardError);
});

test("message bus blocks direct private messages between internal agents", () => {
  const runtime = createMinimalRuntime();

  assert.throws(
    () =>
      runtime.bus.publish(
        createMessage({
          traceId: "trace-test",
          from: { id: "aboveground-planner", role: "aboveground_center" },
          to: { id: "worker-agent" },
          type: "task.progress",
          intent: "private_chat",
          payload: {},
        })
      ),
    MessageBusPolicyError
  );
});

function minimalDirectionHandoff(
  candidate: ExplorationCandidateRef,
  convergenceReviewRef: string
): Omit<DirectionHandoff, "status"> {
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
    sourceCandidateRefs: [candidate],
    convergenceReviewRef,
    recommendedOptionId: "option-test",
    growthEntry: {
      allowedRuntimeShapes: ["single_agent"],
      suggestedFirstWorkflowNodes: ["generate"],
      escalationRules: [],
    },
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}
