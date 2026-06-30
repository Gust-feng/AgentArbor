import assert from "node:assert/strict";
import test from "node:test";
import { isDeepConversationActive } from "./panel-ui-deep-sidebar-selection.js";

test("deep sidebar selection does not match missing run ids", () => {
  assert.equal(
    isDeepConversationActive(
      {
        conversationId: "conversation-1",
      },
      {
        activeRunId: undefined,
      },
    ),
    false,
  );
});

test("deep sidebar selection matches either conversation id or latest run id", () => {
  const conversation = {
    conversationId: "conversation-1",
    latestRun: {
      runId: "run-1",
    },
  };

  assert.equal(
    isDeepConversationActive(conversation, {
      activeConversationId: "conversation-1",
    }),
    true,
  );
  assert.equal(
    isDeepConversationActive(conversation, {
      activeRunId: "run-1",
    }),
    true,
  );
  assert.equal(
    isDeepConversationActive(conversation, {
      activeRunId: "run-2",
    }),
    false,
  );
});
