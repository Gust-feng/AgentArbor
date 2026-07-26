import assert from "node:assert/strict";
import test from "node:test";
import { createMultiAgentFeature } from "./multi-agent-feature.js";

test("MultiAgentFeature exposes projected command, query and event facades without raw records", async () => {
  const feature = createMultiAgentFeature();
  try {
    assert.deepEqual(Object.keys(feature).sort(), ["commands", "dispose", "events", "queries", "waitForIdle"]);
    const conversation = await feature.commands.createConversation({
      aiMode: "fake",
      goal: "Verify the public Multi-Agent facade.",
    });
    const conversationId = conversation.conversationId;
    assert.equal(typeof conversationId, "string");

    const summaries = await feature.queries.listConversationSummaries(50);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]?.conversationId, conversationId);
    const detail = await feature.queries.getConversationDetail(String(conversationId));
    assert.equal(detail?.conversation.conversationId, conversationId);
    assert.deepEqual(detail?.runs, []);
    assert.deepEqual(Object.keys(feature.events).sort(), ["admit", "replay", "subscribe"]);
    assert.equal("recordSaved" in feature.events, false);
    assert.equal("recordDeleted" in feature.events, false);
    assert.equal("close" in feature.events, false);
    assert.equal(await feature.events.replay("missing-run"), undefined);
    assert.deepEqual(await feature.events.admit("missing-run"), { kind: "missing" });
  } finally {
    await feature.dispose();
  }
});
