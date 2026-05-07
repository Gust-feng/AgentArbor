import assert from "node:assert/strict";
import test from "node:test";
import { DirectionHandoffPackageValidationError } from "../domain/agentarbor/direction-handoff-package.js";
import { createRunObservationEventViews, resolveRunObservationPosition } from "../domain/observation/index.js";
import { AbovegroundPlanner } from "./agents.js";
import {
  EXPECTED_CLARIFICATION_REQUIRED_EVENTS,
  EXPECTED_CLARIFICATION_RECOVERY_EVENTS,
  runClarificationRecoveryFlow,
  runClarificationRequiredUndergroundFlow,
} from "./clarification-flow.js";
import { EXPECTED_DEMO_EVENTS, runMinimalLoop } from "./minimal-loop.js";

test("clarification-required underground flow produces awaiting_user handoff and user approval request", async () => {
  const result = await runClarificationRequiredUndergroundFlow();

  assert.deepEqual(result.eventTypes, EXPECTED_CLARIFICATION_REQUIRED_EVENTS);
  assert.equal(result.undergroundReport.convergenceReport.outcome, "awaiting_user");
  assert.equal(result.undergroundReport.convergenceReport.userEscalationRequired, true);
  assert.equal(result.clarificationRequest.status, "requested");
  assert.equal(result.clarificationRequest.blockingLevel, "blocking");
  assert.equal(result.clarificationRequest.primaryReason, "permission_boundary_unclear");
  assert.equal(result.loadedDirectionHandoffPackage.manifest.status, "awaiting_user");
  assert.equal(result.loadedDirectionHandoffPackage.validation.passed, false);
  assert.equal(
    result.loadedDirectionHandoffPackage.validation.errors.some(
      (error) => error.code === "DIRECTION_HANDOFF_NOT_APPROVED"
    ),
    true
  );

  const planner = new AbovegroundPlanner();
  assert.throws(
    () =>
      planner.plan(
        result.loadedDirectionHandoffPackage.manifest.directionId,
        result.loadedDirectionHandoffPackage.manifest.directionVersion,
        "trace-test",
        result.runtime
      ),
    DirectionHandoffPackageValidationError
  );
});

test("clarification-required observation exposes user escalation and event refs", async () => {
  const result = await runClarificationRequiredUndergroundFlow();
  const snapshot = result.observationSnapshot;
  const eventViews = createRunObservationEventViews(result.runtime.eventLog.list());
  const handoffEvent = eventViews.find((event) => event.type === "direction_handoff.completed");

  assert.equal(snapshot.currentPhase, "handoff");
  assert.equal(snapshot.currentStage, "direction_handoff_completed");
  assert.equal(snapshot.underground.status, "pending");
  assert.equal(snapshot.underground.userEscalationRequired, true);
  assert.equal(snapshot.underground.userEscalation.required, true);
  assert.equal(snapshot.underground.userEscalation.requestId, result.clarificationRequest.requestId);
  assert.equal(snapshot.underground.userEscalation.reason, "permission_boundary_unclear");
  assert.equal(snapshot.underground.userEscalation.blockingLevel, "blocking");
  assert.equal(snapshot.underground.userEscalation.questions.length >= 1, true);
  assert.equal(snapshot.underground.userEscalation.request?.requestId, result.clarificationRequest.requestId);
  assert.equal(
    snapshot.underground.convergence.openQuestions.some(
      (question) => question.disposition === "request_user_clarification"
    ),
    true
  );
  assert.equal(snapshot.handoff.status, "pending");
  assert.equal(snapshot.handoff.directionStatus, "awaiting_user");
  assert.equal(snapshot.aboveground.status, "not_started");
  assert.equal(handoffEvent?.type, "direction_handoff.completed");
  assert.equal(snapshot.directionPackageRef.status, "awaiting_user");
});

test("clarification recovery records user approval and creates approved v2 handoff lineage", async () => {
  const result = await runClarificationRecoveryFlow();
  const eventViews = createRunObservationEventViews(result.runtime.eventLog.list());
  const approvalReceivedEvent = eventViews.find((event) => event.type === "user_approval.received");
  const revisionRequestedEvent = eventViews.find((event) => event.type === "direction_handoff.revision_requested");
  const convergenceEvents = eventViews.filter((event) => event.type === "convergence_review.completed");
  const finalHandoffEvent = eventViews.at(-1);
  const entries = result.runtime.eventLog.list();

  assert.deepEqual(result.eventTypes, EXPECTED_CLARIFICATION_RECOVERY_EVENTS);
  assert.equal(convergenceEvents.length, 2);
  assert.equal(result.awaitingUserDirectionHandoffPackage.manifest.status, "awaiting_user");
  assert.equal(result.loadedApprovedDirectionHandoffPackage.manifest.status, "approved");
  assert.equal(
    result.loadedApprovedDirectionHandoffPackage.manifest.directionId,
    result.awaitingUserDirectionHandoffPackage.manifest.directionId
  );
  assert.deepEqual(
    result.runtime.directionHandoffPackageStore.listVersions(
      result.loadedApprovedDirectionHandoffPackage.manifest.directionId
    ),
    [1, 2]
  );
  assert.equal(result.awaitingUserDirectionHandoffPackage.validation.passed, false);
  assert.equal(result.loadedApprovedDirectionHandoffPackage.validation.passed, true);
  assert.equal(
    result.loadedApprovedDirectionHandoffPackage.directionHandoff.risks.some((risk) =>
      risk.toLowerCase().includes("blocked until user clarification")
    ),
    false
  );
  assert.equal(result.approvedConvergenceReport.outcome, "approved");
  assert.equal(result.approvedConvergenceReport.userEscalationRequired, false);
  assert.equal(result.clarificationResponse.status, "answered");
  assert.equal(result.clarificationResponse.requestId, result.clarificationRequest.requestId);
  const approvalIndex = entries.findIndex((entry) => entry.type === "user_approval.received");
  const revisionIndex = entries.findIndex((entry) => entry.type === "direction_handoff.revision_requested");
  const convergenceIndex = entries.reduce(
    (latest, entry, index) => entry.type === "convergence_review.completed" ? index : latest,
    -1,
  );
  assert.equal(approvalIndex >= 0, true);
  assert.equal(revisionIndex >= 0, true);
  assert.equal(convergenceIndex >= 0, true);
  assert.deepEqual(resolveRunObservationPosition(entries.slice(0, approvalIndex + 1)), {
    currentPhase: "handoff",
    currentStage: "user_approval_received",
  });
  assert.deepEqual(resolveRunObservationPosition(entries.slice(0, revisionIndex + 1)), {
    currentPhase: "handoff",
    currentStage: "direction_handoff_revision_requested",
  });
  assert.deepEqual(resolveRunObservationPosition(entries.slice(0, convergenceIndex + 1)), {
    currentPhase: "underground",
    currentStage: "convergence_review_completed",
  });
  assert.deepEqual(resolveRunObservationPosition(entries), {
    currentPhase: "handoff",
    currentStage: "direction_handoff_completed",
  });

  const lineage = result.loadedApprovedDirectionHandoffPackage.lineage;
  assert.equal(lineage.current.directionId, result.awaitingUserDirectionHandoffPackage.manifest.directionId);
  assert.equal(lineage.current.version, 2);
  assert.equal(lineage.previous?.version, 1);
  assert.equal(lineage.revisionReason, "user_clarification_answered");
  assert.equal(lineage.sourceRefs.includes(result.clarificationRequest.requestId), true);
  assert.equal(lineage.sourceRefs.includes("user_approval.received"), true);

  assert.equal(
    approvalReceivedEvent?.refs.some(
      (ref) => ref.kind === "user_clarification" && ref.id === result.clarificationRequest.requestId
    ),
    true
  );
  assert.equal(
    approvalReceivedEvent?.refs.some(
      (ref) =>
        ref.kind === "direction_package" &&
        ref.id === result.awaitingUserDirectionHandoffPackage.manifest.packageId
    ),
    true
  );
  assert.equal(revisionRequestedEvent?.progress.status, "in_progress");
  assert.equal(revisionRequestedEvent?.refs.some((ref) => ref.kind === "direction_handoff"), true);
  assert.equal(convergenceEvents.at(-1)?.scope, "underground");
  assert.equal(convergenceEvents.at(-1)?.refs.some((ref) => ref.kind === "convergence_review"), true);
  assert.equal(finalHandoffEvent?.type, "direction_handoff.completed");
  assert.equal(
    finalHandoffEvent?.refs.some(
      (ref) =>
        ref.kind === "direction_package" &&
        ref.id === result.loadedApprovedDirectionHandoffPackage.manifest.packageId &&
        ref.version === 2
    ),
    true
  );
});

test("clarification recovery snapshot round-trips and exposes response and v2 handoff refs", async () => {
  const result = await runClarificationRecoveryFlow();
  const parsed = JSON.parse(JSON.stringify(result.observationSnapshot)) as typeof result.observationSnapshot;

  assert.deepEqual(parsed, result.observationSnapshot);
  assert.equal(parsed.currentPhase, "handoff");
  assert.equal(parsed.currentStage, "direction_handoff_completed");
  assert.equal(parsed.underground.status, "completed");
  assert.equal(parsed.underground.userEscalationRequired, false);
  assert.equal(parsed.underground.clarificationResponses.length, 1);
  assert.equal(parsed.underground.clarificationResponses[0]?.requestId, result.clarificationRequest.requestId);
  assert.deepEqual(
    parsed.underground.clarificationResponses[0]?.evidenceRefs,
    result.clarificationResponse.evidenceRefs
  );
  assert.equal(parsed.handoff.status, "completed");
  assert.equal(parsed.handoff.directionId, result.loadedApprovedDirectionHandoffPackage.manifest.directionId);
  assert.equal(parsed.handoff.version, 2);
  assert.equal(parsed.handoff.lineage.revisionReason, "user_clarification_answered");
  assert.equal(parsed.handoff.lineage.previous?.version, 1);
  assert.equal(parsed.directionPackageRef.status, "approved");
  assert.equal(parsed.aboveground.status, "not_started");
});

test("aboveground rejects awaiting-user v1 and accepts recovered approved v2", async () => {
  const result = await runClarificationRecoveryFlow();
  const planner = new AbovegroundPlanner();
  const directionId = result.loadedApprovedDirectionHandoffPackage.manifest.directionId;

  assert.throws(
    () =>
      planner.plan(
        directionId,
        result.awaitingUserDirectionHandoffPackage.manifest.directionVersion,
        "trace-recovery-planning",
        result.runtime
      ),
    DirectionHandoffPackageValidationError
  );

  const planned = planner.plan(
    directionId,
    result.loadedApprovedDirectionHandoffPackage.manifest.directionVersion,
    "trace-recovery-planning",
    result.runtime
  );

  assert.equal(planned.directionHandoffPackage.manifest.status, "approved");
  assert.equal(planned.growthPlan.directionHandoffVersion, 2);
});

test("main minimal loop keeps the fixed 18-event happy path", () => {
  const result = runMinimalLoop();

  assert.equal(EXPECTED_DEMO_EVENTS.length, 18);
  assert.deepEqual(result.eventTypes, EXPECTED_DEMO_EVENTS);
  assert.equal(result.undergroundReport.convergenceReport.outcome, "approved");
  assert.equal(result.undergroundReport.convergenceReport.userEscalationRequired, false);
});
