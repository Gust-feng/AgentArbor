import assert from "node:assert/strict";
import test from "node:test";
import type {
  OrdinaryConversationControlDocument,
  OrdinaryRunState,
  OrdinaryRunStatus,
} from "./contracts.js";
import { projectOrdinaryConversation, visibleOrdinaryConversationRuns } from "./conversation-projection.js";
import { ordinaryAgentSessionRef, ordinaryRunBirth, ordinaryRunTurn } from "./test-support.js";

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
  }, {
    status: {
      kind: "blocked",
      reason: {
        code: "tool_execution_outcome_unknown",
        message: "The process restarted before at least one tool outcome could be determined.",
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

test("conversation visibility follows the Session active branch and appends only its pending successor chain", () => {
  const first = completedRun("run-1", undefined, 1, "entry-1");
  const abandoned = completedRun("run-2-abandoned", "run-1", 2, "entry-abandoned");
  const queued = {
    ...completedRun("run-2-queued", "run-1", 2, "unused"),
    status: { kind: "queued" } as const,
    session: { phase: "not_started" } as const,
  };
  const document = control(first);

  const visible = visibleOrdinaryConversationRuns(document, [first, abandoned, queued], [{
    sessionId: first.sessionRef.sessionId,
    entryId: "entry-1",
  }]);

  assert.deepEqual(visible.map((run) => run.runId), ["run-1", "run-2-queued"]);
});

test("conversation visibility rejects an empty Session branch when durable run entries still exist", () => {
  const completed = completedRun("run-durable", undefined, 1, "entry-durable");
  const staleQueued = {
    ...completedRun("run-stale", "run-durable", 2, "unused"),
    status: { kind: "queued" } as const,
    session: { phase: "not_started" } as const,
  };

  assert.throws(
    () => visibleOrdinaryConversationRuns(control(completed), [completed, staleQueued], []),
    /durable runs but no active Session branch/u,
  );
});

test("conversation visibility qualifies branch entries by their owning Session", () => {
  const first = completedRun("run-owner", undefined, 1, "same-entry");
  const foreignSession = ordinaryAgentSessionRef("foreign-session");
  const foreign = {
    ...completedRun("run-foreign", "run-owner", 2, "same-entry"),
    sessionRef: foreignSession,
    session: {
      phase: "rollbackable" as const,
      startLeafRef: null,
      endLeafRef: { sessionId: foreignSession.sessionId, entryId: "same-entry" },
      compactionEntryRefs: [],
    },
  };

  assert.throws(
    () => visibleOrdinaryConversationRuns(control(first), [first, foreign], [{
      sessionId: first.sessionRef.sessionId,
      entryId: "same-entry",
    }]),
    /does not belong to conversation Session/u,
  );
  assert.throws(
    () => visibleOrdinaryConversationRuns(control(first), [first], [{
      sessionId: foreignSession.sessionId,
      entryId: "same-entry",
    }]),
    /foreign Session branch entry/u,
  );
});

function interruptedRun(runId: string, status: OrdinaryRunStatus): OrdinaryRunState {
  const turn = ordinaryRunTurn(runId);
  return {
    runId,
    sessionRef: ordinaryAgentSessionRef(),
    turn,
    input: { userMessage: "继续回答" },
    birth: ordinaryRunBirth(),
    status,
    session: {
      phase: "rollbackable",
      startLeafRef: null,
      endLeafRef: { sessionId: ordinaryAgentSessionRef().sessionId, entryId: `${runId}-end` },
      compactionEntryRefs: [],
    },
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

function completedRun(
  runId: string,
  predecessorRunId: string | undefined,
  ordinal: number,
  endEntryId: string,
): OrdinaryRunState {
  const base = interruptedRun(runId, { kind: "completed" });
  return {
    ...base,
    turn: predecessorRunId === undefined
      ? { ...base.turn, ordinal }
      : { ...base.turn, ordinal, predecessorRunId },
    visibleAssistantText: undefined,
    session: {
      phase: "rollbackable",
      startLeafRef: null,
      endLeafRef: { sessionId: base.sessionRef.sessionId, entryId: endEntryId },
      compactionEntryRefs: [],
    },
  };
}

function control(run: OrdinaryRunState): OrdinaryConversationControlDocument {
  return {
    schemaVersion: "ordinary-conversation/v3",
    revision: 1,
    savedAt: run.timestamps.updatedAt,
    state: {
      conversationId: run.turn.conversationId,
      createdAt: run.timestamps.createdAt,
      sessionRef: run.sessionRef,
    },
  };
}