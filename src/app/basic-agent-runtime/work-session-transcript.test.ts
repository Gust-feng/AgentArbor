import assert from "node:assert/strict";
import test from "node:test";
import { transcriptNodesFromRunEvents as transcriptNodesFromLegacyWorkSessionEvents } from "./work-session-transcript.js";
import { transcriptNodesFromRunEvents as transcriptNodesFromWorkViewEvents } from "./work-view-transcript.js";

test("legacy work-session transcript module only re-exports the work-view implementation", () => {
  assert.equal(transcriptNodesFromLegacyWorkSessionEvents, transcriptNodesFromWorkViewEvents);
});
