import assert from "node:assert/strict";
import test from "node:test";
import { PanelHttpError } from "./http-utils.js";
import { parseRunInput, parseToolConfirmationUpdate } from "./request-parsers.js";

test("parseRunInput accepts full access tool confirmation policy", () => {
  const parsed = parseRunInput({
    goal: "run commands",
    toolConfirmationPolicy: "full_access",
  });

  assert.equal(parsed.toolConfirmationPolicy, "full_access");
});

test("parseRunInput rejects invalid tool confirmation policy", () => {
  assert.throws(
    () => parseRunInput({
      goal: "run commands",
      toolConfirmationPolicy: "always",
    }),
    (error) => {
      assert.equal(error instanceof PanelHttpError, true);
      assert.equal((error as PanelHttpError).code, "invalid_tool_confirmation_policy");
      return true;
    }
  );
});

test("parseToolConfirmationUpdate accepts full access and rejects invalid policies", () => {
  assert.deepEqual(parseToolConfirmationUpdate({ policy: "full_access" }), { policy: "full_access" });
  assert.throws(
    () => parseToolConfirmationUpdate({ policy: "always" }),
    (error) => {
      assert.equal(error instanceof PanelHttpError, true);
      assert.equal((error as PanelHttpError).code, "invalid_tool_confirmation_policy");
      return true;
    }
  );
});
