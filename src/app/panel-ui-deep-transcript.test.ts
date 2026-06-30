import assert from "node:assert/strict";
import test from "node:test";
import { splitConversationTurnsAroundRun } from "./panel-ui-deep-transcript.js";

test("deep transcript split keeps follow-up intake turns after the terminal run", () => {
  const turns = [
    { turnId: "turn-1", createdAt: "2026-06-29T10:00:00.000Z" },
    { turnId: "turn-2", createdAt: "2026-06-29T10:02:00.000Z" },
    { turnId: "turn-3", createdAt: "2026-06-29T10:05:00.000Z" },
  ];

  const partition = splitConversationTurnsAroundRun(turns, "2026-06-29T10:03:00.000Z");

  assert.deepEqual(partition.leadingTurns.map((turn) => turn.turnId), ["turn-1", "turn-2"]);
  assert.deepEqual(partition.trailingTurns.map((turn) => turn.turnId), ["turn-3"]);
});

test("deep transcript split keeps all turns leading when run timestamp is unavailable", () => {
  const turns = [
    { turnId: "turn-1", createdAt: "2026-06-29T10:00:00.000Z" },
  ];

  const partition = splitConversationTurnsAroundRun(turns, "not-a-timestamp");

  assert.deepEqual(partition.leadingTurns.map((turn) => turn.turnId), ["turn-1"]);
  assert.deepEqual(partition.trailingTurns, []);
});
