import assert from "node:assert/strict";
import test from "node:test";
import type { ConfirmationRequest } from "../../domain/confirmation/index.js";
import type {
  OrdinaryConversationReadModel,
  OrdinaryRunActivity,
  OrdinaryRunActivityReplay,
  OrdinaryRunEvent,
  OrdinaryRunState,
  OrdinaryRunStatus,
} from "../ordinary-agent/contracts.js";
import { durableOrdinaryRunReplayFromState } from "../ordinary-agent/ordinary-agent-feature.js";
import {
  ordinaryAgentSessionRef,
  ordinaryCapabilityResolution,
  ordinaryRunBirth,
  ordinaryRunTurn,
} from "../ordinary-agent/test-support.js";
import {
  OrdinaryPanelCursorError,
  encodeOrdinaryPanelCursor,
  parseOrdinaryPanelCursor,
  projectOrdinaryPanelActivityBatch,
  projectOrdinaryPanelConversation,
  projectOrdinaryPanelConversationSummary,
  projectOrdinaryPanelRunView,
} from "./ordinary-agent-panel-projection.js";

test("ordinary panel cursor is an opaque generation-aware token and rejects numeric legacy cursors", () => {
  const cursor = { streamId: "ordinary-stream-1", sequence: 42 };
  const token = encodeOrdinaryPanelCursor(cursor);

  assert.deepEqual(parseOrdinaryPanelCursor(token), cursor);
  assert.equal(parseOrdinaryPanelCursor(undefined), undefined);
  assert.throws(
    () => parseOrdinaryPanelCursor("42"),
    (error: unknown) => error instanceof OrdinaryPanelCursorError &&
      error.code === "ordinary_panel_cursor_invalid",
  );
  const extraField = Buffer.from(JSON.stringify({ ...cursor, runId: "must-not-be-accepted" }), "utf8").toString("base64url");
  assert.throws(() => parseOrdinaryPanelCursor(extraField), OrdinaryPanelCursorError);
  assert.throws(() => parseOrdinaryPanelCursor(`${token}=`), OrdinaryPanelCursorError);
});

test("run and conversation projection are protocol-neutral for both supported OpenAI wire formats", () => {
  for (const protocol of ["openai_responses", "openai_compatible_chat_completions"] as const) {
    const run = runState({
      runId: `run-${protocol}`,
      status: { kind: "running" },
      protocol,
    });
    const fullReplay = replay(run, [createdEvent(run), startedEvent(run)]);
    const view = projectOrdinaryPanelRunView({ run, fullReplay });
    const conversation = projectOrdinaryPanelConversation({
      conversation: conversationFrom(run),
      currentRun: view,
      workspaceRun: run,
    });

    assert.equal(view.run.status, "running");
    assert.equal(view.run.runMode, "agent");
    assert.equal(view.agentDefinitionRef, run.birth.agentDefinitionRef);
    assert.deepEqual(view.capabilityResolution, run.capabilityResolution);
    assert.equal(conversation.currentRun?.run.runId, run.runId);
    assert.deepEqual(conversation.workspaceFolder, { label: "workspace", path: "Z:/workspace", selection: "explicit" });
    assert.equal(conversation.turns[1]?.responseModel?.protocolKind, protocol);
    assert.equal(conversation.turns[1]?.responseModel?.model, run.birth.config.model);
  }
});

test("legacy conversation projection treats a missing workspace selection as the configured default", () => {
  const base = runState({ runId: "default-workspace-run", status: { kind: "completed" }, answer: "done" });
  const run: OrdinaryRunState = {
    ...base,
    birth: {
      ...base.birth,
      workspaceSelection: undefined,
    },
  };

  const conversation = projectOrdinaryPanelConversation({
    conversation: conversationFrom(run),
    workspaceRun: run,
  });

  assert.deepEqual(conversation.workspaceFolder, {
    label: "默认工作区",
    path: "Z:/workspace",
    selection: "default",
  });
});

test("queued, running, approval and terminal states map without manufacturing another status source", () => {
  const cases: readonly {
    readonly status: OrdinaryRunStatus;
    readonly panelStatus: string;
    readonly stage: string;
  }[] = [
    { status: { kind: "queued" }, panelStatus: "queued", stage: "queued" },
    { status: { kind: "running" }, panelStatus: "running", stage: "understanding" },
    {
      status: {
        kind: "awaiting_approval",
        confirmationRequests: [confirmation("status-run")],
        continuationAvailability: "live_only",
      },
      panelStatus: "approval_needed",
      stage: "awaiting_approval",
    },
    { status: { kind: "completed" }, panelStatus: "completed", stage: "completed" },
    {
      status: { kind: "failed", error: { code: "model_failed", message: "provider failed" } },
      panelStatus: "failed",
      stage: "failed",
    },
    { status: { kind: "cancelled", reason: "user stopped" }, panelStatus: "cancelled", stage: "cancelled" },
    {
      status: {
        kind: "blocked",
        reason: { code: "context_overflow", message: "context full" },
        continueBy: "new_turn",
      },
      panelStatus: "blocked",
      stage: "blocked",
    },
  ];

  for (const [index, item] of cases.entries()) {
    const run = runState({ runId: `status-run-${index}`, status: item.status });
    const view = projectOrdinaryPanelRunView({ run, fullReplay: replay(run, []) });
    assert.equal(view.run.status, item.panelStatus);
    assert.equal(view.workView.stage, item.stage);
    assert.equal(view.detail.status, item.panelStatus);
  }
});

test("restart reset and live text delta remain explicit activity facts", () => {
  const run = runState({ runId: "delta-run", status: { kind: "running" } });
  const activities: readonly OrdinaryRunActivity[] = [
    transitionActivity(run, createdEvent(run), 1),
    transitionActivity(run, startedEvent(run), 2),
    {
      activityId: "activity-delta",
      runId: run.runId,
      sequence: 3,
      recordedAt: "2026-01-01T00:00:03.000Z",
      type: "model.output.delta",
      durability: "live_only",
      modelRequestId: "model-request-1",
      delta: "原始增量 <keep>",
    },
  ];
  const batch = projectOrdinaryPanelActivityBatch({
    run,
    replay: {
      cursor: { streamId: "stream-after-restart", sequence: 3 },
      reset: true,
      activities,
    },
  });

  assert.equal(batch.reset, true);
  assert.equal(parseOrdinaryPanelCursor(batch.cursor.token)?.streamId, "stream-after-restart");
  assert.equal(batch.events.at(-1)?.type, "model.output.delta");
  assert.equal(batch.events.at(-1)?.delta, "原始增量 <keep>");
  assert.deepEqual(batch.events.at(-1)?.refs, [{ kind: "model_call", id: "model-request-1" }]);
  assert.deepEqual(batch.events.map((event) => event.sequence), [1, 2, 3]);
});

test("a persisted context compaction checkpoint projects as a completed system activity", () => {
  const run = runState({ runId: "compaction-run", status: { kind: "running" } });
  const event: OrdinaryRunEvent = {
    eventId: "compaction-run:compacted",
    runId: run.runId,
    sequence: 3,
    recordedAt: "2026-01-01T00:00:03.000Z",
    type: "context.compaction.completed",
    compactionEntryRef: { sessionId: run.sessionRef.sessionId, entryId: "compaction-entry" },
    tokensBefore: 4_096,
  };

  const view = projectOrdinaryPanelRunView({ run, fullReplay: replay(run, [createdEvent(run), startedEvent(run), event]) });

  const node = (view.detail.transcript?.transcriptNodes ?? [])
    .find((item) => item.eventType === "context.compaction.completed");
  assert.equal(node?.kind, "system");
  assert.equal(node?.phase, "completed");
  assert.equal(node?.summary, "上下文压缩完成");
});

test("running transcript projects consecutive output deltas as one logical body", () => {
  const run = runState({ runId: "coalesced-delta-run", status: { kind: "running" } });
  const deltas = ["我是通过 API ", "使用的 OpenAI AI 助手，", "在这里与你交流。"];
  const activities: OrdinaryRunActivity[] = [
    transitionActivity(run, createdEvent(run), 1),
    transitionActivity(run, startedEvent(run), 2),
    ...deltas.map((delta, index): OrdinaryRunActivity => ({
      activityId: `activity-delta-${index + 1}`,
      runId: run.runId,
      sequence: index + 3,
      recordedAt: `2026-01-01T00:00:0${index + 3}.000Z`,
      type: "model.output.delta",
      durability: "live_only",
      modelRequestId: "model-request-1",
      delta,
    })),
  ];

  const view = projectOrdinaryPanelRunView({
    run,
    fullReplay: {
      cursor: { streamId: "ordinary-stream-1", sequence: activities.length },
      reset: false,
      activities,
    },
  });
  const bodyNodes = view.workView.transcriptNodes.filter((node) => node.kind === "body");

  assert.equal(bodyNodes.length, 1);
  assert.equal(bodyNodes[0]?.nodeId, "activity-delta-1");
  assert.equal(bodyNodes[0]?.sequence, 3);
  assert.equal(bodyNodes[0]?.text, deltas.join(""));
  assert.deepEqual(
    view.replay.events.filter((event) => event.type === "model.output.delta").map((event) => event.delta),
    deltas,
  );
});

test("durable replay preserves answer and tool interleaving after a conversation switch", () => {
  const base = runState({
    runId: "durable-interleaved-run",
    status: { kind: "completed" },
    answer: "我先检查文件。检查完成，结论如下。",
    toolCalls: [{
      callId: "call-read",
      toolName: "Read",
      input: { path: "README.md" },
      output: { content: "workspace" },
      status: "completed",
      durationMs: 4,
    }],
  });
  const firstAnswer: OrdinaryRunEvent = {
    eventId: "event-answer-before-tool",
    runId: base.runId,
    sequence: 3,
    recordedAt: "2026-01-01T00:00:03.000Z",
    type: "model.output.completed",
    modelRequestId: "model-request-1",
    assistantEntryRef: { sessionId: base.sessionRef.sessionId, entryId: "assistant-before-tool" },
  };
  const secondAnswer: OrdinaryRunEvent = {
    eventId: "event-answer-after-tool",
    runId: base.runId,
    sequence: 4,
    recordedAt: "2026-01-01T00:00:05.000Z",
    type: "model.output.completed",
    modelRequestId: "model-request-2",
    assistantEntryRef: { sessionId: base.sessionRef.sessionId, entryId: "assistant-after-tool" },
  };
  const completed: OrdinaryRunEvent = {
    eventId: "event-run-completed",
    runId: base.runId,
    sequence: 5,
    recordedAt: "2026-01-01T00:00:06.000Z",
    type: "run.completed",
    toolCallIds: ["call-read"],
  };
  const run: OrdinaryRunState = {
    ...base,
    timeline: [createdEvent(base), startedEvent(base), firstAnswer, secondAnswer, completed],
    toolResultRecordedAt: { "call-read:completed": "2026-01-01T00:00:04.000Z" },
  };

  const view = projectOrdinaryPanelRunView({
    run,
    fullReplay: durableOrdinaryRunReplayFromState(run, [
      { entryRef: firstAnswer.assistantEntryRef, text: "我先检查文件。" },
      { entryRef: secondAnswer.assistantEntryRef, text: "检查完成，结论如下。" },
    ]),
  });
  const visibleSequence = view.workView.transcriptNodes
    .filter((node) => node.kind === "body" || node.kind === "tool")
    .map((node) => node.kind === "body" ? `body:${node.text}` : `tool:${node.toolName}`);

  assert.deepEqual(visibleSequence, [
    "body:我先检查文件。",
    "tool:Read",
    "body:检查完成，结论如下。",
  ]);
});

test("model request activity is visible as quiet workflow progress", () => {
  const run = runState({ runId: "model-request-run", status: { kind: "running" } });
  const fullReplay: OrdinaryRunActivityReplay = {
    cursor: { streamId: "stream-model-request", sequence: 4 },
    reset: false,
    activities: [
      transitionActivity(run, createdEvent(run), 1),
      transitionActivity(run, startedEvent(run), 2),
      {
        activityId: "activity-tool",
        runId: run.runId,
        sequence: 3,
        recordedAt: "2026-01-01T00:00:03.000Z",
        type: "tool.result",
        durability: "durable",
        result: {
          callId: "call-read",
          toolName: "Read",
          input: { path: "package.json" },
          output: { path: "package.json", content: "{}" },
          status: "completed",
          durationMs: 1,
        },
      },
      {
        activityId: "activity-model-request",
        runId: run.runId,
        sequence: 4,
        recordedAt: "2026-01-01T00:00:04.000Z",
        type: "model.request",
        durability: "live_only",
        reason: "after_tool",
      },
    ],
  };

  const view = projectOrdinaryPanelRunView({ run, fullReplay });
  const node = view.workView.transcriptNodes.at(-1);

  assert.equal(view.replay.events.at(-1)?.type, "model.requested");
  assert.equal(view.replay.events.at(-1)?.summary, "分析工具结果");
  assert.deepEqual(view.replay.events.at(-1)?.refs, [{ kind: "model_call", id: "activity-model-request" }]);
  assert.equal(node?.eventType, "model.requested");
  assert.equal(node?.kind, "system");
  assert.equal(node?.phase, "executing");
  assert.equal(node?.summary, "分析工具结果");
});

test("adjacent model fragments never merge across model request identities", () => {
  const run = runState({ runId: "model-identity-boundary-run", status: { kind: "running" } });
  const activities: OrdinaryRunActivity[] = [
    transitionActivity(run, createdEvent(run), 1),
    transitionActivity(run, startedEvent(run), 2),
    {
      activityId: "output-first",
      runId: run.runId,
      sequence: 3,
      recordedAt: "2026-01-01T00:00:03.000Z",
      type: "model.output.delta",
      durability: "live_only",
      modelRequestId: "model-request-1",
      delta: "第一段正文。",
    },
    {
      activityId: "output-second",
      runId: run.runId,
      sequence: 4,
      recordedAt: "2026-01-01T00:00:04.000Z",
      type: "model.output.delta",
      durability: "live_only",
      modelRequestId: "model-request-2",
      delta: "第二段正文。",
    },
    {
      activityId: "reasoning-first",
      runId: run.runId,
      sequence: 5,
      recordedAt: "2026-01-01T00:00:05.000Z",
      type: "model.reasoning.delta",
      durability: "live_only",
      modelRequestId: "model-request-1",
      delta: "第一段思考。",
    },
    {
      activityId: "reasoning-second",
      runId: run.runId,
      sequence: 6,
      recordedAt: "2026-01-01T00:00:06.000Z",
      type: "model.reasoning.delta",
      durability: "live_only",
      modelRequestId: "model-request-2",
      delta: "第二段思考。",
    },
  ];
  const view = projectOrdinaryPanelRunView({
    run,
    fullReplay: {
      cursor: { streamId: "identity-boundary-stream", sequence: 6 },
      reset: false,
      activities,
    },
  });

  assert.deepEqual(
    view.workView.transcriptNodes
      .filter((node) => node.kind === "body" || node.kind === "thinking")
      .map((node) => `${node.kind}:${node.text}`),
    [
      "body:第一段正文。",
      "body:第二段正文。",
      "thinking:第一段思考。",
      "thinking:第二段思考。",
    ],
  );
});

test("failed tool transcript nodes retain failure attribution and raw error", () => {
  const run = runState({ runId: "failed-tool-transcript-run", status: { kind: "running" } });
  const activity: OrdinaryRunActivity = {
    activityId: "tool:call-invalid:failed",
    runId: run.runId,
    sequence: 3,
    recordedAt: "2026-01-01T00:00:03.000Z",
    type: "tool.result",
    durability: "durable",
    result: {
      callId: "call-invalid",
      toolName: "Read",
      input: { path: "" },
      output: undefined,
      status: "failed",
      error: "path must be a non-empty string",
      failureAttribution: "schema_validation",
      durationMs: 1,
    },
  };

  const view = projectOrdinaryPanelRunView({
    run,
    fullReplay: {
      cursor: { streamId: "ordinary-stream-1", sequence: activity.sequence },
      reset: false,
      activities: [activity],
    },
  });
  const node = view.workView.transcriptNodes[0];

  assert.equal(node?.failureAttribution, "schema_validation");
  assert.equal(node?.error, "path must be a non-empty string");
});

test("delegated tool transcript nodes retain execution measurement", () => {
  const run = runState({ runId: "delegated-tool-transcript-run", status: { kind: "running" } });
  const activity: OrdinaryRunActivity = {
    activityId: "tool:delegate:completed",
    runId: run.runId,
    sequence: 3,
    recordedAt: "2026-01-01T00:00:03.000Z",
    type: "tool.result",
    durability: "durable",
    result: {
      callId: "delegate",
      toolName: "Agent",
      input: { task: "inspect" },
      output: "review complete",
      status: "completed",
      delegatedExecution: {
        modelRounds: 2,
        toolCallCount: 1,
        usage: { inputTokens: 18, outputTokens: 7, totalTokens: 25 },
      },
      durationMs: 1,
    },
  };

  const view = projectOrdinaryPanelRunView({
    run,
    fullReplay: {
      cursor: { streamId: "ordinary-stream-1", sequence: activity.sequence },
      reset: false,
      activities: [activity],
    },
  });

  assert.deepEqual(view.replay.events[0]?.detail?.delegatedExecution, activity.result.delegatedExecution);
  assert.deepEqual(view.workView.transcriptNodes[0]?.delegatedExecution, activity.result.delegatedExecution);
});

test("live tool progress projects one executing command row with bounded output evidence", () => {
  const run = runState({ runId: "live-command-run", status: { kind: "running" } });
  const request = {
    callId: "call-command",
    parentToolCallFactId: "delegate-fact",
    toolName: "Shell",
    input: { commandLine: "pnpm test" },
  } as const;
  const activity: OrdinaryRunActivity = {
    activityId: "tool-live:call-command",
    runId: run.runId,
    sequence: 3,
    recordedAt: "2026-01-01T00:00:03.000Z",
    type: "tool.progress",
    durability: "live_only",
    request,
    progress: {
      kind: "command_output",
      stdoutTail: "tests are running\n",
      stdoutChars: 18,
      stderrChars: 0,
    },
  };
  const replay: OrdinaryRunActivityReplay = {
    cursor: { streamId: "ordinary-stream-1", sequence: 3 },
    reset: false,
    activities: [activity],
  };

  const batch = projectOrdinaryPanelActivityBatch({ run, replay });
  const view = projectOrdinaryPanelRunView({ run, fullReplay: replay });
  const event = batch.events[0];
  const node = view.workView.transcriptNodes[0];

  assert.equal(event?.type, "tool.progress");
  assert.equal(event?.parentToolCallFactId, "delegate-fact");
  assert.equal(event?.detail?.display?.kind, "command_summary");
  if (event?.detail?.display?.kind === "command_summary") {
    assert.equal(event.detail.display.commandLine, "pnpm test");
    assert.equal(event.detail.display.stdoutPreview, "tests are running");
  }
  assert.equal(node?.eventType, "tool.requested");
  assert.equal(node?.phase, "executing");
  assert.equal(node?.nodeId, "tool-live:call-command");
});

test("approval projection keeps the complete confirmation and canonical tool result", () => {
  const request = confirmation("approval-run");
  const run = runState({
    runId: "approval-run",
    usage: {
      requestCount: 1,
      inputTokens: 250,
      latestAgentRequest: { inputTokens: 120 },
    },
    status: {
      kind: "awaiting_approval",
      confirmationRequests: [request],
      continuationAvailability: "live_only",
    },
    toolCalls: [{
      callId: "call-approval",
      toolName: "Shell",
      input: { command: "pnpm test" },
      output: undefined,
      status: "approval_required",
      durationMs: 4,
      confirmationRequest: request,
    }],
  });
  const requested: OrdinaryRunEvent = {
    eventId: "event-approval",
    runId: run.runId,
    sequence: 3,
    recordedAt: "2026-01-01T00:00:03.000Z",
    type: "run.approval_requested",
    confirmationRequests: [request],
    toolCallIds: ["call-approval"],
  };
  const view = projectOrdinaryPanelRunView({
    run,
    fullReplay: replay(run, [createdEvent(run), startedEvent(run), requested]),
  });

  const projectedConfirmation = { ...request, ownerRunId: run.runId };
  assert.deepEqual(view.workView.pendingConfirmation, projectedConfirmation);
  assert.deepEqual(view.detail.toolResults, run.toolCalls);
  assert.equal(view.detail.continuationAvailability, "live");
  const node = view.workView.transcriptNodes.find((item) => item.kind === "confirmation");
  assert.deepEqual(node?.confirmation, projectedConfirmation);
  assert.deepEqual(node?.modelUsage, run.usage);
  assert.equal(view.replay.events.at(-1)?.type, "confirmation.needed");
});

test("terminal projection preserves raw answer, full tool output, usage and attachments without a fake canvas", () => {
  const answer = "最终回答 <raw>，不要替换。";
  const run = runState({
    runId: "completed-run",
    status: { kind: "completed" },
    answer,
    usage: {
      inputTokens: 120,
      cachedInputTokens: 80,
      uncachedInputTokens: 40,
      outputTokens: 12,
      totalTokens: 132,
    },
    toolCalls: [{
      callId: "call-read",
      toolName: "Read",
      input: { path: "Z:/workspace/a.txt" },
      output: { content: "完整工具输出 <raw>", byteLength: 24 },
      status: "completed",
      durationMs: 8,
    }],
    withAttachment: true,
  });
  const completed: OrdinaryRunEvent = {
    eventId: "event-completed",
    runId: run.runId,
    sequence: 3,
    recordedAt: "2026-01-01T00:00:03.000Z",
    type: "run.completed",
    toolCallIds: ["call-read"],
  };
  const view = projectOrdinaryPanelRunView({
    run,
    fullReplay: {
      cursor: { streamId: `stream-${run.runId}`, sequence: 4 },
      reset: false,
      activities: [
        transitionActivity(run, createdEvent(run), 1),
        transitionActivity(run, startedEvent(run), 2),
        completedOutputActivity(run, answer, 3),
        {
          activityId: "tool:call-read:completed",
          runId: run.runId,
          sequence: 4,
          recordedAt: completed.recordedAt,
          type: "tool.result",
          durability: "durable",
          result: run.toolCalls[0]!,
        },
        transitionActivity(run, completed, 5),
      ],
    },
  });

  assert.equal(view.workView.answer?.content, answer);
  assert.equal(view.workView.transcriptNodes.find((node) => node.kind === "body")?.text, answer);
  assert.equal(view.replay.events.find((event) => event.type === "model.output.completed")?.delta, answer);
  assert.deepEqual(view.detail.toolResults, run.toolCalls);
  assert.deepEqual(view.detail.usage, run.usage);
  assert.equal("canvas" in view.detail, false);
  assert.equal(view.workView.contextAttachments[0]?.readonlyPreview?.text, "附件原文 <raw>");
  assert.equal(view.workView.contextAttachments[0]?.summary, "附件摘要 <raw>");
  assert.equal(view.workView.workSummary.toolResultCount, 1);
  assert.equal(view.workView.visibleEvents.some((event) => event.type === "tool.completed"), true);
  const toolNode = view.workView.transcriptNodes.find((node) => node.eventType === "tool.completed");
  assert.equal(toolNode?.toolName, "Read");
  assert.equal(toolNode?.display?.kind, "read_result");
});

test("completed reasoning projects as a durable thinking node with full text", () => {
  const run = runState({ runId: "reasoning-run", status: { kind: "completed" }, answer: "最终答案" });
  const reasoning: OrdinaryRunEvent = {
    eventId: "event-reasoning",
    runId: run.runId,
    sequence: 3,
    recordedAt: "2026-01-01T00:00:03.000Z",
    type: "model.reasoning.completed",
    modelRequestId: "model-request-1",
    content: "先分析完整上下文，再组织答案。",
  };
  const completed: OrdinaryRunEvent = {
    eventId: "event-completed",
    runId: run.runId,
    sequence: 4,
    recordedAt: "2026-01-01T00:00:04.000Z",
    type: "run.completed",
    toolCallIds: [],
  };
  const view = projectOrdinaryPanelRunView({
    run: { ...run, timeline: [createdEvent(run), startedEvent(run), reasoning, completed] },
    fullReplay: replay(run, [createdEvent(run), startedEvent(run), reasoning, completed]),
  });

  const node = view.workView.transcriptNodes.find((item) => item.kind === "thinking");
  assert.equal(node?.eventType, "model.reasoning.completed");
  assert.equal(node?.phase, "completed");
  assert.equal(node?.text, reasoning.content);
  assert.deepEqual(node?.refs, [{ kind: "model_call", id: reasoning.modelRequestId }]);
  assert.equal(view.replay.events.find((event) => event.type === "model.reasoning.completed")?.delta, reasoning.content);
});

test("conversation DTO is a one-way projection with full turns, attachments and current run", () => {
  const run = runState({
    runId: "conversation-run",
    status: {
      kind: "awaiting_approval",
      confirmationRequests: [confirmation("conversation-run")],
      continuationAvailability: "live_only",
    },
    withAttachment: true,
  });
  const ordinary = conversationFrom(run);
  const currentRun = projectOrdinaryPanelRunView({ run, fullReplay: replay(run, []) });
  const projected = projectOrdinaryPanelConversation({ conversation: ordinary, currentRun, workspaceRun: run, spaceId: "space-one" });
  const summary = projectOrdinaryPanelConversationSummary(ordinary, run, "space-one");

  assert.equal(projected.status, "approval_needed");
  assert.equal(projected.requiresUserAction, true);
  assert.deepEqual(projected.pendingAction, {
    kind: "approval",
    runId: run.runId,
    assistantTurnId: run.turn.assistantTurnId,
  });
  assert.equal(projected.currentRun?.run.runId, run.runId);
  assert.equal(projected.spaceId, "space-one");
  assert.equal(summary.spaceId, "space-one");
  assert.deepEqual(projected.workspaceFolder, { label: "workspace", path: "Z:/workspace", selection: "explicit" });
  assert.deepEqual(summary.workspaceFolder, projected.workspaceFolder);
  assert.equal(projected.turns[0]?.attachments?.[0]?.summary, "附件摘要 <raw>");
  assert.equal(projected.turns[1]?.content, "");
  assert.equal("turns" in summary, false);
  assert.equal("currentRun" in summary, false);
  assert.equal(ordinary.turns[0]?.content, run.input.userMessage);
});

test("conversation DTO keeps Space standing references out of user-turn attachments", () => {
  const base = runState({
    runId: "conversation-standing-context",
    status: { kind: "completed" },
    withAttachment: true,
  });
  const explicitAttachment = base.input.taskSoil!.contextRefs![0]!;
  const run: OrdinaryRunState = {
    ...base,
    input: {
      ...base.input,
      taskSoil: {
        ...base.input.taskSoil!,
        contextRefs: [{
          attachmentId: "space-reference:legacy-reference",
          ref: "local-file:Z:/workspace/standing-legacy.png",
          pathGranted: true,
          kind: "file",
          title: "standing-legacy.png",
        }, {
          attachmentId: "space-reference:marked-reference",
          ref: "local-file:Z:/workspace/standing-marked.png",
          pathGranted: true,
          automaticSpaceReference: true,
          kind: "file",
          title: "standing-marked.png",
        }, explicitAttachment],
      },
    },
  };
  const ordinary = conversationFrom(run);
  const currentRun = projectOrdinaryPanelRunView({ run, fullReplay: replay(run, []) });

  const projected = projectOrdinaryPanelConversation({ conversation: ordinary, currentRun, workspaceRun: run });

  assert.deepEqual(
    projected.turns[0]?.attachments?.map((attachment) => attachment.attachmentId),
    [explicitAttachment.attachmentId],
  );
  assert.equal(projected.currentRun?.workView?.contextAttachments.length, 3);
});

test("quiet interruptions restore visible text without cancellation or restart notices", () => {
  const cases: readonly {
    readonly runId: string;
    readonly status: OrdinaryRunStatus;
    readonly event: "run.cancelled" | "run.blocked";
    readonly interruption: "user_cancelled" | "runtime_stopped";
  }[] = [{
    runId: "cancelled-view-run",
    status: { kind: "cancelled", reason: "cancelled_by_user" },
    event: "run.cancelled",
    interruption: "user_cancelled",
  }, {
    runId: "restarted-view-run",
    status: {
      kind: "blocked",
      reason: {
        code: "execution_continuation_lost",
        message: "The live execution was interrupted when the process restarted.",
      },
      continueBy: "new_turn",
    },
    event: "run.blocked",
    interruption: "runtime_stopped",
  }];

  for (const item of cases) {
    const run = runState({
      runId: item.runId,
      status: item.status,
      visibleAssistantText: "退出前已经显示的正文",
    });
    const terminalEvent: OrdinaryRunEvent = item.event === "run.cancelled"
      ? {
          eventId: `${item.runId}-terminal`, runId: item.runId, sequence: 1,
          recordedAt: run.timestamps.updatedAt, type: "run.cancelled",
          reason: "cancelled_by_user", toolCallIds: [],
        }
      : {
          eventId: `${item.runId}-terminal`, runId: item.runId, sequence: 1,
          recordedAt: run.timestamps.updatedAt, type: "run.blocked",
          code: "execution_continuation_lost",
        };
    const view = projectOrdinaryPanelRunView({ run, fullReplay: replay(run, [terminalEvent]) });
    const conversation = projectOrdinaryPanelConversation({
      conversation: conversationFrom(run),
      currentRun: view,
      workspaceRun: run,
    });

    assert.equal(conversation.turns[1]?.content, "退出前已经显示的正文");
    assert.equal(conversation.turns[1]?.interruption, item.interruption);
    assert.equal(conversation.preview, "退出前已经显示的正文");
    assert.equal(view.workView.headline, "");
    assert.equal(view.workView.currentAction, "");
    assert.equal(view.workView.visibleEvents.some((event) => event.type === item.event), false);
    assert.equal(view.workView.transcriptNodes.some((node) => node.eventType === item.event), false);
  }
});

function runState(input: {
  readonly runId: string;
  readonly status: OrdinaryRunStatus;
  readonly protocol?: "openai_responses" | "openai_compatible_chat_completions";
  readonly toolCalls?: OrdinaryRunState["toolCalls"];
  readonly usage?: OrdinaryRunState["usage"];
  readonly withAttachment?: boolean;
  readonly visibleAssistantText?: string;
  readonly answer?: string;
}): OrdinaryRunState {
  const baseBirth = ordinaryRunBirth();
  const protocol = input.protocol ?? "openai_responses";
  const birth = protocol === "openai_responses"
    ? baseBirth
    : {
        ...baseBirth,
        aiMode: "openai-compatible" as const,
        config: {
          ...baseBirth.config,
          protocolKind: "openai_compatible_chat_completions" as const,
          defaultAiMode: "openai-compatible" as const,
        },
        capabilitySnapshot: {
          ...baseBirth.capabilitySnapshot,
          activeModel: {
            ...baseBirth.capabilitySnapshot.activeModel,
            protocolKind: "openai_compatible_chat_completions" as const,
            defaultAiMode: "openai-compatible" as const,
          },
          modelCapabilities: {
            ...baseBirth.capabilitySnapshot.modelCapabilities,
            preferredApiStyle: "chat_completions" as const,
          },
        },
      };
  const turn = ordinaryRunTurn(input.runId);
  return {
    runId: input.runId,
    sessionRef: ordinaryAgentSessionRef(),
    turn,
    input: {
      userMessage: "请读取附件并回答",
      taskSoil: input.withAttachment
        ? {
            contextRefs: [{
              attachmentId: "attachment-1",
              ref: "local-file:Z%3A%2Fworkspace%2Fa.txt",
              kind: "file",
              title: "a.txt",
              summary: "附件摘要 <raw>",
              metadata: {
                available: true,
                mimeType: "text/plain",
                byteLength: 24,
                truncated: false,
              },
              readonlyPreview: { title: "a.txt", text: "附件原文 <raw>" },
            }],
            permissionBoundaryRefs: ["read:local-file:Z:/workspace/a.txt"],
          }
        : undefined,
    },
    birth,
    status: input.status,
    session: { phase: "not_started" },
    visibleAssistantText: input.visibleAssistantText ?? input.answer,
    toolCalls: input.toolCalls ?? [],
    toolResultRecordedAt: Object.fromEntries((input.toolCalls ?? []).map((result) => [
      `${result.callId}:${result.status}`,
      "2026-01-01T00:00:02.000Z",
    ])),
    usage: input.usage ?? {},
    capabilityResolution: {
      ...ordinaryCapabilityResolution(),
      capabilityPlan: {
        ...ordinaryCapabilityResolution().capabilityPlan,
        protocolToolCallCapabilities: {
          ...ordinaryCapabilityResolution().capabilityPlan.protocolToolCallCapabilities,
          protocolKind: birth.config.protocolKind,
        },
        modelCapabilities: birth.capabilitySnapshot.modelCapabilities,
      },
    },
    timeline: [],
    timestamps: {
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:03.000Z",
      terminalAt: isTerminal(input.status) ? "2026-01-01T00:00:03.000Z" : undefined,
    },
  };
}

function conversationFrom(run: OrdinaryRunState): OrdinaryConversationReadModel {
  return {
    conversationId: run.turn.conversationId,
    title: "测试对话",
    createdAt: run.timestamps.createdAt,
    updatedAt: run.timestamps.updatedAt,
    activeRunId: run.status.kind === "running" || run.status.kind === "awaiting_approval" ? run.runId : undefined,
    latestRunId: run.runId,
    queuedRunIds: run.status.kind === "queued" ? [run.runId] : [],
    turns: [{
      role: "user",
      turnId: run.turn.userTurnId,
      runId: run.runId,
      content: run.input.userMessage,
      input: run.input,
      status: run.status.kind === "queued" ? "pending" : "completed",
      createdAt: run.timestamps.createdAt,
      updatedAt: run.timestamps.updatedAt,
    }, {
      role: "assistant",
      turnId: run.turn.assistantTurnId,
      runId: run.runId,
      content: run.visibleAssistantText ?? "",
      status: run.status.kind,
      interruption: run.status.kind === "cancelled"
        ? "user_cancelled"
        : run.status.kind === "blocked" && run.status.reason.code === "execution_continuation_lost"
          ? "runtime_stopped"
          : undefined,
      model: run.birth.config,
      createdAt: run.timestamps.createdAt,
      updatedAt: run.timestamps.updatedAt,
    }],
  };
}

function replay(
  run: OrdinaryRunState,
  events: readonly OrdinaryRunEvent[],
  streamId = "ordinary-stream-1",
): OrdinaryRunActivityReplay {
  const activities: OrdinaryRunActivity[] = [];
  for (const event of events) {
    if (event.type === "run.completed") {
      activities.push(completedOutputActivity(run, run.visibleAssistantText ?? "done", activities.length + 1));
    }
    activities.push(transitionActivity(run, event, activities.length + 1));
  }
  if (run.status.kind === "completed" && !events.some((event) => event.type === "run.completed")) {
    activities.push(completedOutputActivity(run, run.visibleAssistantText ?? "done", activities.length + 1));
  }
  return {
    cursor: { streamId, sequence: activities.at(-1)?.sequence ?? 0 },
    reset: false,
    activities,
  };
}

function completedOutputActivity(run: OrdinaryRunState, content: string, sequence: number): OrdinaryRunActivity {
  return {
    activityId: `${run.runId}:assistant-output`,
    runId: run.runId,
    sequence,
    recordedAt: "2026-01-01T00:00:02.500Z",
    type: "model.output.completed",
    durability: "durable",
    modelRequestId: `${run.runId}:model-request`,
    assistantEntryRef: { sessionId: run.sessionRef.sessionId, entryId: `${run.runId}:assistant-entry` },
    content,
  };
}

function transitionActivity(
  run: OrdinaryRunState,
  event: OrdinaryRunEvent,
  sequence: number,
): OrdinaryRunActivity {
  return {
    activityId: `transition:${event.eventId}`,
    runId: run.runId,
    sequence,
    recordedAt: event.recordedAt,
    type: "run.transition",
    durability: "durable",
    event,
  };
}

function createdEvent(run: OrdinaryRunState): OrdinaryRunEvent {
  return {
    eventId: `${run.runId}:created`,
    runId: run.runId,
    sequence: 1,
    recordedAt: "2026-01-01T00:00:01.000Z",
    type: "run.created",
  };
}

function startedEvent(run: OrdinaryRunState): OrdinaryRunEvent {
  return {
    eventId: `${run.runId}:started`,
    runId: run.runId,
    sequence: 2,
    recordedAt: "2026-01-01T00:00:02.000Z",
    type: "run.started",
  };
}

function confirmation(runId: string): ConfirmationRequest {
  return {
    confirmationId: `${runId}:confirmation`,
    toolCallFactId: `${runId}:tool-fact`,
    conversationId: "conversation-1",
    title: "确认执行命令",
    actionSummary: "运行 pnpm test",
    affectedResources: ["Z:/workspace"],
    riskLevel: "medium",
    resumeAvailability: "live",
    requestedAt: "2026-01-01T00:00:03.000Z",
    expiresAt: "2026-01-01T01:00:03.000Z",
    sourceRefs: ["tool_call:call-approval"],
  };
}

function isTerminal(status: OrdinaryRunStatus): boolean {
  return status.kind === "completed" || status.kind === "failed" ||
    status.kind === "cancelled" || status.kind === "blocked";
}
