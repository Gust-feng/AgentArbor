import assert from "node:assert/strict";
import test from "node:test";
import { DirectionHandoffPackageValidationError } from "../domain/agentarbor/direction-handoff-package.js";
import { createRunObservationEventViews } from "../domain/observation/index.js";
import { AbovegroundPlanner } from "./agents.js";
import {
  EXPECTED_CLARIFICATION_REQUIRED_EVENTS,
  runClarificationRequiredUndergroundFlow,
} from "./clarification-flow.js";
import { EXPECTED_DEMO_EVENTS, runMinimalLoop } from "./minimal-loop.js";

test("clarification-required underground flow produces awaiting_user handoff and user approval request", () => {
  const result = runClarificationRequiredUndergroundFlow();

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

test("clarification-required observation exposes user escalation and event refs", () => {
  const result = runClarificationRequiredUndergroundFlow();
  const snapshot = result.observationSnapshot;
  const eventViews = createRunObservationEventViews(result.runtime.eventLog.list());
  const approvalEvent = eventViews.find((event) => event.type === "user_approval.requested");

  assert.equal(snapshot.currentPhase, "handoff");
  assert.equal(snapshot.currentStage, "user_approval_requested");
  assert.equal(snapshot.underground.status, "pending");
  assert.equal(snapshot.underground.userEscalationRequired, true);
  assert.equal(snapshot.underground.userEscalation.required, true);
  assert.equal(snapshot.underground.userEscalation.requestId, result.clarificationRequest.requestId);
  assert.equal(snapshot.underground.userEscalation.reason, "permission_boundary_unclear");
  assert.equal(snapshot.underground.userEscalation.blockingLevel, "blocking");
  assert.equal(snapshot.underground.userEscalation.questions.length, 1);
  assert.equal(snapshot.underground.userEscalation.request?.requestId, result.clarificationRequest.requestId);
  assert.equal(snapshot.underground.convergence.openQuestions[0]?.disposition, "request_user_clarification");
  assert.equal(snapshot.handoff.status, "pending");
  assert.equal(snapshot.handoff.directionStatus, "awaiting_user");
  assert.equal(snapshot.aboveground.status, "not_started");
  assert.equal(
    approvalEvent?.refs.some(
      (ref) => ref.kind === "user_clarification" && ref.id === result.clarificationRequest.requestId
    ),
    true
  );
  assert.equal(
    approvalEvent?.refs.some(
      (ref) =>
        ref.kind === "direction_package" && ref.id === result.loadedDirectionHandoffPackage.manifest.packageId
    ),
    true
  );
});

test("main minimal loop keeps the fixed 18-event happy path", () => {
  const result = runMinimalLoop();

  assert.equal(EXPECTED_DEMO_EVENTS.length, 18);
  assert.deepEqual(result.eventTypes, EXPECTED_DEMO_EVENTS);
  assert.equal(result.undergroundReport.convergenceReport.outcome, "approved");
  assert.equal(result.undergroundReport.convergenceReport.userEscalationRequired, false);
});
