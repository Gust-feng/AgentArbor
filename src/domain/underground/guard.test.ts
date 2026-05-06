import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptGuardedAction,
  createGuardResult,
  createGuardViolation,
  fallbackGuardedAction,
  rejectGuardedAction,
} from "./index.js";

test("guard accepts valid action output and rejects hard boundary violations", () => {
  const output = { outputRefs: ["candidate:ok"] };
  const accepted = acceptGuardedAction(output);
  const rejected = rejectGuardedAction({
    output,
    violations: [
      createGuardViolation({
        code: "HARD_CONSTRAINT_VIOLATED",
        message: "Hard constraints must block the action boundary.",
      }),
    ],
  });

  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.guard.passed, true);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.guard.passed, false);
});

test("guard fallback is explicit and keeps fallback source refs visible", () => {
  const fallback = fallbackGuardedAction({
    output: { outputRefs: ["candidate:fallback"] },
    reason: "model_output_invalid",
    sourceRefs: ["model.failed:request-1", "ai-fallback:rootlet-option"],
    violations: [
      createGuardViolation({
        code: "MODEL_OUTPUT_INVALID",
        message: "Invalid model output can only enter as guarded fallback material.",
        severity: "warning",
      }),
    ],
  });
  const warningOnly = createGuardResult({
    violations: [
      createGuardViolation({
        code: "LOW_CONFIDENCE_FALLBACK",
        message: "Fallback is material for parent synthesis, not semantic completion.",
        severity: "warning",
      }),
    ],
  });

  assert.equal(fallback.status, "fallback");
  assert.deepEqual(fallback.fallbackSourceRefs, ["model.failed:request-1", "ai-fallback:rootlet-option"]);
  assert.equal(fallback.guard.fallbackReason, "model_output_invalid");
  assert.equal(warningOnly.passed, true);
});

