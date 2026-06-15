import assert from "node:assert/strict";
import test from "node:test";
import { PanelHttpError } from "./http-utils.js";
import { parseRunInput } from "./request-parsers.js";

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
