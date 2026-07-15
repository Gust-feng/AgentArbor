import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelProtocolContinuationPersistenceError,
  OPENAI_CHAT_CONTINUATION_EXTENSIONS,
  OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION,
  persistedModelProtocolExtensions,
} from "./persisted-protocol-extensions.js";

test("persisted model protocol extensions keep exact JSON-safe Responses continuation items", () => {
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
  const largeOpaqueItem = { type: "reasoning", encrypted_content: "x".repeat(1_100_000) };
  assert.deepEqual(persistedModelProtocolExtensions({
    [OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION]: [largeOpaqueItem],
  }), {
    [OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION]: [largeOpaqueItem],
  });
  assert.equal(persistedModelProtocolExtensions({ unknown_provider_field: "ignored" }), undefined);
});

test("persisted model protocol extensions keep only allowlisted Chat continuation fields", () => {
  assert.deepEqual(persistedModelProtocolExtensions({
    reasoning_content: "private reasoning continuation",
    reasoning_details: [{ text: "provider detail" }],
    arbitrary_vendor_state: { secret: "discarded" },
  }), {
    reasoning_content: "private reasoning continuation",
    reasoning_details: [{ text: "provider detail" }],
  });
  assert.deepEqual(OPENAI_CHAT_CONTINUATION_EXTENSIONS, [
    "reasoning",
    "reasoning_content",
    "reasoning_details",
  ]);
  assert.throws(
    () => persistedModelProtocolExtensions({ reasoning_content: { invalid: true } }),
    (error: unknown) => error instanceof ModelProtocolContinuationPersistenceError &&
      error.facts.extension === "reasoning_content" &&
      error.facts.reason === "invalid_item",
  );
});
