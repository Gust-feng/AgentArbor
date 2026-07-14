import assert from "node:assert/strict";
import test from "node:test";
import { ModelRuntimeConfigurationError } from "../model-runtime/index.js";
import { CodedExecutionError, executionErrorFacts } from "./index.js";

test("execution error facts preserve explicit model configuration and boundary codes", () => {
  const configurationError = new ModelRuntimeConfigurationError({
    code: "missing_api_key",
    message: "API key is required.",
    summaryInput: { enabled: true, mode: "openai-responses" },
  });
  const cause = new Error("adapter detail");
  const boundaryError = new CodedExecutionError(
    "tool_boundary_resolution_failed",
    "Tool boundary could not be resolved.",
    { cause },
  );

  assert.deepEqual(executionErrorFacts(configurationError), {
    code: "missing_api_key",
    message: "API key is required.",
  });
  assert.deepEqual(executionErrorFacts(boundaryError), {
    code: "tool_boundary_resolution_failed",
    message: "Tool boundary could not be resolved.",
  });
  assert.equal(boundaryError.cause, cause);
  assert.equal(executionErrorFacts(new Error("unknown")), undefined);
});
