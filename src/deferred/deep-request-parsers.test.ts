import assert from "node:assert/strict";
import test from "node:test";
import { PanelHttpError } from "../app/panel-server/http-utils.js";
import {
  parseDeepChildMessageRequest,
  parseDeepIntakeRequest,
  parseDeepRunControlRequest,
  parseDeepRunListLimit,
} from "./deep-request-parsers.js";

test("Deep request parsers ignore retired aliases", () => {
  assertPanelError(() => parseDeepChildMessageRequest({ instruction: "legacy" }), "empty_child_instruction");
  assertPanelError(
    () => parseDeepRunControlRequest({ context: ["legacy"] }, "correct"),
    "empty_correction_context",
  );
});

test("Deep request schemas preserve explicit errors for invalid enum and nested input", () => {
  assert.deepEqual(parseDeepIntakeRequest({ message: "  investigate  ", aiMode: "fake" }), {
    message: "investigate",
    aiMode: "fake",
    taskSoilInput: undefined,
  });
  assertPanelError(() => parseDeepIntakeRequest({ message: "investigate", aiMode: "bad" }), "invalid_ai_mode");
  assertPanelError(
    () => parseDeepRunControlRequest({ correctionContext: ["valid", { nested: true }] }, "correct"),
    "invalid_correction_context",
  );
});

test("Deep run list limit keeps its default, validation, and cap", () => {
  assert.equal(parseDeepRunListLimit(new URL("http://localhost/api/deep/runs")), 50);
  assert.equal(parseDeepRunListLimit(new URL("http://localhost/api/deep/runs?limit=250")), 200);
  assertPanelError(
    () => parseDeepRunListLimit(new URL("http://localhost/api/deep/runs?limit=0")),
    "invalid_deep_run_limit",
  );
});

function assertPanelError(action: () => unknown, code: string): void {
  assert.throws(action, (error) => error instanceof PanelHttpError && error.statusCode === 400 && error.code === code);
}
