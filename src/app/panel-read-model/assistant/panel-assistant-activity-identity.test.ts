import assert from "node:assert/strict";
import test from "node:test";
import {
  isModelNarrativeActivityItem,
  mergeModelNarrativeActivityItem,
  sameActivityItemCopy,
  sameModelNarrativeActivity,
} from "./panel-assistant-activity-identity.js";
import type { ActivityItem } from "../transcript/panel-transcript-activity-copy.js";

test("assistant activity identity treats thinking and narration as the same model narrative lane", () => {
  assert.equal(sameModelNarrativeActivity(
    item({ tone: "thinking", detail: "The user is asking me to demonstrate capabilities." }),
    item({ tone: "narration", detail: "The user is asking me to demonstrate capabilities." }),
  ), true);
});

test("assistant activity identity compares full narrative text when visible detail is truncated", () => {
  assert.equal(sameModelNarrativeActivity(
    item({
      tone: "thinking",
      detail: "The user is asking me to demonstrate my capabilities…",
      expandedDetail: "by exploring the current workspace and showing various abilities.",
    }),
    item({
      tone: "thinking",
      detail: "The user is asking me to demonstrate my capabilities. Let me showcase what I can do by exploring the current workspace and showing various abilities.",
    }),
  ), true);
});

test("assistant activity identity does not merge tool items by copy", () => {
  assert.equal(isModelNarrativeActivityItem(item({ tone: "tool", detail: "README.md" })), false);
  assert.equal(sameModelNarrativeActivity(
    item({ tone: "tool", detail: "README.md" }),
    item({ tone: "tool", detail: "README.md" }),
  ), false);
});

test("assistant activity identity merges more complete model narrative copy at the original position", () => {
  const merged = mergeModelNarrativeActivityItem(
    item({ tone: "thinking", detail: "The user asks me to demo.", phase: "noted" }),
    item({ tone: "narration", detail: "The user asks me to demo and inspect files.", phase: "completed" }),
  );

  assert.equal(merged.tone, "thinking");
  assert.equal(merged.copy.detail, "The user asks me to demo and inspect files.");
  assert.equal(merged.phase, "completed");
});

test("assistant activity identity allows stability to compare model narrative copy across tones", () => {
  assert.equal(sameActivityItemCopy(
    item({ tone: "thinking", detail: "先判断下一步。" }),
    item({ tone: "narration", detail: "先判断下一步。" }),
  ), true);
  assert.equal(sameActivityItemCopy(
    item({ tone: "thinking", detail: "先判断下一步。" }),
    item({ tone: "tool", detail: "先判断下一步。" }),
  ), false);
});

function item(input: {
  readonly tone: ActivityItem["tone"];
  readonly detail: string;
  readonly expandedDetail?: string;
  readonly label?: string;
  readonly phase?: ActivityItem["phase"];
}): ActivityItem {
  return {
    nodeId: `${input.tone}:${input.detail}`,
    key: `${input.tone}:${input.detail}`,
    eventType: input.tone === "thinking"
      ? "model.reasoning.completed"
      : input.tone === "narration" ? "model.side.completed" : "test.activity",
    copy: {
      label: input.label,
      detail: input.detail,
      expandedDetail: input.expandedDetail,
    },
    tone: input.tone,
    phase: input.phase ?? "completed",
  };
}
