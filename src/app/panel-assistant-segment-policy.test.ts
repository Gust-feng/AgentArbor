import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldCarryCollapsedHint,
  shouldUpdateSegmentContent,
} from "./panel-assistant-segment-policy.js";
import type { AssistantMessageSegmentLifecycle } from "./panel-assistant-message-structure.js";

test("assistant segment policy freezes only settled to settled content updates", () => {
  const lifecycles: readonly AssistantMessageSegmentLifecycle[] = ["open", "settled", "attention"];

  for (const previous of lifecycles) {
    for (const next of lifecycles) {
      assert.equal(
        shouldUpdateSegmentContent(previous, next),
        !(previous === "settled" && next === "settled"),
        `${previous} -> ${next}`,
      );
    }
  }
});

test("assistant segment policy carries collapsed hints only while settled", () => {
  assert.equal(shouldCarryCollapsedHint("settled"), true);
  assert.equal(shouldCarryCollapsedHint("open"), false);
  assert.equal(shouldCarryCollapsedHint("attention"), false);
});
