import assert from "node:assert/strict";
import test from "node:test";
import {
  projectChatWorkline,
  type WorklineConversationTurn,
} from "./panel-ui-chat-workline.js";

test("chat workline claims an unbound assistant shell for the active run", () => {
  const projection = projectChatWorkline({
    turns: [
      userTurn("user-1", "帮我检查项目"),
      assistantTurn("assistant-shell", "", "running"),
    ],
    currentRunId: "run-1",
    currentRunStatus: "running",
    transcriptNodes: [node("run-1")],
    hasAnswer: false,
    hasLiveAnswer: false,
    hasPendingConfirmation: false,
    hasDeliverable: false,
  });

  assert.equal(projection.standaloneRun, false);
  assert.equal(projection.turns.length, 2);
  assert.equal(projection.turns[1]?.displayRunId, "run-1");
  assert.equal(projection.turns[1]?.claimedCurrentRun, true);
});

test("chat workline keeps initial optimistic shell before the run id exists", () => {
  const projection = projectChatWorkline({
    turns: [
      userTurn("user-1", "你好"),
      assistantTurn("assistant-shell", "", "running"),
    ],
    currentRunId: undefined,
    currentRunStatus: undefined,
    transcriptNodes: [],
    hasAnswer: false,
    hasLiveAnswer: false,
    hasPendingConfirmation: false,
    hasDeliverable: false,
  });

  assert.equal(projection.standaloneRun, false);
  assert.equal(projection.turns.map((item) => item.turn.turnId).join(","), "user-1,assistant-shell");
});

test("chat workline uses standalone run only when no assistant turn can own it", () => {
  const projection = projectChatWorkline({
    turns: [userTurn("user-1", "继续")],
    currentRunId: "run-1",
    currentRunStatus: "completed",
    transcriptNodes: [],
    hasAnswer: true,
    hasLiveAnswer: false,
    hasPendingConfirmation: false,
    hasDeliverable: false,
  });

  assert.equal(projection.standaloneRun, true);
  assert.equal(projection.turns.length, 1);
});

test("chat workline does not duplicate a run already owned by a conversation turn", () => {
  const projection = projectChatWorkline({
    turns: [
      userTurn("user-1", "写总结"),
      { ...assistantTurn("assistant-1", "", "running"), runId: "run-1" },
    ],
    currentRunId: "run-1",
    currentRunStatus: "running",
    transcriptNodes: [node("run-1")],
    hasAnswer: false,
    hasLiveAnswer: true,
    hasPendingConfirmation: false,
    hasDeliverable: false,
  });

  assert.equal(projection.standaloneRun, false);
  assert.equal(projection.turns[1]?.displayRunId, "run-1");
  assert.equal(projection.turns[1]?.claimedCurrentRun, false);
});

function userTurn(turnId: string, content: string): WorklineConversationTurn {
  return {
    turnId,
    role: "user",
    content,
    status: "completed",
  };
}

function assistantTurn(turnId: string, content: string, status: string): WorklineConversationTurn {
  return {
    turnId,
    role: "assistant",
    content,
    status,
  };
}

function node(runId: string): { readonly runId: string } {
  return { runId };
}
