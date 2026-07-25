import assert from "node:assert/strict";
import test from "node:test";
import {
  isModelNarrativeActivityItem,
  mergeModelNarrativeActivityItem,
  sameModelNarrativeActivity,
} from "./panel-assistant-activity-identity.js";
import type { ActivityItem } from "../transcript/panel-transcript-activity-copy.js";

test("assistant activity identity uses the canonical item key instead of display copy", () => {
  assert.equal(sameModelNarrativeActivity(
    item({ key: "reasoning:model-1", tone: "thinking", detail: "短文本" }),
    item({ key: "reasoning:model-1", tone: "thinking", detail: "完全不同的完整文本" }),
  ), true);
  assert.equal(sameModelNarrativeActivity(
    item({ key: "reasoning:model-1", tone: "thinking", detail: "相同文本" }),
    item({ key: "reasoning:model-2", tone: "thinking", detail: "相同文本" }),
  ), false);
});

test("assistant activity identity keeps reasoning and narration as distinct facts", () => {
  assert.equal(sameModelNarrativeActivity(
    item({ key: "model-1", tone: "thinking", detail: "相同文本" }),
    item({ key: "model-1", tone: "narration", detail: "相同文本" }),
  ), false);
});

test("assistant activity identity excludes operational items", () => {
  assert.equal(isModelNarrativeActivityItem(item({ key: "tool-1", tone: "tool", detail: "README.md" })), false);
});

test("assistant activity reconciliation accepts the newer observation of one canonical item", () => {
  const incoming = item({ key: "reasoning:model-1", tone: "thinking", detail: "完整思考", phase: "completed" });
  const merged = mergeModelNarrativeActivityItem(
    item({ key: "reasoning:model-1", tone: "thinking", detail: "思考中", phase: "noted" }),
    incoming,
  );

  assert.equal(merged, incoming);
});

function item(input: {
  readonly key: string;
  readonly tone: ActivityItem["tone"];
  readonly detail: string;
  readonly phase?: ActivityItem["phase"];
}): ActivityItem {
  return {
    nodeId: input.key,
    key: input.key,
    eventType: input.tone === "thinking"
      ? "model.reasoning.completed"
      : input.tone === "narration" ? "model.side.completed" : "test.activity",
    copy: { detail: input.detail },
    tone: input.tone,
    phase: input.phase ?? "completed",
  };
}
