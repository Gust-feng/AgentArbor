import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  DIRECTION_HANDOFF_PACKAGE_FILES,
  FileSystemDirectionHandoffPackageStore,
  InMemoryDirectionHandoffPackageStore,
} from "./direction-handoff-package.js";
import {
  clonePackage,
  createAwaitingUserDirectionHandoffPackageFixture,
  createDirectionHandoffPackageFixture,
  tamperAwaitingUserPackageToApprovedShape,
} from "./test-fixtures.js";

test("validates and lists an approved DirectionHandoffPackage", () => {
  const { directionHandoff, directionHandoffPackage } = createDirectionHandoffPackageFixture();
  const store = new InMemoryDirectionHandoffPackageStore();
  const saved = store.save(directionHandoffPackage);

  assert.equal(saved.manifest.directionId, directionHandoff.id);
  assert.equal(saved.manifest.directionVersion, directionHandoff.version);
  assert.equal(saved.manifest.status, "approved");
  assert.equal(saved.validation.passed, true);
  assert.deepEqual(saved.validation.warnings, []);
  assert.equal(saved.lineage.revisionReason, "initial");
  assert.equal(saved.lineage.current.packageId, saved.manifest.packageId);
  assert.equal(saved.lineage.previous, undefined);
  assert.deepEqual(store.listVersions(directionHandoff.id), [1]);
});

test("package validation fails without a convergence review ref", () => {
  const { directionHandoffPackage } = createDirectionHandoffPackageFixture();
  const invalidPackage = clonePackage(directionHandoffPackage);
  invalidPackage.directionHandoff.convergenceReviewRef = "";

  const validation = new InMemoryDirectionHandoffPackageStore().validate(invalidPackage);

  assert.equal(validation.passed, false);
  assert.equal(validation.errors.some((error) => error.code === "MISSING_CONVERGENCE_REVIEW_REF"), true);
});

test("package validation fails without source candidate refs", () => {
  const { directionHandoffPackage } = createDirectionHandoffPackageFixture();
  const invalidPackage = clonePackage(directionHandoffPackage);
  invalidPackage.directionHandoff.sourceCandidateRefs = [];
  invalidPackage.candidateReferenceIndex = [];

  const validation = new InMemoryDirectionHandoffPackageStore().validate(invalidPackage);

  assert.equal(validation.passed, false);
  assert.equal(validation.errors.some((error) => error.code === "MISSING_SOURCE_CANDIDATE_REFS"), true);
});

test("package validation fails with unconverged candidates", () => {
  const { directionHandoffPackage } = createDirectionHandoffPackageFixture();
  const invalidPackage = clonePackage(directionHandoffPackage);
  invalidPackage.directionHandoff.sourceCandidateRefs = invalidPackage.directionHandoff.sourceCandidateRefs.map((candidate) => ({
    ...candidate,
    status: "candidate",
  }));

  const validation = new InMemoryDirectionHandoffPackageStore().validate(invalidPackage);

  assert.equal(validation.passed, false);
  assert.equal(validation.errors.some((error) => error.code === "UNCONVERGED_SOURCE_CANDIDATES"), true);
});

test("package validation rejects awaiting_user package tampered into approved status with convergence evidence intact", () => {
  const { directionHandoffPackage } = createAwaitingUserDirectionHandoffPackageFixture();
  const tamperedPackage = tamperAwaitingUserPackageToApprovedShape(directionHandoffPackage);

  const validation = new InMemoryDirectionHandoffPackageStore().validate(tamperedPackage);

  assert.equal(validation.passed, false);
  for (const code of [
    "APPROVED_CONVERGENCE_HAS_CLARIFICATION_OPEN_QUESTION",
    "APPROVED_CONVERGENCE_HAS_BLOCKING_OPEN_QUESTION",
    "APPROVED_CONVERGENCE_REQUIRES_USER_CLARIFICATION",
  ]) {
    assert.equal(validation.errors.some((error) => error.code === code), true, `${code} should fail validation`);
  }
  for (const code of [
    "APPROVED_HANDOFF_HAS_MISSING_INFORMATION",
    "APPROVED_HANDOFF_REQUIRES_USER_DECISION",
    "APPROVED_HANDOFF_OPTION_HAS_UNKNOWNS",
    "APPROVED_HANDOFF_OPTION_HAS_CLARIFICATION_BLOCKER",
    "APPROVED_HANDOFF_HAS_USER_DECISION_RISK",
    "APPROVED_HANDOFF_HAS_CLARIFICATION_ESCALATION",
  ]) {
    assert.equal(validation.errors.some((error) => error.code === code), false, `${code} should have been cleaned`);
  }
});

test("package validation allows non-blocking unknown evidence that is not part of approved handoff candidates", () => {
  const { directionHandoffPackage } = createDirectionHandoffPackageFixture();
  const approvedPackageWithOpenUnknown = clonePackage(directionHandoffPackage);
  approvedPackageWithOpenUnknown.convergenceReview.unknownCandidateRefs = ["candidate-nonblocking-unknown"];
  approvedPackageWithOpenUnknown.convergenceReview.openQuestions = [
    {
      candidateId: "candidate-nonblocking-unknown",
      reason: "critical_fact_missing",
      question: "Keep this non-blocking uncertainty visible for later review.",
      blockingLevel: "non_blocking",
      disposition: "remain_open",
      evidenceRefs: [],
    },
  ];

  const validation = new InMemoryDirectionHandoffPackageStore().validate(approvedPackageWithOpenUnknown);

  assert.equal(validation.passed, true);
});

test("package validation rejects approved convergence when unknown candidates overlap handoff candidates", () => {
  const { candidate, directionHandoffPackage } = createDirectionHandoffPackageFixture();
  const invalidPackage = clonePackage(directionHandoffPackage);
  invalidPackage.convergenceReview.unknownCandidateRefs = [candidate.id];

  const validation = new InMemoryDirectionHandoffPackageStore().validate(invalidPackage);

  assert.equal(validation.passed, false);
  assert.equal(
    validation.errors.some((error) => error.code === "APPROVED_CONVERGENCE_UNKNOWN_SOURCE_CANDIDATE"),
    true
  );
  assert.equal(
    validation.errors.some((error) => error.code === "APPROVED_CONVERGENCE_UNKNOWN_HANDOFF_CANDIDATE"),
    true
  );
});

test("package validation fails when Soil asset content is inlined", () => {
  const { directionHandoffPackage } = createDirectionHandoffPackageFixture();
  const invalidPackage = clonePackage(directionHandoffPackage);
  (invalidPackage.directionHandoff as unknown as { soilRefs: unknown[] }).soilRefs = [
    { ref: "soil:minimal-constraints", content: "inline Soil asset body is forbidden" },
  ];

  const validation = new InMemoryDirectionHandoffPackageStore().validate(invalidPackage);

  assert.equal(validation.passed, false);
  assert.equal(validation.errors.some((error) => error.code === "INLINE_SOIL_ASSET_CONTENT"), true);
});

test("package validation rejects handoff text that weakens a hard constraint", () => {
  const { directionHandoffPackage } = createDirectionHandoffPackageFixture();
  const invalidPackage = clonePackage(directionHandoffPackage);
  const hardConstraintRef = {
    constraintId: "constraint-hard-test",
    requiredLevel: "hard" as const,
    enforcementGate: "direction_handoff" as const,
  };
  invalidPackage.directionHandoff.constraintRefs.push(hardConstraintRef);
  invalidPackage.directionHandoff.assumptions.push(
    `Hard constraint ${hardConstraintRef.constraintId} can be ignored after planning starts.`
  );

  const validation = new InMemoryDirectionHandoffPackageStore().validate(invalidPackage);

  assert.equal(validation.passed, false);
  assert.equal(
    validation.errors.some((error) => error.code === "HARD_CONSTRAINT_WEAKENED_IN_HANDOFF_TEXT"),
    true
  );
});

test("package validation rejects approved handoff options unrelated to the clarified goal", () => {
  const { directionHandoffPackage } = createDirectionHandoffPackageFixture();
  const invalidPackage = clonePackage(directionHandoffPackage);
  invalidPackage.directionHandoff.clarifiedGoal =
    "会议纪要整理 agent must read meeting transcripts, extract action items, generate todos, and retain evidence.";
  invalidPackage.directionHandoff.options = invalidPackage.directionHandoff.options.map((option) => ({
    ...option,
    directionSummary: "Weather forecast dashboard with map layers and temperature alerts.",
  }));
  invalidPackage.directionHandoff.sourceCandidateRefs = invalidPackage.directionHandoff.sourceCandidateRefs.map((candidate) => ({
    ...candidate,
    summary: "Weather forecast dashboard candidate.",
  }));

  const validation = new InMemoryDirectionHandoffPackageStore().validate(invalidPackage);

  assert.equal(validation.passed, false);
  assert.equal(validation.errors.some((error) => error.code === "HANDOFF_GOAL_RELEVANCE_MISSING"), true);
});

test("package validation rejects specific but off-domain approved handoff options", () => {
  const { directionHandoffPackage } = createDirectionHandoffPackageFixture();
  const invalidPackage = clonePackage(directionHandoffPackage);
  invalidPackage.directionHandoff.clarifiedGoal =
    "会议纪要整理 agent must read meeting transcripts, extract action items, generate todos, and retain evidence. Target domain concepts: meeting_minutes, action_items, todo_items.";
  invalidPackage.directionHandoff.options = invalidPackage.directionHandoff.options.map((option) => ({
    ...option,
    directionSummary: "Invoice approval workflow routes finance bills, purchase approvals, and reimbursement exceptions.",
  }));
  invalidPackage.directionHandoff.sourceCandidateRefs = invalidPackage.directionHandoff.sourceCandidateRefs.map((candidate) => ({
    ...candidate,
    summary: "Finance approval workflow candidate with reimbursement routing.",
  }));

  const validation = new InMemoryDirectionHandoffPackageStore().validate(invalidPackage);

  assert.equal(validation.passed, false);
  assert.equal(validation.errors.some((error) => error.code === "HANDOFF_GOAL_RELEVANCE_MISSING"), true);
  assert.equal(
    validation.errors.some((error) => error.code === "HANDOFF_RETAINED_OPTION_GOAL_RELEVANCE_MISSING"),
    true
  );
});

test("package validation rejects options that only echo the goal before generic handoff text", () => {
  const { directionHandoffPackage } = createDirectionHandoffPackageFixture();
  const invalidPackage = clonePackage(directionHandoffPackage);
  invalidPackage.directionHandoff.clarifiedGoal =
    "会议纪要整理 agent must read meeting transcripts, extract action items, generate todos, and retain evidence. Target domain concepts: meeting_minutes, action_items, todo_items.";
  invalidPackage.directionHandoff.options = invalidPackage.directionHandoff.options.map((option) => ({
    ...option,
    directionSummary: `For ${invalidPackage.directionHandoff.clarifiedGoal}: create a useful agent workflow with clear steps.`,
  }));
  invalidPackage.directionHandoff.sourceCandidateRefs = invalidPackage.directionHandoff.sourceCandidateRefs.map((candidate) => ({
    ...candidate,
    summary: "Useful agent workflow candidate.",
  }));

  const validation = new InMemoryDirectionHandoffPackageStore().validate(invalidPackage);

  assert.equal(validation.passed, false);
  assert.equal(
    validation.errors.some((error) => error.code === "HANDOFF_RETAINED_OPTION_GOAL_RELEVANCE_MISSING"),
    true
  );
});

test("file-system DirectionHandoffPackage store round-trips through a temp directory", () => {
  const { directionHandoffPackage } = createDirectionHandoffPackageFixture();
  const tempRoot = mkdtempSync(join(tmpdir(), "agentarbor-direction-package-"));

  try {
    const store = new FileSystemDirectionHandoffPackageStore(tempRoot);
    const saved = store.save(directionHandoffPackage);
    const loaded = store.load(saved.manifest.directionId, saved.manifest.directionVersion);

    assert.equal(loaded.validation.passed, true);
    assert.deepEqual(loaded.lineage, saved.lineage);
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
    const packageDir = join(
      tempRoot,
      "directions",
      encodeURIComponent(saved.manifest.directionId),
      `v${saved.manifest.directionVersion}`
    );
    const direction = readFileSync(join(packageDir, "direction.md"), "utf8");
    const decisionRecord = readFileSync(join(packageDir, "decision-record.md"), "utf8");
    const riskRegister = readFileSync(join(packageDir, "risk-register.md"), "utf8");
    assert.equal(direction.includes("## Recommended Direction"), true);
    assert.equal(decisionRecord.includes("## Rationale Evidence Refs"), true);
    assert.equal(riskRegister.includes("impactScope"), true);
  } finally {
    if (tempRoot.startsWith(tmpdir())) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});
