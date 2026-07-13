import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelProtocolContinuationPersistenceError,
  OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION,
  persistedModelProtocolExtensions,
} from "./persisted-protocol-extensions.js";

test("persisted model protocol extensions keep only bounded Responses continuation items", () => {
  const items = [{ type: "reasoning", encrypted_content: "opaque" }];
  assert.deepEqual(persistedModelProtocolExtensions({
    response_id: "request-only",
    unknown_provider_field: "discarded",
    [OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION]: items,
  }), {
    [OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION]: items,
  });
  assert.throws(
    () => persistedModelProtocolExtensions({
      [OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION]: [{ encrypted_content: "missing-type" }],
    }),
    (error: unknown) => error instanceof ModelProtocolContinuationPersistenceError &&
      error.code === "model_protocol_continuation_not_persistable" &&
      error.facts.reason === "invalid_item",
  );
  assert.throws(
    () => persistedModelProtocolExtensions({
      [OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION]: [{
        type: "reasoning",
        encrypted_content: "x".repeat(1_100_000),
      }],
    }),
    (error: unknown) => error instanceof ModelProtocolContinuationPersistenceError &&
      error.facts.reason === "too_large",
  );
  assert.equal(persistedModelProtocolExtensions({ unknown_provider_field: "ignored" }), undefined);
});
