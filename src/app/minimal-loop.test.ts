import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  createApprovedDirectionHandoff,
  DirectionHandoffConvergenceError,
} from "../domain/agentarbor/direction-handoff.js";
import {
  DIRECTION_HANDOFF_PACKAGE_FILES,
  DirectionHandoffPackageValidationError,
  FileSystemDirectionHandoffPackageStore,
} from "../domain/agentarbor/direction-handoff-package.js";
import type {
  Constraint,
  ConvergenceReview,
  DirectionHandoff,
  DirectionHandoffPackage,
  ExplorationCandidateRef,
} from "../domain/contracts.js";
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

test("loads and validates an approved DirectionHandoffPackage before planning", () => {
  const result = runMinimalLoop();

  assert.equal(result.loadedDirectionHandoffPackage.manifest.directionId, result.directionHandoff.id);
  assert.equal(result.loadedDirectionHandoffPackage.manifest.directionVersion, result.directionHandoff.version);
  assert.equal(result.loadedDirectionHandoffPackage.manifest.status, "approved");
  assert.equal(result.loadedDirectionHandoffPackage.validation.passed, true);
  assert.deepEqual(result.loadedDirectionHandoffPackage.validation.warnings, []);
  assert.deepEqual(result.runtime.directionHandoffPackageStore.listVersions(result.directionHandoff.id), [1]);
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

test("aboveground planner blocks draft and awaiting_user DirectionHandoffPackages", () => {
  const result = runMinimalLoop();
  const planner = new AbovegroundPlanner();

  for (const status of ["draft", "awaiting_user"] as const) {
    const blockedPackage = clonePackage(result.directionHandoffPackage);
    blockedPackage.directionHandoff.status = status;
    blockedPackage.manifest.status = status;
    result.runtime.directionHandoffPackageStore.save(blockedPackage);

    assert.throws(
      () =>
        planner.plan(
          blockedPackage.manifest.directionId,
          blockedPackage.manifest.directionVersion,
          "trace-test",
          result.runtime
        ),
      DirectionHandoffPackageValidationError
    );
  }
});

test("aboveground planner rejects ad-hoc DirectionHandoff material", () => {
  const result = runMinimalLoop();
  const planner = new AbovegroundPlanner();

  assert.throws(
    () =>
      (planner as unknown as {
        plan(directionId: unknown, version: number, traceId: string, runtime: typeof result.runtime): unknown;
      }).plan(result.directionHandoff, result.directionHandoff.version, "trace-test", result.runtime),
    StateGuardError
  );
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

test("package validation fails without a convergence review ref", () => {
  const result = runMinimalLoop();
  const invalidPackage = clonePackage(result.directionHandoffPackage);
  invalidPackage.directionHandoff.convergenceReviewRef = "";

  const validation = result.runtime.directionHandoffPackageStore.validate(invalidPackage);

  assert.equal(validation.passed, false);
  assert.equal(validation.errors.some((error) => error.code === "MISSING_CONVERGENCE_REVIEW_REF"), true);
});

test("package validation fails without source candidate refs", () => {
  const result = runMinimalLoop();
  const invalidPackage = clonePackage(result.directionHandoffPackage);
  invalidPackage.directionHandoff.sourceCandidateRefs = [];
  invalidPackage.candidateReferenceIndex = [];

  const validation = result.runtime.directionHandoffPackageStore.validate(invalidPackage);

  assert.equal(validation.passed, false);
  assert.equal(validation.errors.some((error) => error.code === "MISSING_SOURCE_CANDIDATE_REFS"), true);
});

test("package validation fails with unconverged candidates", () => {
  const result = runMinimalLoop();
  const invalidPackage = clonePackage(result.directionHandoffPackage);
  invalidPackage.directionHandoff.sourceCandidateRefs = invalidPackage.directionHandoff.sourceCandidateRefs.map((candidate) => ({
    ...candidate,
    status: "candidate",
  }));

  const validation = result.runtime.directionHandoffPackageStore.validate(invalidPackage);

  assert.equal(validation.passed, false);
  assert.equal(validation.errors.some((error) => error.code === "UNCONVERGED_SOURCE_CANDIDATES"), true);
});

test("package validation fails when Soil asset content is inlined", () => {
  const result = runMinimalLoop();
  const invalidPackage = clonePackage(result.directionHandoffPackage);
  (invalidPackage.directionHandoff as unknown as { soilRefs: unknown[] }).soilRefs = [
    { ref: "soil:minimal-constraints", content: "inline Soil asset body is forbidden" },
  ];

  const validation = result.runtime.directionHandoffPackageStore.validate(invalidPackage);

  assert.equal(validation.passed, false);
  assert.equal(validation.errors.some((error) => error.code === "INLINE_SOIL_ASSET_CONTENT"), true);
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

test("file-system DirectionHandoffPackage store round-trips through a temp directory", () => {
  const result = runMinimalLoop();
  const tempRoot = mkdtempSync(join(tmpdir(), "agentarbor-direction-package-"));

  try {
    const store = new FileSystemDirectionHandoffPackageStore(tempRoot);
    const saved = store.save(result.directionHandoffPackage);
    const loaded = store.load(saved.manifest.directionId, saved.manifest.directionVersion);

    assert.equal(loaded.validation.passed, true);
    assert.deepEqual(store.listVersions(saved.manifest.directionId), [saved.manifest.directionVersion]);

    for (const file of DIRECTION_HANDOFF_PACKAGE_FILES) {
      assert.equal(
        existsSync(
          join(
            tempRoot,
            "directions",
            encodeURIComponent(saved.manifest.directionId),
            `v${saved.manifest.directionVersion}`,
            file.path
          )
        ),
        true,
        `${file.path} should be written in the temp package directory`
      );
    }
  } finally {
    if (tempRoot.startsWith(tmpdir())) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

test("default demo path keeps DirectionHandoffPackage in memory and does not create repo-root .agentarbor assets", () => {
  const repoRootAgentArbor = resolve(process.cwd(), ".agentarbor");
  const before = snapshotTree(repoRootAgentArbor);

  const result = runMinimalLoop();

  assert.equal(result.runtime.directionHandoffPackageStore.constructor.name, "InMemoryDirectionHandoffPackageStore");
  assert.deepEqual(snapshotTree(repoRootAgentArbor), before);
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

function clonePackage(pkg: DirectionHandoffPackage): DirectionHandoffPackage {
  return JSON.parse(JSON.stringify(pkg)) as DirectionHandoffPackage;
}

function snapshotTree(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const entries: string[] = [];
  const walk = (current: string, relativePrefix: string): void => {
    for (const name of readdirSync(current).sort()) {
      const absolutePath = join(current, name);
      const relativePath = relativePrefix === "" ? name : `${relativePrefix}/${name}`;
      const stats = statSync(absolutePath);
      entries.push(`${relativePath}:${stats.isDirectory() ? "dir" : "file"}:${stats.size}:${stats.mtimeMs}`);
      if (stats.isDirectory()) {
        walk(absolutePath, relativePath);
      }
    }
  };

  walk(root, "");
  return entries;
}
