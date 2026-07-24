import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAITokenCounter } from "./token-counter.js";

test("OpenAI token counter exposes whether its model encoding is recognized", () => {
  assert.equal(createOpenAITokenCounter("gpt-4o").tokenizerMatch, "model");
  assert.equal(createOpenAITokenCounter("provider-private-unknown-model").tokenizerMatch, "fallback");
});
