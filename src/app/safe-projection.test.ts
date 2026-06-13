import assert from "node:assert/strict";
import test from "node:test";
import { redactOrdinaryMarkdownFragment } from "./safe-projection.js";

test("ordinary markdown fragments preserve whitespace-only streaming deltas", () => {
  assert.equal(redactOrdinaryMarkdownFragment(" "), " ");
  assert.equal(redactOrdinaryMarkdownFragment("   "), "   ");
  assert.equal(redactOrdinaryMarkdownFragment("\n"), "\n");
});

test("ordinary markdown fragments preserve indentation and repeated spaces", () => {
  assert.equal(
    redactOrdinaryMarkdownFragment("```ts\n  const value  = 1;\n```"),
    "```ts\n  const value  = 1;\n```"
  );
});

test("ordinary markdown fragments keep visible text without redaction", () => {
  assert.equal(
    redactOrdinaryMarkdownFragment(" hello api_key=secret-value "),
    " hello api_key=secret-value "
  );
});
