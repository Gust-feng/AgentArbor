import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRunBirthFactsForKind,
  assertRunModeForKind,
  defaultRunModeForKind,
  resolveRunModeForKind,
  RunModePolicyError,
} from "./run-mode-policy.js";

test("run mode policy keeps desktop on ordinary agent and underground on deep", () => {
  assert.equal(defaultRunModeForKind("desktop"), "agent");
  assert.equal(defaultRunModeForKind("underground"), "deep");
  assert.equal(resolveRunModeForKind("desktop", undefined), "agent");
  assert.equal(resolveRunModeForKind("underground", undefined), "deep");
  assert.equal(resolveRunModeForKind("desktop", "agent"), "agent");
  assert.equal(resolveRunModeForKind("underground", "deep"), "deep");
});

test("run mode policy rejects dirty run kind and mode pairs", () => {
  assert.throws(
    () => assertRunModeForKind("desktop", "deep"),
    (error) =>
      error instanceof RunModePolicyError &&
      error.code === "desktop_run_mode_not_supported" &&
      error.runKind === "desktop" &&
      error.runMode === "deep"
  );
  assert.throws(
    () => assertRunModeForKind("underground", "agent"),
    (error) =>
      error instanceof RunModePolicyError &&
      error.code === "underground_run_mode_not_supported" &&
      error.runKind === "underground" &&
      error.runMode === "agent"
  );
});

test("run mode policy requires frozen birth facts for ordinary desktop agent runs", () => {
  assert.throws(
    () =>
      assertRunBirthFactsForKind({
        runKind: "desktop",
        runMode: "agent",
        agentDefinitionRef: {},
      }),
    (error) =>
      error instanceof RunModePolicyError &&
      error.code === "desktop_agent_capability_snapshot_required" &&
      error.runKind === "desktop" &&
      error.runMode === "agent"
  );
  assert.throws(
    () =>
      assertRunBirthFactsForKind({
        runKind: "desktop",
        runMode: "agent",
        capabilitySnapshot: {},
      }),
    (error) =>
      error instanceof RunModePolicyError &&
      error.code === "desktop_agent_definition_ref_required" &&
      error.runKind === "desktop" &&
      error.runMode === "agent"
  );
  assert.doesNotThrow(() =>
    assertRunBirthFactsForKind({
      runKind: "desktop",
      runMode: "agent",
      capabilitySnapshot: {},
      agentDefinitionRef: {},
    })
  );
  assert.doesNotThrow(() =>
    assertRunBirthFactsForKind({
      runKind: "underground",
      runMode: "deep",
    })
  );
});
