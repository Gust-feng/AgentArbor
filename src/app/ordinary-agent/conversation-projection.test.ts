import assert from "node:assert/strict";
import test from "node:test";
import type {
  OrdinaryConversationControlDocument,
  OrdinaryRunState,
  OrdinaryRunStatus,
} from "./contracts.js";
import { projectOrdinaryConversation } from "./conversation-projection.js";
import { ordinaryRunBirth, ordinaryRunTurn } from "./test-support.js";

test("conversation projection keeps user cancellation and runtime restart as quiet interruptions", () => {
  const cases: readonly {
    readonly status: OrdinaryRunStatus;
    readonly interruption: "user_cancelled" | "runtime_stopped";
  }[] = [{
    status: { kind: "cancelled", reason: "cancelled_by_user" },
    interruption: "user_cancelled",
  }, {
    status: {
      kind: "blocked",
      reason: {
        code: "execution_continuation_lost",
        message: "The live execution was interrupted when the process restarted.",
      },
      continueBy: "new_turn",
    },
    interruption: "runtime_stopped",
  }];

  for (const [index, item] of cases.entries()) {
    const run = interruptedRun(`run-${index}`, item.status);
    const conversation = projectOrdinaryConversation({
      control: control(run),
      runs: [run],
    });
    const assistant = conversation?.turns[1];

    assert.equal(assistant?.content, "退出前已经显示的正文");
    assert.equal(assistant?.role === "assistant" ? assistant.interruption : undefined, item.interruption);
  }
});

function interruptedRun(runId: string, status: OrdinaryRunStatus): OrdinaryRunState {
  const turn = ordinaryRunTurn(runId);
  return {
    runId,
    turn,
    input: { userMessage: "继续回答" },
    birth: ordinaryRunBirth(),
    status,
    canonicalMessages: [{ role: "user", content: "继续回答" }],
    visibleAssistantText: "退出前已经显示的正文",
    toolCalls: [],
    toolResultRecordedAt: {},
    usage: {},
    timeline: [],
    timestamps: {
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
      terminalAt: "2026-01-01T00:00:01.000Z",
    },
  };
}

function control(run: OrdinaryRunState): OrdinaryConversationControlDocument {
  return {
    schemaVersion: "ordinary-conversation/v1",
    revision: 1,
    savedAt: run.timestamps.updatedAt,
    state: {
      conversationId: run.turn.conversationId,
      createdAt: run.timestamps.createdAt,
      activeLineageId: run.turn.lineageId,
      lineages: [{ lineageId: run.turn.lineageId, createdAt: run.timestamps.createdAt }],
    },
  };
}
