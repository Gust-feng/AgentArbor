import assert from "node:assert/strict";
import test from "node:test";
import { firstNonEmptyText, hasNonEmptyText } from "./panel-assistant-output.js";

test("assistant output helper picks the first meaningful answer", () => {
  assert.equal(firstNonEmptyText([undefined, "", "   ", "模型正文", "fallback"]), "模型正文");
  assert.equal(firstNonEmptyText([undefined, ""]), undefined);
});

test("assistant output helper treats whitespace as empty", () => {
  assert.equal(hasNonEmptyText("  \n\t  "), false);
  assert.equal(hasNonEmptyText(" 有内容 "), true);
});
