import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptOrdinaryToolRound,
  createInitialOrdinaryRunState,
  reconcileInterruptedOrdinaryNestedToolCalls,
  reconcileInterruptedOrdinaryToolRound,
  recordOrdinaryNestedToolRequests,
  recordOrdinaryToolResult,
  transitionOrdinaryRun,
} from "./state.js";
import { ordinaryAgentSessionRef, ordinaryRunBirth, ordinaryRunTurn } from "./test-support.js";

test("Ordinary run reducer keeps one status, strips ephemeral attachments, and appends monotonic events", () => {
  const initial = createInitialOrdinaryRunState({
    runId: "run-1",
    sessionRef: ordinaryAgentSessionRef(),
    turn: ordinaryRunTurn("run-1"),
    runInput: {
      userMessage: "inspect the image",
      taskSoil: {
        contextRefs: [{
          attachmentId: "image-1",
          ref: "file:image.png",
          kind: "file",
          title: "image.png",
          summary: "Selected image",
          metadata: { mimeType: "image/png", byteLength: 42, available: true, truncated: false },
          readonlyPreview: { title: "Preview", text: "image preview" },
        }],
        permissionBoundaryRefs: ["read:file:image.png"],
      },
    },
    birth: ordinaryRunBirth(),
    recordedAt: "2026-01-01T00:00:00.000Z",
    eventId: "event-1",
  });

  assert.deepEqual(Object.keys(initial).sort(), [
    "birth", "input", "runId", "session", "sessionRef", "status", "timeline", "timestamps", "toolCalls",
    "toolResultRecordedAt", "turn", "usage",
  ]);
  assert.equal(JSON.stringify(initial).includes("BASE64_MUST_NOT_PERSIST"), false);
  assert.equal(initial.input.taskSoil?.contextRefs?.[0]?.attachmentId, "image-1");
  assert.equal(initial.input.taskSoil?.contextRefs?.[0]?.readonlyPreview?.text, "image preview");
  assert.deepEqual(initial.input.taskSoil?.permissionBoundaryRefs, ["read:file:image.png"]);

  const running = transitionOrdinaryRun({
    state: initial,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-2",
  });
  const withStartLeaf = checkpoint(running, {
    kind: "start_leaf_captured",
    sessionId: "agent-session-1",
    startLeafRef: null,
  }, "2026-01-01T00:00:01.100Z");
  const withInput = checkpoint(withStartLeaf, {
    kind: "input_entry_committed",
    sessionId: "agent-session-1",
    inputEntryRef: entryRef("input-entry"),
  }, "2026-01-01T00:00:01.200Z");
  const withCandidate = checkpoint(withInput, {
    kind: "assistant_response_entry_committed",
    sessionId: "agent-session-1",
    assistantEntryRef: entryRef("answer-entry"),
  }, "2026-01-01T00:00:01.300Z");
  assert.deepEqual(withCandidate.session, {
    phase: "completion_candidate",
    startLeafRef: null,
    rollbackLeafRef: entryRef("input-entry"),
    assistantEntryRef: entryRef("answer-entry"),
    compactionEntryRefs: [],
  });
  const completed = transitionOrdinaryRun({
    state: withCandidate,
    transition: {
      type: "complete",
      session: executionRefs("answer-entry"),
      toolCalls: [],
      usage: { inputTokens: 7, outputTokens: 2, totalTokens: 9 },
    },
    recordedAt: "2026-01-01T00:00:02.000Z",
    eventId: "event-3",
  });

  assert.deepEqual(completed.timeline.map((event) => event.sequence), [1, 2, 3]);
  assert.deepEqual(completed.timeline.map((event) => event.type), ["run.created", "run.started", "run.completed"]);
  assert.deepEqual(completed.status, { kind: "completed" });
  assert.deepEqual(completed.session, {
    phase: "rollbackable",
    startLeafRef: null,
    endLeafRef: entryRef("answer-entry"),
    compactionEntryRefs: [],
  });
  assert.deepEqual(completed.usage, { inputTokens: 7, outputTokens: 2, totalTokens: 9 });
  assert.equal(completed.timestamps.terminalAt, "2026-01-01T00:00:02.000Z");
  assert.throws(() => transitionOrdinaryRun({
    state: completed,
    transition: { type: "cancel", reason: "too late" },
    recordedAt: "2026-01-01T00:00:03.000Z",
    eventId: "event-4",
  }), /completed status/u);
});

test("Ordinary run reducer persists explicit Session phases without appending product timeline events", () => {
  let state = createInitialOrdinaryRunState({
    runId: "session-run",
    sessionRef: ordinaryAgentSessionRef(),
    turn: ordinaryRunTurn("session-run"),
    runInput: { userMessage: "inspect" },
    birth: ordinaryRunBirth(),
    recordedAt: "2026-01-01T00:00:00.000Z",
    eventId: "event-1",
  });
  state = transitionOrdinaryRun({
    state,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-2",
  });
  state = transitionOrdinaryRun({
    state,
    transition: { type: "record_session_checkpoint", checkpoint: {
      kind: "start_leaf_captured",
      sessionId: "agent-session-1",
      startLeafRef: null,
    } },
    recordedAt: "2026-01-01T00:00:02.000Z",
    eventId: "event-3",
  });
  state = transitionOrdinaryRun({
    state,
    transition: { type: "record_session_checkpoint", checkpoint: {
      kind: "input_entry_committed",
      sessionId: "agent-session-1",
      inputEntryRef: { sessionId: "agent-session-1", entryId: "input-entry" },
    } },
    recordedAt: "2026-01-01T00:00:03.000Z",
    eventId: "event-4",
  });

  assert.deepEqual(state.session, {
    phase: "rollbackable",
    startLeafRef: null,
    endLeafRef: { sessionId: "agent-session-1", entryId: "input-entry" },
    compactionEntryRefs: [],
  });
  assert.deepEqual(state.timeline.map((event) => event.type), ["run.created", "run.started"]);
  const compacted = transitionOrdinaryRun({
    state,
    transition: { type: "record_session_checkpoint", checkpoint: {
      kind: "compaction_entry_committed",
      sessionId: "agent-session-1",
      compactionEntryRef: { sessionId: "agent-session-1", entryId: "compaction-entry" },
      tokensBefore: 4_096,
    } },
    recordedAt: "2026-01-01T00:00:03.500Z",
    eventId: "event-compaction",
  });
  assert.deepEqual(compacted.timeline.at(-1), {
    eventId: "event-compaction",
    runId: "session-run",
    sequence: 3,
    recordedAt: "2026-01-01T00:00:03.500Z",
    type: "context.compaction.completed",
    compactionEntryRef: { sessionId: "agent-session-1", entryId: "compaction-entry" },
    tokensBefore: 4_096,
  });
  assert.throws(() => transitionOrdinaryRun({
    state,
    transition: { type: "record_session_checkpoint", checkpoint: {
      kind: "input_entry_committed",
      sessionId: "different-session",
      inputEntryRef: { sessionId: "different-session", entryId: "other-input" },
    } },
    recordedAt: "2026-01-01T00:00:04.000Z",
    eventId: "event-5",
  }), /does not match the run Session identity/u);
});

test("Ordinary approval pauses require the exact approval tool facts", () => {
  const initial = createInitialOrdinaryRunState({
    runId: "approval-facts-run",
    sessionRef: ordinaryAgentSessionRef(),
    turn: ordinaryRunTurn("approval-facts-run"),
    runInput: { userMessage: "change the file" },
    birth: ordinaryRunBirth(),
    recordedAt: "2026-01-01T00:00:00.000Z",
    eventId: "event-1",
  });
  const running = transitionOrdinaryRun({
    state: initial,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-2",
  });
  const request = {
    confirmationId: "approval-facts-confirmation",
    toolCallFactId: "approval-facts-tool",
    title: "Confirm command",
    actionSummary: "Run a command",
    affectedResources: ["workspace"],
    riskLevel: "medium" as const,
    resumeAvailability: "live" as const,
    requestedAt: "2026-01-01T00:00:02.000Z",
    sourceRefs: [],
  };
  const approvalFact = {
    callId: request.toolCallFactId,
    toolName: "shell",
    input: { command: "write" },
    output: undefined,
    status: "approval_required" as const,
    durationMs: 0,
    confirmationRequest: request,
  };
  const approvalStatus = {
    kind: "awaiting_approval" as const,
    confirmationRequests: [request],
    continuationAvailability: "live_only" as const,
  };

  assert.throws(() => transitionOrdinaryRun({
    state: running,
    transition: {
      type: "request_approval",
      status: approvalStatus,
      toolCalls: [],
      usage: {},
    },
    recordedAt: "2026-01-01T00:00:02.000Z",
    eventId: "event-3",
  }), /must match its approval tool facts/u);

  const paused = transitionOrdinaryRun({
    state: running,
    transition: {
      type: "request_approval",
      status: approvalStatus,
      toolCalls: [approvalFact],
      usage: {},
    },
    recordedAt: "2026-01-01T00:00:02.000Z",
    eventId: "event-3",
  });
  assert.equal(paused.status.kind, "awaiting_approval");
  assert.deepEqual(paused.toolCalls, [approvalFact]);
});

test("Ordinary tool facts are idempotent, ordered, and reject conflicting resolved results", () => {
  const queued = createInitialOrdinaryRunState({
    runId: "tool-facts-run",
    sessionRef: ordinaryAgentSessionRef(),
    turn: ordinaryRunTurn("tool-facts-run"),
    runInput: { userMessage: "read" },
    birth: ordinaryRunBirth(),
    recordedAt: "2026-01-01T00:00:00.000Z",
    eventId: "event-1",
  });
  const running = transitionOrdinaryRun({
    state: queued,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-2",
  });
  const result = {
    callId: "call-1",
    toolName: "read",
    input: { path: "README.md" },
    status: "completed" as const,
    output: { content: "first" },
    durationMs: 1,
  };
  const recorded = recordOrdinaryToolResult({ state: running, result, recordedAt: "2026-01-01T00:00:02.000Z" });
  const repeated = recordOrdinaryToolResult({ state: recorded, result, recordedAt: "2026-01-01T00:00:03.000Z" });
  assert.deepEqual(repeated.toolCalls, [result]);
  assert.equal(repeated.toolResultRecordedAt["call-1:completed"], "2026-01-01T00:00:02.000Z");
  assert.throws(() => recordOrdinaryToolResult({
    state: repeated,
    result: { ...result, output: { content: "conflict" } },
    recordedAt: "2026-01-01T00:00:04.000Z",
  }), /different resolved result/u);
});

test("Ordinary nested tool facts require one known root owner and cannot form another nesting level", () => {
  const queued = createInitialOrdinaryRunState({
    runId: "nested-fact-graph-run",
    sessionRef: ordinaryAgentSessionRef(),
    turn: ordinaryRunTurn("nested-fact-graph-run"),
    runInput: { userMessage: "delegate" },
    birth: ordinaryRunBirth(),
    recordedAt: "2026-01-01T00:00:00.000Z",
    eventId: "event-1",
  });
  const running = transitionOrdinaryRun({
    state: queued,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-2",
  });
  const rootResult = {
    callId: "delegation-call",
    toolName: "agent_call",
    input: { agentId: "reviewer" },
    output: { answer: "reviewed" },
    status: "completed" as const,
    durationMs: 2,
  };
  const withRecordedRoot = recordOrdinaryToolResult({
    state: running,
    result: rootResult,
    recordedAt: "2026-01-01T00:00:02.000Z",
  });
  const nestedResult = {
    callId: "read-call",
    factId: "delegation-call/tool:read-call",
    parentToolCallFactId: "delegation-call",
    toolName: "read",
    input: { path: "README.md" },
    output: { content: "contents" },
    status: "completed" as const,
    durationMs: 1,
  };
  const withNested = recordOrdinaryToolResult({
    state: withRecordedRoot,
    result: nestedResult,
    recordedAt: "2026-01-01T00:00:03.000Z",
  });
  assert.deepEqual(withNested.toolCalls, [rootResult, nestedResult]);

  const invalidResults = [
    {
      ...nestedResult,
      factId: undefined,
    },
    {
      ...nestedResult,
      factId: nestedResult.callId,
    },
    {
      ...nestedResult,
      factId: "orphan/tool:read-call",
      parentToolCallFactId: "missing-root",
    },
    {
      ...nestedResult,
      factId: "delegation-call/tool:nested-child",
      parentToolCallFactId: nestedResult.factId,
    },
    {
      ...nestedResult,
      factId: rootResult.callId,
    },
    {
      ...nestedResult,
      parentToolCallFactId: undefined,
    },
  ];
  for (const result of invalidResults) {
    assert.throws(() => recordOrdinaryToolResult({
      state: withNested,
      result,
      recordedAt: "2026-01-01T00:00:04.000Z",
    }), /nested tool (?:fact|result)|root tool fact|known root tool fact|identity conflicts/u);
  }
});

test("Ordinary nested results never close their parent's pending root tool round", () => {
  const queued = createInitialOrdinaryRunState({
    runId: "nested-pending-round-run",
    sessionRef: ordinaryAgentSessionRef(),
    turn: ordinaryRunTurn("nested-pending-round-run"),
    runInput: { userMessage: "delegate" },
    birth: ordinaryRunBirth(),
    recordedAt: "2026-01-01T00:00:00.000Z",
    eventId: "event-1",
  });
  const running = transitionOrdinaryRun({
    state: queued,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-2",
  });
  const rollbackable = withRollbackableSession(running);
  const accepted = acceptOrdinaryToolRound({
    state: rollbackable,
    assistantEntryRef: entryRef("assistant-entry"),
    toolCallIds: ["delegation-call"],
  });
  const withNested = recordOrdinaryToolResult({
    state: accepted,
    result: {
      callId: "delegation-call",
      factId: "delegation-call/tool:delegation-call",
      parentToolCallFactId: "delegation-call",
      toolName: "read",
      input: { path: "README.md" },
      output: { content: "contents" },
      status: "completed",
      durationMs: 1,
    },
    recordedAt: "2026-01-01T00:00:03.000Z",
  });
  assert.notEqual(withNested.pendingToolRound, undefined);

  const withRoot = recordOrdinaryToolResult({
    state: withNested,
    result: {
      callId: "delegation-call",
      toolName: "agent_call",
      input: { agentId: "reviewer" },
      output: { answer: "reviewed" },
      status: "completed",
      durationMs: 2,
    },
    recordedAt: "2026-01-01T00:00:04.000Z",
  });
  assert.notEqual(withRoot.pendingToolRound, undefined);
  const committed = checkpoint(withRoot, {
    kind: "tool_result_entries_committed",
    sessionId: "agent-session-1",
    toolRoundLeafRef: entryRef("tool-round-leaf"),
    toolCallIds: ["delegation-call"],
  }, "2026-01-01T00:00:05.000Z");
  assert.equal(committed.pendingToolRound, undefined);
});

test("Ordinary pending root rounds freeze the Session assistant ref and provider order", () => {
  const queued = createInitialOrdinaryRunState({
    runId: "pending-identity-run",
    sessionRef: ordinaryAgentSessionRef(),
    turn: ordinaryRunTurn("pending-identity-run"),
    runInput: { userMessage: "inspect" },
    birth: ordinaryRunBirth(),
    recordedAt: "2026-01-01T00:00:00.000Z",
    eventId: "event-1",
  });
  const running = transitionOrdinaryRun({
    state: queued,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-2",
  });
  const rollbackable = withRollbackableSession(running);
  const accepted = acceptOrdinaryToolRound({
    state: rollbackable,
    assistantEntryRef: entryRef("assistant-entry"),
    toolCallIds: ["root-call", "second-call"],
  });
  assert.deepEqual(accepted.pendingToolRound, {
    assistantEntryRef: entryRef("assistant-entry"),
    toolCallIds: ["root-call", "second-call"],
  });

  assert.throws(() => acceptOrdinaryToolRound({
    state: rollbackable,
    assistantEntryRef: entryRef("assistant-entry"),
    toolCallIds: ["root-call", "root-call"],
  }), /duplicate tool call identities/u);
  assert.throws(() => acceptOrdinaryToolRound({
    state: rollbackable,
    assistantEntryRef: { sessionId: "other-session", entryId: "assistant-entry" },
    toolCallIds: ["root-call"],
  }), /different Session/u);

  const partiallyResolved = recordOrdinaryToolResult({
    state: accepted,
    result: {
      callId: "root-call",
      toolName: "read",
      input: { path: "README.md" },
      output: { content: "contents" },
      status: "completed",
      durationMs: 1,
    },
    recordedAt: "2026-01-01T00:00:03.000Z",
  });
  assert.notEqual(partiallyResolved.pendingToolRound, undefined);

  const resolved = recordOrdinaryToolResult({
    state: partiallyResolved,
    result: {
      callId: "second-call",
      toolName: "list",
      input: { path: "." },
      output: ["README.md"],
      status: "completed",
      durationMs: 1,
    },
    recordedAt: "2026-01-01T00:00:03.000Z",
  });
  assert.deepEqual(resolved.toolCalls[0]?.input, { path: "README.md" });
  assert.notEqual(resolved.pendingToolRound, undefined);
  const committed = checkpoint(resolved, {
    kind: "tool_result_entries_committed",
    sessionId: "agent-session-1",
    toolRoundLeafRef: entryRef("tool-round-leaf"),
    toolCallIds: ["root-call", "second-call"],
  }, "2026-01-01T00:00:04.000Z");
  assert.equal(committed.pendingToolRound, undefined);
  assert.deepEqual(committed.session, {
    phase: "rollbackable",
    startLeafRef: null,
    endLeafRef: entryRef("tool-round-leaf"),
    compactionEntryRefs: [],
  });

  assert.throws(() => reconcileInterruptedOrdinaryToolRound({
    state: accepted,
    orderedToolCalls: [{ callId: "second-call", toolName: "list", input: { path: "." } }],
    recordedAt: "2026-01-01T00:00:04.000Z",
  }), /does not match its provider-ordered Session tool calls/u);
});

test("Ordinary nested write-ahead atomically closes terminal facts and recovers exact unknowns", () => {
  const queued = createInitialOrdinaryRunState({
    runId: "nested-write-ahead",
    sessionRef: ordinaryAgentSessionRef(),
    turn: ordinaryRunTurn("nested-write-ahead"),
    runInput: { userMessage: "delegate" },
    birth: ordinaryRunBirth(),
    recordedAt: "2026-01-01T00:00:00.000Z",
    eventId: "created",
  });
  const running = transitionOrdinaryRun({
    state: queued,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "started",
  });
  const rootPending = acceptOrdinaryToolRound({
    state: withRollbackableSession(running),
    assistantEntryRef: entryRef("assistant-entry"),
    toolCallIds: ["parent-a", "parent-b"],
  });
  const nestedRequests = ["parent-a", "parent-b"].map((parentToolCallFactId) => ({
    callId: "shared-provider-call",
    factId: `agent-tool:${parentToolCallFactId.length}:${parentToolCallFactId}/tool:shared-provider-call`,
    parentToolCallFactId,
    toolName: "write",
    input: { path: `${parentToolCallFactId}.txt` },
  }));
  const accepted = recordOrdinaryNestedToolRequests({
    state: rootPending,
    requests: nestedRequests,
    recordedAt: "2026-01-01T00:00:02.000Z",
  });
  assert.equal(accepted.pendingNestedToolCalls?.length, 2);

  const firstResult = {
    ...nestedRequests[0]!,
    output: { written: true },
    status: "completed" as const,
    durationMs: 1,
  };
  const firstClosed = recordOrdinaryToolResult({
    state: accepted,
    result: firstResult,
    recordedAt: "2026-01-01T00:00:03.000Z",
  });
  assert.deepEqual(firstClosed.pendingNestedToolCalls, [nestedRequests[1]]);
  assert.equal(recordOrdinaryToolResult({
    state: firstClosed,
    result: firstResult,
    recordedAt: "2026-01-01T00:00:04.000Z",
  }), firstClosed);

  const recovered = reconcileInterruptedOrdinaryNestedToolCalls({
    state: firstClosed,
    recordedAt: "2026-01-01T00:00:05.000Z",
  });
  const unknown = recovered.toolCalls.find((result) => result.factId === nestedRequests[1]?.factId);
  assert.equal(recovered.pendingNestedToolCalls, undefined);
  assert.equal(unknown?.status, "failed");
  assert.equal(unknown?.errorFacts?.code, "tool_execution_outcome_unknown");
  assert.equal(unknown?.parentToolCallFactId, "parent-b");
  assert.deepEqual(unknown?.input, { path: "parent-b.txt" });
});

test("Ordinary nested approval recovery distinguishes unexecuted from approved unknown outcomes", () => {
  const queued = createInitialOrdinaryRunState({
    runId: "nested-approval-recovery",
    sessionRef: ordinaryAgentSessionRef(),
    turn: ordinaryRunTurn("nested-approval-recovery"),
    runInput: { userMessage: "delegate a write" },
    birth: ordinaryRunBirth(),
    recordedAt: "2026-01-01T00:00:00.000Z",
    eventId: "created",
  });
  const running = transitionOrdinaryRun({
    state: queued,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "started",
  });
  const withRootPending = acceptOrdinaryToolRound({
    state: withRollbackableSession(running),
    assistantEntryRef: entryRef("approval-assistant-entry"),
    toolCallIds: ["parent-approval"],
  });
  const confirmationRequest = {
    confirmationId: "nested-write-confirmation",
    toolCallFactId: "agent-tool:15:parent-approval/tool:nested-write",
    title: "Confirm write",
    actionSummary: "Write a file",
    affectedResources: ["workspace"],
    riskLevel: "medium" as const,
    resumeAvailability: "live" as const,
    requestedAt: "2026-01-01T00:00:02.000Z",
    sourceRefs: [],
  };
  const nestedRequest = {
    callId: "nested-write",
    factId: confirmationRequest.toolCallFactId,
    parentToolCallFactId: "parent-approval",
    toolName: "write",
    input: { path: "result.txt", content: "updated" },
  };
  const accepted = recordOrdinaryNestedToolRequests({
    state: withRootPending,
    requests: [nestedRequest],
    recordedAt: "2026-01-01T00:00:02.000Z",
  });
  const approvalResult = {
    ...nestedRequest,
    output: undefined,
    status: "approval_required" as const,
    durationMs: 0,
    confirmationRequest,
  };
  const withApprovalFact = recordOrdinaryToolResult({
    state: accepted,
    result: approvalResult,
    recordedAt: "2026-01-01T00:00:03.000Z",
  });
  const paused = transitionOrdinaryRun({
    state: withApprovalFact,
    transition: {
      type: "request_approval",
      status: {
        kind: "awaiting_approval",
        confirmationRequests: [confirmationRequest],
        continuationAvailability: "live_only",
      },
      toolCalls: [approvalResult],
      usage: {},
    },
    recordedAt: "2026-01-01T00:00:04.000Z",
    eventId: "approval-requested",
  });

  const unexecuted = reconcileInterruptedOrdinaryNestedToolCalls({
    state: paused,
    recordedAt: "2026-01-01T00:00:05.000Z",
  });
  const unexecutedResult = unexecuted.toolCalls.find((result) => result.factId === nestedRequest.factId);
  assert.equal(unexecuted.pendingNestedToolCalls, undefined);
  assert.equal(unexecutedResult?.status, "cancelled");
  assert.equal(unexecutedResult?.errorFacts?.code, "confirmation_continuation_lost");

  const approved = transitionOrdinaryRun({
    state: paused,
    transition: {
      type: "approval_decided",
      decision: {
        confirmationId: confirmationRequest.confirmationId,
        decision: "approve_once",
        decidedAt: "2026-01-01T00:00:05.000Z",
      },
    },
    recordedAt: "2026-01-01T00:00:05.000Z",
    eventId: "approval-decided",
  });
  const outcomeUnknown = reconcileInterruptedOrdinaryNestedToolCalls({
    state: approved,
    recordedAt: "2026-01-01T00:00:06.000Z",
  });
  const unknownResult = outcomeUnknown.toolCalls.find((result) => result.factId === nestedRequest.factId);
  assert.equal(outcomeUnknown.pendingNestedToolCalls, undefined);
  assert.equal(unknownResult?.status, "failed");
  assert.equal(unknownResult?.errorFacts?.code, "tool_execution_outcome_unknown");
  assert.equal(unknownResult?.errorFacts?.doNotBlindlyRetry, true);
});

test("Ordinary completion rejects a Session that has no rollbackable answer leaf", () => {
  const running = transitionOrdinaryRun({
    state: createInitialOrdinaryRunState({
      runId: "missing-end-leaf",
      sessionRef: ordinaryAgentSessionRef(),
      turn: ordinaryRunTurn("missing-end-leaf"),
      runInput: { userMessage: "answer" },
      birth: ordinaryRunBirth(),
      recordedAt: "2026-01-01T00:00:00.000Z",
      eventId: "event-1",
    }),
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-2",
  });
  assert.throws(() => transitionOrdinaryRun({
    state: running,
    transition: {
      type: "complete",
      session: { ...executionRefs("answer-entry"), latestLeafRef: null },
      toolCalls: [],
      usage: {},
    },
    recordedAt: "2026-01-01T00:00:02.000Z",
    eventId: "event-3",
  }), /rollbackable end leaf/u);
});

test("terminal Ordinary states can close a pending Session tool round during recovery", () => {
  const initial = createInitialOrdinaryRunState({
    runId: "terminal-pending-round",
    sessionRef: ordinaryAgentSessionRef(),
    turn: ordinaryRunTurn("terminal-pending-round"),
    runInput: { userMessage: "inspect" },
    birth: ordinaryRunBirth(),
    recordedAt: "2026-01-01T00:00:00.000Z",
    eventId: "created",
  });
  const running = transitionOrdinaryRun({
    state: initial,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "started",
  });
  const rollbackable = withRollbackableSession(running);
  const pending = acceptOrdinaryToolRound({
    state: rollbackable,
    assistantEntryRef: entryRef("assistant-entry"),
    toolCallIds: ["root-call"],
  });
  const withResult = recordOrdinaryToolResult({
    state: pending,
    result: {
      callId: "root-call",
      toolName: "shell",
      input: { command: "write" },
      output: undefined,
      status: "failed",
      error: "outcome unknown",
      errorFacts: { code: "tool_execution_outcome_unknown" },
      durationMs: 0,
    },
    recordedAt: "2026-01-01T00:00:02.000Z",
  });

  for (const transition of [
    { type: "fail" as const, error: { code: "provider_failed", message: "disconnected" } },
    { type: "cancel" as const, reason: "cancelled_by_user" },
    { type: "block" as const, reason: { code: "execution_continuation_lost", message: "restart" }, continueBy: "new_turn" as const },
  ]) {
    const terminal = transitionOrdinaryRun({
      state: withResult,
      transition,
      recordedAt: "2026-01-01T00:00:03.000Z",
      eventId: `terminal-${transition.type}`,
    });
    const closed = checkpoint(terminal, {
      kind: "tool_result_entries_committed",
      sessionId: "agent-session-1",
      toolRoundLeafRef: entryRef("tool-round-leaf"),
      toolCallIds: ["root-call"],
    }, "2026-01-01T00:00:04.000Z");
    assert.equal(
      closed.status.kind,
      transition.type === "fail" ? "failed" : transition.type === "cancel" ? "cancelled" : "blocked",
    );
    assert.equal(closed.pendingToolRound, undefined);
  }
});

function entryRef(entryId: string) {
  return { sessionId: "agent-session-1", entryId };
}

function executionRefs(latestEntryId: string) {
  return {
    sessionId: "agent-session-1",
    startLeafRef: null,
    inputEntryRef: entryRef("input-entry"),
    safeLeafRef: entryRef("input-entry"),
    latestLeafRef: entryRef(latestEntryId),
    compactionEntryRefs: [],
  };
}

function withRollbackableSession(state: Parameters<typeof transitionOrdinaryRun>[0]["state"]) {
  const started = checkpoint(state, {
    kind: "start_leaf_captured",
    sessionId: "agent-session-1",
    startLeafRef: null,
  }, "2026-01-01T00:00:01.100Z");
  return checkpoint(started, {
    kind: "input_entry_committed",
    sessionId: "agent-session-1",
    inputEntryRef: entryRef("input-entry"),
  }, "2026-01-01T00:00:01.200Z");
}

function checkpoint(
  state: Parameters<typeof transitionOrdinaryRun>[0]["state"],
  checkpointValue: Parameters<typeof transitionOrdinaryRun>[0]["transition"] extends infer Transition
    ? Transition extends { readonly type: "record_session_checkpoint"; readonly checkpoint: infer Checkpoint }
      ? Checkpoint
      : never
    : never,
  recordedAt: string,
) {
  return transitionOrdinaryRun({
    state,
    transition: { type: "record_session_checkpoint", checkpoint: checkpointValue },
    recordedAt,
    eventId: `checkpoint-${recordedAt}`,
  });
}
