import assert from "node:assert/strict";
import test from "node:test";
import type { Constraint, DirectionHandoff } from "../../domain/contracts.js";
import {
  ConstraintBlockedError,
  StateGuardError,
  UserConfirmationRequiredError,
  assignTask,
  enterPlanning,
} from "./task-state-machine.js";
import { runMinimalLoop } from "../../app/minimal-loop.js";

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

  assert.throws(
    () => runMinimalLoop(undefined, { constraints: [unapprovedHardConstraint] }),
    UserConfirmationRequiredError
  );
});
