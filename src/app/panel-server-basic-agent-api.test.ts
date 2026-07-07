import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startLocalPanelServer, type PanelProviderFetch } from "./panel-server.js";
import {
  assertSafePanelJsonText,
  removeTemporaryTree,
  requestJson,
  requestSse,
  waitForBasicEvents,
  waitForRun,
} from "./panel-server-test-utils.js";
import {
  createOpenAiToolCallResponse,
  createOpenAiRunCommandToolCallResponse,
  createOpenAiTextResponse,
} from "./panel-openai-test-fixtures.js";

test("basic agent events endpoint derives completed events without a prior run read", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-events-direct-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "直接回答一个普通问题", aiMode: "fake" },
    });
    const basicEvents = await waitForBasicEvents(
      server.url,
      start.body.runId,
      (body) => body.events.some((event: { type: string }) => event.type === "final.result")
    );
    const basicStream = await requestSse(server.url, `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/stream?cursor=0`);

    assert.equal(basicEvents.status, 200);
    assert.equal(basicStream.status, 200);
    assert.equal(basicEvents.body.cursor.lastSequence > 0, true);
    assert.equal(basicEvents.body.events[0].type, "run.started");
    assert.equal(basicEvents.body.events.some((event: { type: string }) => event.type === "final.result"), true);
    assert.equal(basicStream.events.some((event: { type: string }) => event.type === "final.result"), true);
    assert.equal(JSON.stringify(basicEvents.body.events).includes("raw provider response"), false);
    assertSafePanelJsonText(`${basicEvents.text}\n${basicStream.text}`);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("basic agent run endpoint returns the transport-neutral completed projection", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-run-endpoint-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "直接回答一个普通问题", aiMode: "fake" },
    });
    await waitForRun(server.url, start.body.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const basicRun = await requestJson(server.url, `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}`);

    assert.equal(basicRun.status, 200);
    assert.equal(basicRun.body.run.runId, start.body.runId);
    assert.equal(basicRun.body.run.status, "completed");
    assert.equal(basicRun.body.run.runMode, "agent");
    assert.equal(basicRun.body.run.requiresUserAction, false);
    assert.equal(basicRun.body.run.eventCursor.lastSequence > 0, true);
    assert.equal(JSON.stringify(basicRun.body).includes("sanitizedMessages"), false);
    assertSafePanelJsonText(basicRun.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("basic agent run view endpoint returns the backend-owned run read model and incremental replay", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-run-view-endpoint-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "直接回答一个普通问题", aiMode: "fake" },
    });
    await waitForRun(server.url, start.body.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const fullView = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/view?cursor=0`
    );
    const replayEvents = fullView.body.view.replay.events;
    const incrementalCursor = replayEvents[0]?.sequence ?? 0;
    const incrementalView = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/view?cursor=${incrementalCursor}`
    );

    assert.equal(fullView.status, 200);
    assert.equal(fullView.body.view.run.runId, start.body.runId);
    assert.equal(fullView.body.view.workView.run.runId, start.body.runId);
    assert.equal("workSession" in fullView.body.view, false);
    assert.equal(fullView.body.view.detail.runId, start.body.runId);
    assert.equal(replayEvents.length > 0, true);
    assert.equal(replayEvents.some((event: { type: string }) => event.type === "final.result"), true);
    assert.equal(
      incrementalView.body.view.replay.events.every((event: { sequence: number }) => event.sequence > incrementalCursor),
      true
    );
    assert.equal(
      incrementalView.body.view.replay.cursor.lastSequence,
      fullView.body.view.replay.cursor.lastSequence
    );
    assert.equal(JSON.stringify(fullView.body.view).includes("sanitizedMessages"), false);
    assertSafePanelJsonText(`${fullView.text}\n${incrementalView.text}`);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("basic agent run view endpoint restores the completed backend read model after restart", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-restored-run-view-"));
  let server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "直接回答一个普通问题", aiMode: "fake" },
    });
    await waitForRun(server.url, start.body.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const persistedBeforeRestart = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(start.body.runId)}`);
    const persistedSummary = persistedBeforeRestart.body.snapshot.run.resultSummary;
    assert.equal(persistedBeforeRestart.body.snapshot.run.status, "completed");
    assert.equal(typeof persistedSummary, "string");
    assert.equal(persistedSummary.trim().length > 0, true);

    await server.close();
    server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    const restoredView = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/view?cursor=0`
    );

    assert.equal(restoredView.status, 200);
    assert.equal(restoredView.body.view.run.runId, start.body.runId);
    assert.equal(restoredView.body.view.run.status, "completed");
    assert.equal(restoredView.body.view.workView.run.runId, start.body.runId);
    assert.equal(restoredView.body.view.workView.stage, "completed");
    assert.equal("workSession" in restoredView.body.view, false);
    assert.equal(restoredView.body.view.detail.runId, start.body.runId);
    assert.equal(restoredView.body.view.detail.status, "completed");
    assert.equal(restoredView.body.view.detail.restoredResult.summary, persistedSummary);
    assert.equal(
      restoredView.body.view.detail.transcript.transcriptNodes.some((node: { kind: string }) => node.kind === "answer"),
      true
    );
    assert.equal(
      restoredView.body.view.replay.events.some((event: { type: string }) => event.type === "final.result"),
      true
    );
    assert.equal(JSON.stringify(restoredView.body.view).includes("sanitizedMessages"), false);
    assert.equal(JSON.stringify(restoredView.body.view).includes("raw provider response"), false);
    assertSafePanelJsonText(restoredView.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("basic agent rejects stale confirmation decisions for runs without pending approval", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-stale-confirmation-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "直接回答一个普通问题", aiMode: "fake" },
    });
    await waitForRun(server.url, start.body.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const stale = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/confirmations/${encodeURIComponent("confirmation-stale")}/decision`,
      { method: "POST", body: { decision: "deny" } }
    );
    const basicRun = await requestJson(server.url, `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}`);

    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, "invalid_confirmation_state");
    assert.equal(basicRun.body.run.status, "completed");
    assertSafePanelJsonText(`${stale.text}\n${basicRun.text}`);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("basic agent cancel API marks running desktop jobs as cancelled and replays terminal events", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-cancel-"));
  const secret = "sk-basic-cancel-secret";
  let releaseFetch: (() => void) | undefined;
  const fetchGate = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  const providerFetch: PanelProviderFetch = async () => {
    await fetchGate;
    return createOpenAiTextResponse("basic-cancel-model", "This response arrived after cancellation.");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "basic-cancel-model",
        apiKey: secret,
      },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "保持运行直到我取消", aiMode: "openai-compatible" },
    });
    await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "running" && body.trace.events.some((event: { type: string }) => event.type === "model.requested"),
      4_000,
      "/api/desktop/runs"
    );
    const cancelled = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/cancel`,
      { method: "POST" }
    );
    const basicEvents = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/events?cursor=0`
    );
    const stream = await requestSse(server.url, `/api/desktop/runs/${encodeURIComponent(start.body.runId)}/stream?cursor=0`);
    const runtimeRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(start.body.runId)}`);

    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.run.status, "cancelled");
    assert.equal(basicEvents.body.events.some((event: { type: string }) => event.type === "run.cancelled"), true);
    assert.equal(stream.events.some((event) => event.type === "run.cancelled"), true);
    assert.equal(runtimeRun.body.snapshot.run.status, "cancelled");
    assert.equal(JSON.stringify(basicEvents.body.events).includes(secret), false);
    releaseFetch?.();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const lateRun = await requestJson(server.url, `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}`);
    const lateEvents = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/events?cursor=0`
    );
    assert.equal(lateRun.body.run.status, "cancelled");
    assert.equal(lateEvents.body.events.some((event: { type: string }) => event.type === "final.result"), false);
    assertSafePanelJsonText(`${cancelled.text}\n${basicEvents.text}\n${stream.text}\n${runtimeRun.text}\n${lateRun.text}\n${lateEvents.text}`);
  } finally {
    releaseFetch?.();
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("basic agent confirmation decisions persist approve and guidance outcomes safely", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-confirmation-decisions-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-confirmation-workspace-"));
  let providerFetchCalls = 0;
  const providerFetch: PanelProviderFetch = async () => {
    providerFetchCalls += 1;
    if (providerFetchCalls === 1) {
      return createOpenAiRunCommandToolCallResponse("echo approved-confirmation");
    }
    if (providerFetchCalls === 3) {
      return createOpenAiRunCommandToolCallResponse("echo guidance-confirmation");
    }
    return createOpenAiTextResponse("basic-confirmation-model", "文件操作已完成，结果已整理。");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "gpt-4o-mini",
        apiKey: "sk-basic-confirmation-secret",
      },
    });
    await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: workspace },
    });
    const approveStart = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "运行 echo approved-confirmation 测试确认续跑", aiMode: "openai-compatible" },
    });
    const approveRunId = approveStart.body.run.runId;
    const approveConversationId = approveStart.body.conversation.conversationId;
    const approveCompleted = await waitForRun(
      server.url,
      approveRunId,
      (body) => body.status === "approval_needed" && body.canvas?.agent?.pendingConfirmation !== undefined,
      4_000,
      "/api/desktop/runs"
    );
    const approveConfirmationId = approveCompleted.body.canvas.agent.pendingConfirmation.confirmationId;
    const pendingConversations = await requestJson(server.url, "/api/conversations");
    const pendingSummary = pendingConversations.body.conversations.find(
      (item: { conversationId: string }) => item.conversationId === approveConversationId
    );
    const pendingEvents = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(approveRunId)}/events?cursor=0`
    );
    const requestedSequence = pendingEvents.body.events.find((event: { type: string }) => event.type === "tool.requested")?.sequence;
    const confirmationSequence = pendingEvents.body.events.find((event: { type: string }) => event.type === "confirmation.needed")?.sequence;

    assert.equal(pendingSummary?.requiresUserAction, true);
    assert.equal(typeof requestedSequence, "number");
    assert.equal(typeof confirmationSequence, "number");
    assert.equal(Number(confirmationSequence) > Number(requestedSequence), true);
    assert.equal(pendingEvents.text.includes("请求执行执行操作"), false);

    const approveDecision = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(approveRunId)}/confirmations/${encodeURIComponent(approveConfirmationId)}/decision`,
      { method: "POST", body: { decision: "approve_once" } }
    );
    assert.equal(approveDecision.status, 200);
    await waitForRun(
      server.url,
      approveRunId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const approveRuntime = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(approveRunId)}`);
    const approveEvents = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(approveRunId)}/events?cursor=0`
    );
    assert.equal(approveRuntime.body.snapshot.confirmations[0].status, "approved");
    assert.equal(approveRuntime.body.snapshot.toolCalls.some((call: { status: string }) => call.status === "completed"), true);
    assert.equal(approveEvents.body.events.some((event: { type: string }) => event.type === "run.resumed"), false);
    assert.equal(approveEvents.body.events.some((event: { type: string }) => event.type === "user_approval.received"), false);
    assert.equal(approveEvents.body.events.some((event: { type: string }) => event.type === "tool.completed"), true);
    const approvedConfirmationSequence = approveEvents.body.events.find((event: { type: string }) => event.type === "confirmation.needed")?.sequence;
    const approvedCompletedSequence = approveEvents.body.events.find((event: { type: string }) => event.type === "tool.completed")?.sequence;
    assert.equal(typeof approvedConfirmationSequence, "number");
    assert.equal(typeof approvedCompletedSequence, "number");
    assert.equal(Number(approvedCompletedSequence) > Number(approvedConfirmationSequence), true);

    const guidanceSecret = "sk-guidance-decision-secret";
    const guidanceStart = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "运行 echo guidance-confirmation 前先等我补充指导", aiMode: "openai-compatible" },
    });
    const guidanceCompleted = await waitForRun(
      server.url,
      guidanceStart.body.runId,
      (body) => body.status === "approval_needed" && body.canvas?.agent?.pendingConfirmation !== undefined,
      4_000,
      "/api/desktop/runs"
    );
    const guidanceConfirmationId = guidanceCompleted.body.canvas.agent.pendingConfirmation.confirmationId;
    const guidanceDecision = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(guidanceStart.body.runId)}/confirmations/${encodeURIComponent(guidanceConfirmationId)}/decision`,
      { method: "POST", body: { decision: "guidance", guidance: `先不要读取文件，只说明需要什么材料。${guidanceSecret}` } }
    );
    await waitForRun(
      server.url,
      guidanceStart.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const guidanceRuntime = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(guidanceStart.body.runId)}`);
    const guidanceEvents = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(guidanceStart.body.runId)}/events?cursor=0`
    );

    assert.equal(guidanceDecision.status, 200);
    assert.equal(guidanceRuntime.body.snapshot.run.status, "completed");
    assert.equal(guidanceRuntime.body.snapshot.confirmations[0].status, "guidance");
    assert.equal(guidanceEvents.body.events.some((event: { type: string }) => event.type === "user.guidance"), true);
    assert.equal(guidanceEvents.body.events.some((event: { type: string }) => event.type === "final.result"), true);
    assert.equal(guidanceEvents.text.includes(guidanceSecret), true);
    assert.equal(guidanceRuntime.text.includes(guidanceSecret), true);
    assertSafePanelJsonText(`${approveDecision.text}\n${approveRuntime.text}\n${approveEvents.text}\n${guidanceDecision.text}\n${guidanceRuntime.text}\n${guidanceEvents.text}`);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
    await removeTemporaryTree(workspace);
  }
});

test("basic agent shell_command executes after confirmation without command-shape failure", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-command-confirmation-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-command-workspace-"));
  let providerFetchCalls = 0;
  let releaseFinalResponse: (() => void) | undefined;
  const finalResponseGate = new Promise<void>((resolve) => {
    releaseFinalResponse = resolve;
  });
  const providerFetch: PanelProviderFetch = async () => {
    providerFetchCalls += 1;
    if (providerFetchCalls === 1) {
      return createOpenAiRunCommandToolCallResponse("echo approval-review");
    }
    await finalResponseGate;
    return createOpenAiTextResponse("basic-command-confirmation-model", "命令检查完成。");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "gpt-4o-mini",
        apiKey: "sk-basic-command-secret",
      },
    });
    await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: workspace },
    });
    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "运行 echo approval-review 测试命令确认续跑", aiMode: "openai-compatible" },
    });
    const runId = start.body.run.runId;
    const pending = await waitForRun(
      server.url,
      runId,
      (body) => body.status === "approval_needed" && body.canvas?.agent?.pendingConfirmation !== undefined,
      4_000,
      "/api/desktop/runs"
    );
    const confirmationId = pending.body.canvas.agent.pendingConfirmation.confirmationId;
    const approved = await withTimeout(
      requestJson(
        server.url,
        `/api/basic-agent/runs/${encodeURIComponent(runId)}/confirmations/${encodeURIComponent(confirmationId)}/decision`,
        { method: "POST", body: { decision: "approve_once" } }
      ),
      2_000
    );
    const runningAfterApproval = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(runId)}`
    );
    const runningViewAfterApproval = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(runId)}/view`
    );
    releaseFinalResponse?.();
    const completed = await waitForRun(
      server.url,
      runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const runtimeRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(runId)}`);
    const events = await requestJson(server.url, `/api/basic-agent/runs/${encodeURIComponent(runId)}/events?cursor=0`);
    const commandCall = runtimeRun.body.snapshot.toolCalls.find(
      (call: { toolName?: string; status: string }) => call.toolName === "shell_command"
    );

    assert.equal(approved.status, 200);
    assert.equal(runningAfterApproval.body.run.status, "running");
    assert.equal(runningViewAfterApproval.body.view.workView.pendingConfirmation, undefined);
    assert.equal(
      runningViewAfterApproval.body.view.workView.transcriptNodes.some((node: { kind: string }) => node.kind === "confirmation"),
      false
    );
    assert.equal(completed.body.status, "completed");
    assert.equal(commandCall?.status, "completed");
    assert.equal(commandCall?.commandLine ?? commandCall?.command, "echo approval-review");
    assert.equal(events.body.events.some((event: { type: string }) => event.type === "confirmation.needed"), true);
    assert.equal(events.body.events.some((event: { type: string }) => event.type === "run.resumed"), false);
    assert.equal(events.body.events.some((event: { type: string }) => event.type === "user_approval.received"), false);
    assert.equal(events.body.events.some((event: { type: string }) => event.type === "tool.completed"), true);
    assert.equal(events.body.events.some((event: { type: string }) => event.type === "tool.failed"), false);
    assert.equal(events.text.includes("Sandbox policy rejected command: echo approval-review"), false);
    assertSafePanelJsonText(`${runtimeRun.text}\n${events.text}`);
  } finally {
    releaseFinalResponse?.();
    await server.close();
    await removeTemporaryTree(directory);
    await removeTemporaryTree(workspace);
  }
});

test("basic agent denied confirmation feeds the decision back into the same run", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-confirmation-deny-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-confirmation-deny-workspace-"));
  let providerFetchCalls = 0;
  const providerFetch: PanelProviderFetch = async () => {
    providerFetchCalls += 1;
    return providerFetchCalls === 1
      ? createOpenAiRunCommandToolCallResponse("echo denied-command")
      : createOpenAiTextResponse("basic-deny-model", "已按拒绝结果继续整理，不会删除文件。");
  };
  let server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "gpt-4o-mini",
        apiKey: "sk-basic-deny-secret",
      },
    });
    await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: workspace },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "运行 echo denied-command 前需要确认", aiMode: "openai-compatible" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "approval_needed" && body.canvas?.agent?.pendingConfirmation !== undefined,
      4_000,
      "/api/desktop/runs"
    );
    const confirmationId = completed.body.canvas.agent.pendingConfirmation.confirmationId;
    const denied = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/confirmations/${encodeURIComponent(confirmationId)}/decision`,
      { method: "POST", body: { decision: "deny" } }
    );
    await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const runtimeRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(start.body.runId)}`);
    const deniedEvents = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/events?cursor=0`
    );

    assert.equal(denied.status, 200);
    assert.equal(runtimeRun.body.snapshot.run.status, "completed");
    assert.equal(runtimeRun.body.snapshot.confirmations[0].status, "denied");
    assert.equal(runtimeRun.body.snapshot.toolCalls.some((call: { status: string }) => call.status === "failed"), true);
    assert.equal(deniedEvents.body.events.some((event: { type: string }) => event.type === "user_approval.received"), true);
    assert.equal(deniedEvents.body.events.some((event: { type: string }) => event.type === "run.blocked"), false);
    assert.equal(deniedEvents.body.events.some((event: { type: string }) => event.type === "final.result"), true);
    assertSafePanelJsonText(`${denied.text}\n${runtimeRun.text}\n${deniedEvents.text}`);

    await server.close();
    server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
    const restoredRun = await requestJson(server.url, `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}`);
    const restoredEvents = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/events?cursor=0`
    );

    assert.equal(restoredRun.status, 200);
    assert.equal(restoredRun.body.run.status, "completed");
    assert.equal(restoredRun.body.run.requiresUserAction, false);
    assert.equal(restoredEvents.body.events.some((event: { type: string }) => event.type === "run.blocked"), false);
    assert.equal(restoredEvents.body.events.some((event: { type: string }) => event.type === "user_approval.received"), true);
    assertSafePanelJsonText(`${restoredRun.text}\n${restoredEvents.text}`);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
    await removeTemporaryTree(workspace);
  }
});

test("basic agent approve after restart blocks because executable continuation is not persisted", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-confirmation-approve-restart-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-confirmation-approve-restart-workspace-"));
  let server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    providerFetch: async () => createOpenAiRunCommandToolCallResponse("echo restart-approved"),
  });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "gpt-4o-mini",
        apiKey: "sk-restart-approval-secret",
      },
    });
    await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: workspace },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "运行 echo restart-approved 测试重启后确认", aiMode: "openai-compatible" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "approval_needed" && body.canvas?.agent?.pendingConfirmation !== undefined,
      4_000,
      "/api/desktop/runs"
    );
    const confirmationId = completed.body.canvas.agent.pendingConfirmation.confirmationId;

    await server.close();
    server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    const restoredWorkView = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/work-view`
    );
    const approved = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/confirmations/${encodeURIComponent(confirmationId)}/decision`,
      { method: "POST", body: { decision: "approve_once" } }
    );
    const restoredEvents = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/events?cursor=0`
    );
    const runtimeRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(start.body.runId)}`);

    assert.equal(restoredWorkView.body.workView.pendingConfirmation.resumeAvailability, "lost_after_restart");
    assert.equal("workSession" in restoredWorkView.body, false);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.run.status, "blocked");
    assert.equal(runtimeRun.body.snapshot.run.status, "blocked");
    assert.equal(runtimeRun.body.snapshot.confirmations[0].status, "approved");
    assert.equal(restoredEvents.body.events.some((event: { type: string }) => event.type === "run.blocked"), true);
    assertSafePanelJsonText(`${approved.text}\n${restoredEvents.text}\n${runtimeRun.text}`);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
    await removeTemporaryTree(workspace);
  }
});

test("basic agent confirmation survives prior edit_file failures before shell_command approval", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-failed-tools-before-confirmation-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-failed-tools-before-confirmation-workspace-"));
  let providerFetchCalls = 0;
  let releaseFinalResponse: (() => void) | undefined;
  const finalResponseGate = new Promise<void>((resolve) => {
    releaseFinalResponse = resolve;
  });
  const providerFetch: PanelProviderFetch = async () => {
    providerFetchCalls += 1;
    if (providerFetchCalls === 1) {
      return createOpenAiToolCallResponse(
        "basic-edit-then-command-model",
        "call-panel-edit-miss-1",
        "edit_file",
        {
          path: "edge_cases.txt",
          edits: [{ oldText: "missing-alpha", newText: "present-alpha", occurrence: 3 }],
        }
      );
    }
    if (providerFetchCalls === 2) {
      return createOpenAiToolCallResponse(
        "basic-edit-then-command-model",
        "call-panel-edit-miss-2",
        "edit_file",
        {
          path: "edge_test/occurrence_test.txt",
          edits: [{ oldText: "missing-beta", newText: "present-beta", occurrence: 99 }],
        }
      );
    }
    if (providerFetchCalls === 3) {
      return createOpenAiRunCommandToolCallResponse(`echo "start" && echo "middle" && echo "end"`);
    }
    await finalResponseGate;
    return createOpenAiTextResponse("basic-edit-then-command-model", "复杂工作流已完成。");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await fs.mkdir(path.join(workspace, "edge_test"), { recursive: true });
    await fs.writeFile(path.join(workspace, "edge_cases.txt"), "present-alpha\n", "utf8");
    await fs.writeFile(path.join(workspace, "edge_test", "occurrence_test.txt"), "present-beta\n", "utf8");
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "gpt-4o-mini",
        apiKey: "sk-basic-failed-tools-before-confirmation",
      },
    });
    await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: workspace },
    });
    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "先尝试修复两个文件，再运行 echo start middle end 并等待确认", aiMode: "openai-compatible" },
    });
    const runId = start.body.run.runId;
    const pending = await waitForRun(
      server.url,
      runId,
      (body) => body.status === "approval_needed" && body.canvas?.agent?.pendingConfirmation !== undefined,
      6_000,
      "/api/desktop/runs"
    );
    const confirmationId = pending.body.canvas.agent.pendingConfirmation.confirmationId;
    const pendingEvents = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(runId)}/events?cursor=0`
    );
    const failedToolEvents = pendingEvents.body.events.filter((event: { type: string }) => event.type === "tool.failed");

    assert.equal(failedToolEvents.length >= 2, true);
    assert.equal(pendingEvents.text.includes("edit_file edit 1 could not find the target text in edge_cases.txt"), true);
    assert.equal(
      pendingEvents.text.includes("edit_file edit 1 could not find the target text in edge_test/occurrence_test.txt"),
      true
    );

    const approved = await withTimeout(
      requestJson(
        server.url,
        `/api/basic-agent/runs/${encodeURIComponent(runId)}/confirmations/${encodeURIComponent(confirmationId)}/decision`,
        { method: "POST", body: { decision: "approve_once" } }
      ),
      2_500
    );
    releaseFinalResponse?.();
    const completed = await waitForRun(
      server.url,
      runId,
      (body) => body.status === "completed",
      6_000,
      "/api/desktop/runs"
    );
    const runtimeRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(runId)}`);
    const events = await requestJson(server.url, `/api/basic-agent/runs/${encodeURIComponent(runId)}/events?cursor=0`);
    const commandCall = runtimeRun.body.snapshot.toolCalls.find(
      (call: { toolName?: string; command?: string; status: string }) => call.toolName === "shell_command"
    );

    assert.equal(approved.status, 200);
    assert.equal(completed.body.status, "completed");
    assert.equal(commandCall?.status, "completed");
    assert.equal(commandCall?.command, `echo "start" && echo "middle" && echo "end"`);
    assert.equal(events.body.events.some((event: { type: string }) => event.type === "tool.failed"), true);
    assert.equal(events.body.events.some((event: { type: string }) => event.type === "tool.completed"), true);
    assert.equal(events.text.includes("面板请求失败"), false);
    assertSafePanelJsonText(`${runtimeRun.text}\n${events.text}`);
  } finally {
    releaseFinalResponse?.();
    await server.close();
    await removeTemporaryTree(directory);
    await removeTemporaryTree(workspace);
  }
});

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("Timed out waiting for HTTP response.")), timeoutMs);
    }),
  ]);
}
