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
import {
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
    assert.deepEqual(conversation.workspaceFolder, {
      label: "workspace",
      path: "Z:/workspace",
      selection: "explicit",
    });
    assert.equal(conversation.turns[1]?.responseModel?.protocolKind, protocol);
    assert.equal(conversation.turns[1]?.responseModel?.model, run.birth.config.model);
  }
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
    { status: { kind: "completed", answer: "done" }, panelStatus: "completed", stage: "completed" },
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
  assert.deepEqual(batch.events.map((event) => event.sequence), [1, 2, 3]);
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
          toolName: "read_file",
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
  assert.equal(node?.eventType, "model.requested");
  assert.equal(node?.kind, "system");
  assert.equal(node?.phase, "executing");
  assert.equal(node?.summary, "分析工具结果");
});

test("approval projection keeps the complete confirmation and canonical tool result", () => {
  const request = { ...confirmation("approval-run"), toolCallFactId: "call-approval" };
  const projectedRequest = { ...request, ownerRunId: "approval-run" };
  const run = runState({
    runId: "approval-run",
    status: {
      kind: "awaiting_approval",
      confirmationRequests: [request],
      continuationAvailability: "live_only",
    },
    toolCalls: [{
      callId: "call-approval",
      toolName: "shell_command",
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

  assert.deepEqual(view.workView.pendingConfirmation, projectedRequest);
  assert.deepEqual(view.detail.toolResults, run.toolCalls);
  assert.equal(view.detail.continuationAvailability, "live");
  const node = view.workView.transcriptNodes.find((item) => item.kind === "confirmation");
  assert.deepEqual(node?.confirmation, projectedRequest);
  assert.equal(view.replay.events.at(-1)?.type, "confirmation.needed");
});

test("terminal projection preserves raw answer, full tool output, usage and attachments without a fake canvas", () => {
  const answer = "最终回答 <raw>，不要替换。";
  const run = runState({
    runId: "completed-run",
    status: { kind: "completed", answer },
    usage: {
      inputTokens: 120,
      cachedInputTokens: 80,
      uncachedInputTokens: 40,
      outputTokens: 12,
      totalTokens: 132,
    },
    toolCalls: [{
      callId: "call-read",
      toolName: "read_file",
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
        {
          activityId: "tool:call-read:completed",
          runId: run.runId,
          sequence: 3,
          recordedAt: completed.recordedAt,
          type: "tool.result",
          durability: "durable",
          result: run.toolCalls[0]!,
        },
        transitionActivity(run, completed, 4),
      ],
    },
  });

  assert.equal(view.workView.answer?.content, answer);
  assert.equal(view.workView.transcriptNodes.at(-1)?.text, answer);
  assert.equal(view.replay.events.at(-1)?.summary, answer);
  assert.deepEqual(view.detail.toolResults, run.toolCalls);
  assert.deepEqual(view.detail.usage, run.usage);
  assert.equal("canvas" in view.detail, false);
  assert.equal(view.workView.contextAttachments[0]?.readonlyPreview?.text, "附件原文 <raw>");
  assert.equal(view.workView.contextAttachments[0]?.summary, "附件摘要 <raw>");
  assert.equal(view.workView.workSummary.toolResultCount, 1);
  assert.equal(view.workView.visibleEvents.some((event) => event.type === "tool.completed"), true);
  const toolNode = view.workView.transcriptNodes.find((node) => node.eventType === "tool.completed");
  assert.equal(toolNode?.toolName, "read_file");
  assert.equal(toolNode?.display?.kind, "read_result");
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
  const projected = projectOrdinaryPanelConversation({ conversation: ordinary, currentRun, workspaceRun: run });
  const summary = projectOrdinaryPanelConversationSummary(ordinary, run);

  assert.equal(projected.status, "approval_needed");
  assert.equal(projected.requiresUserAction, true);
  assert.deepEqual(projected.pendingAction, {
    kind: "approval",
    runId: run.runId,
    assistantTurnId: run.turn.assistantTurnId,
  });
  assert.equal(projected.currentRun?.run.runId, run.runId);
  assert.deepEqual(projected.workspaceFolder, {
    label: "workspace",
    path: "Z:/workspace",
    selection: "explicit",
  });
  assert.deepEqual(summary.workspaceFolder, projected.workspaceFolder);
  assert.equal(projected.turns[0]?.attachments?.[0]?.summary, "附件摘要 <raw>");
  assert.equal(projected.turns[1]?.content, "");
  assert.equal("turns" in summary, false);
  assert.equal("currentRun" in summary, false);
  assert.equal(ordinary.turns[0]?.content, run.input.userMessage);
});

function runState(input: {
  readonly runId: string;
  readonly status: OrdinaryRunStatus;
  readonly protocol?: "openai_responses" | "openai_compatible_chat_completions";
  readonly toolCalls?: OrdinaryRunState["toolCalls"];
  readonly usage?: OrdinaryRunState["usage"];
  readonly withAttachment?: boolean;
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
    canonicalMessages: [{ role: "user", content: "请读取附件并回答" }],
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
    activeLineage: { lineageId: run.turn.lineageId, createdAt: run.timestamps.createdAt },
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
      content: run.status.kind === "completed" ? run.status.answer : "",
      status: run.status.kind,
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
  const activities = events.map((event, index) => transitionActivity(run, event, index + 1));
  return {
    cursor: { streamId, sequence: activities.at(-1)?.sequence ?? 0 },
    reset: false,
    activities,
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
