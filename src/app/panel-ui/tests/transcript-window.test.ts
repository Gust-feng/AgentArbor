import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_VISIBLE_TRANSCRIPT_TURNS,
  LONG_TRANSCRIPT_PROGRESSIVE_THRESHOLD,
  MANUAL_TRANSCRIPT_REVEAL_BATCH,
  TRANSCRIPT_REVEAL_BATCH,
  initialVisibleTranscriptTurnCount,
  nextTranscriptVisibleTurnCount,
  previousTranscriptVisibleTurnCount,
  reconcileTranscriptVisibilityState,
  runIdsForTurnWindow,
  transcriptVisibleTurnWindow,
} from "../src/transcript-window.js";

test("short transcripts stay fully visible", () => {
  assert.equal(initialVisibleTranscriptTurnCount(0), 0);
  assert.equal(initialVisibleTranscriptTurnCount(12), 12);
  assert.equal(initialVisibleTranscriptTurnCount(LONG_TRANSCRIPT_PROGRESSIVE_THRESHOLD), LONG_TRANSCRIPT_PROGRESSIVE_THRESHOLD);
});

test("long transcripts start from the tail", () => {
  assert.equal(initialVisibleTranscriptTurnCount(LONG_TRANSCRIPT_PROGRESSIVE_THRESHOLD + 1), INITIAL_VISIBLE_TRANSCRIPT_TURNS);
  assert.deepEqual(
    transcriptVisibleTurnWindow(220, INITIAL_VISIBLE_TRANSCRIPT_TURNS),
    {
      startIndex: 180,
      visibleCount: INITIAL_VISIBLE_TRANSCRIPT_TURNS,
      complete: false,
    },
  );
});

test("visibility state resets on conversation switch and grows in batches", () => {
  const first = reconcileTranscriptVisibilityState({
    conversationId: "conversation-a",
    totalTurns: 220,
  });
  assert.equal(first.visibleCount, INITIAL_VISIBLE_TRANSCRIPT_TURNS);

  const stillProgressive = reconcileTranscriptVisibilityState({
    previous: first,
    conversationId: "conversation-a",
    totalTurns: 252,
  });
  assert.equal(stillProgressive.visibleCount, INITIAL_VISIBLE_TRANSCRIPT_TURNS);

  const next = reconcileTranscriptVisibilityState({
    previous: stillProgressive,
    conversationId: "conversation-a",
    totalTurns: 420,
  });
  assert.equal(next.visibleCount, INITIAL_VISIBLE_TRANSCRIPT_TURNS);

  const fullyVisible = {
    conversationId: "conversation-a",
    totalTurns: 120,
    visibleCount: 120,
  };
  const appendedSmallFollowUp = reconcileTranscriptVisibilityState({
    previous: fullyVisible,
    conversationId: "conversation-a",
    totalTurns: 122,
  });
  assert.equal(appendedSmallFollowUp.visibleCount, 122);

  const switched = reconcileTranscriptVisibilityState({
    previous: next,
    conversationId: "conversation-b",
    totalTurns: 18,
  });
  assert.equal(switched.visibleCount, 18);
});

test("visible count grows by reveal batches without overshooting", () => {
  assert.equal(nextTranscriptVisibleTurnCount(220, 40), 72);
  assert.equal(nextTranscriptVisibleTurnCount(220, 212), 220);
  assert.equal(nextTranscriptVisibleTurnCount(220, 220), 220);
  assert.equal(TRANSCRIPT_REVEAL_BATCH, 32);
});

test("manual earlier-message reveal uses larger bounded batches", () => {
  assert.equal(previousTranscriptVisibleTurnCount(220, 40), 120);
  assert.equal(previousTranscriptVisibleTurnCount(220, 180), 220);
  assert.equal(MANUAL_TRANSCRIPT_REVEAL_BATCH, 80);
});

test("run ids can be collected for only the visible turn window", () => {
  const turns = [
    { role: "user" as const },
    { role: "assistant" as const, runId: "run-1" },
    { role: "user" as const },
    { role: "assistant" as const, runId: "run-2" },
    { role: "assistant" as const, runId: "run-2" },
    { role: "assistant" as const, runId: "run-3" },
  ];

  assert.deepEqual(runIdsForTurnWindow(turns, 2, 5), ["run-2"]);
  assert.deepEqual(runIdsForTurnWindow(turns, 4), ["run-2", "run-3"]);
});