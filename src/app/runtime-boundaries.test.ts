import assert from "node:assert/strict";
import test from "node:test";
import { DirectionHandoffPackageValidationError } from "../domain/agentarbor/direction-handoff-package.js";
import {
  createAwaitingUserDirectionHandoffPackageFixture,
  tamperAwaitingUserPackageToApprovedShape,
} from "../domain/agentarbor/test-fixtures.js";
import { StateGuardError } from "../kernel/state-machine/task-state-machine.js";
import { AbovegroundPlanner } from "./agents.js";
import { runMinimalLoop } from "./minimal-loop.js";

test("aboveground planner blocks draft and awaiting_user DirectionHandoffPackages", () => {
  const result = runMinimalLoop();
  const planner = new AbovegroundPlanner();

  for (const status of ["draft", "awaiting_user"] as const) {
    const blockedPackage = JSON.parse(JSON.stringify(result.directionHandoffPackage)) as typeof result.directionHandoffPackage;
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

test("aboveground planner rejects awaiting_user package tampered into approved status", () => {
  const result = runMinimalLoop();
  const planner = new AbovegroundPlanner();
  const { directionHandoffPackage } = createAwaitingUserDirectionHandoffPackageFixture();
  const tamperedPackage = tamperAwaitingUserPackageToApprovedShape(directionHandoffPackage);
  result.runtime.directionHandoffPackageStore.save(tamperedPackage);

  assert.throws(
    () =>
      planner.plan(
        tamperedPackage.manifest.directionId,
        tamperedPackage.manifest.directionVersion,
        "trace-test",
        result.runtime
      ),
    DirectionHandoffPackageValidationError
  );
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

test("aboveground planner cannot create direction exploration candidates", () => {
  const planner = new AbovegroundPlanner();

  assert.throws(() => planner.createExplorationCandidate(), StateGuardError);
});
