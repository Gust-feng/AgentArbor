import assert from "node:assert/strict";
import test from "node:test";
import {
  projectAssistantMessageView,
} from "./panel-assistant-message-view.js";
import type { ProjectableTranscriptNode } from "./panel-transcript-node-projection.js";

test("assistant message view keeps the stream placeholder only before first visible output", () => {
  const view = projectAssistantMessageView({
    content: "",
    transcriptNodes: [],
    keepStreamMounted: true,
  });

  assert.equal(view.awaitingFirstVisibleOutput, true);
  assert.equal(view.answer, undefined);
});

test("assistant message view suppresses the placeholder once workflow activity is visible", () => {
  const view = projectAssistantMessageView({
    content: "",
    transcriptNodes: [
      node({
        kind: "thinking",
        eventType: "model.reasoning.delta",
        phase: "noted",
        text: "正在判断下一步",
      }),
    ],
    keepStreamMounted: true,
  });

  assert.equal(view.hasTimeline, true);
  assert.equal(view.awaitingFirstVisibleOutput, false);
});

test("assistant message view projects answer rendering state outside React", () => {
  const view = projectAssistantMessageView({
    content: "最终回答",
    live: true,
    liveTone: "process",
  });

  assert.deepEqual(view.answer, {
    text: "最终回答",
    copyText: "最终回答",
    showActions: false,
    live: true,
    animateOnMount: true,
    tone: "process",
  });
});

test("assistant message view treats pending confirmation as workflow content", () => {
  const pending = { confirmationId: "confirmation-1", runId: "run-1" };
  const view = projectAssistantMessageView({
    content: "",
    transcriptNodes: [],
    pending,
  });

  assert.equal(view.timeline.hasContent, true);
  assert.equal(view.timeline.confirmation.current, pending);
});

function node(input: {
  readonly kind: ProjectableTranscriptNode["kind"];
  readonly eventType: string;
  readonly phase: ProjectableTranscriptNode["phase"];
  readonly text?: string;
  readonly summary?: string;
}): ProjectableTranscriptNode {
  return {
    nodeId: "node-1",
    runId: "run-1",
    sequence: 1,
    eventType: input.eventType,
    kind: input.kind,
    phase: input.phase,
    title: input.kind,
    text: input.text,
    summary: input.summary,
    timestamp: "2026-06-04T00:00:00.000Z",
    refs: [],
  };
}
