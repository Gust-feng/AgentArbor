import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ConfirmationRequest } from "../../../domain/confirmation/index.js";
import type { ToolCallResult } from "../../../domain/tools/index.js";
import { createLocalConfigCenter } from "../../config-center.js";
import type {
  OrdinaryExecutionOutcome,
  OrdinaryExecutionPort,
} from "../../ordinary-agent/index.js";
import { startLocalPanelServer } from "../../panel-server.js";
import { closePanelServer, createPanelRequestHandler } from "../request-handler.js";
import { createPanelRuntime } from "../runtime.js";
import {
  removeTemporaryTree,
  requestJson,
  requestSse,
} from "./panel-server-test-utils.js";

test("Ordinary Panel entry submits directly to the feature and exposes the canonical view and usage", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-panel-"));
  const server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    ordinaryAgentExecution: completedExecution("ordinary answer", { inputTokens: 8, outputTokens: 3, totalTokens: 11, cachedInputTokens: 5 }),
  });
  try {
    const submitted = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "finish an ordinary task" },
    });
    assert.equal(submitted.status, 202);
    assert.equal(["running", "completed"].includes(submitted.body.run.status), true);

    const view = await waitForView(server.url, submitted.body.run.runId, "completed");
    assert.equal(view.body.view.run.status, "completed");
    assert.equal(view.body.view.workView.answer.content, "ordinary answer");
    assert.equal("state" in view.body.view, false);

    const usage = await requestJson(server.url, "/api/runtime/usage-statistics");
    assert.equal(usage.body.statistics.totals.runCount, 1);
    assert.equal(usage.body.statistics.totals.inputTokens, 8);
    assert.equal(usage.body.statistics.totals.outputTokens, 3);
    assert.equal(usage.body.statistics.totals.cacheSavedTokens, 5);

    assert.equal((await requestJson(server.url, `/api/basic-agent/runs/${submitted.body.run.runId}/view?cursor=0`)).status, 400);
    assert.equal((await requestJson(server.url, "/api/basic-agent/runs/missing/view")).status, 404);
    assert.equal((await requestJson(server.url, "/api/desktop/runs", { method: "POST", body: { goal: "legacy" } })).status, 404);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("Ordinary conversation projects its frozen run workspace before and after restart", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-panel-workspace-"));
  const workspaceDirectory = path.join(directory, "project-workspace");
  await fs.mkdir(workspaceDirectory, { recursive: true });
  let server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    ordinaryAgentExecution: completedExecution("workspace answer", {}),
  });
  try {
    const submitted = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "remember this workspace", workspaceDirectory },
    });
    const conversationId = submitted.body.conversation.conversationId;
    await waitForView(server.url, submitted.body.run.runId, "completed");
    assert.deepEqual(submitted.body.conversation.workspaceFolder, {
      label: path.basename(workspaceDirectory),
      path: workspaceDirectory,
    });
    assert.deepEqual(
      (await requestJson(server.url, "/api/conversations")).body.conversations[0].workspaceFolder,
      submitted.body.conversation.workspaceFolder,
    );

    await server.close();
    server = await startLocalPanelServer({
      port: 0,
      configDirectory: directory,
      ordinaryAgentExecution: completedExecution("unused", {}),
    });
    const restored = await requestJson(server.url, `/api/conversations/${conversationId}`);
    const restoredList = await requestJson(server.url, "/api/conversations");
    assert.deepEqual(restored.body.conversation.workspaceFolder, submitted.body.conversation.workspaceFolder);
    assert.deepEqual(restoredList.body.conversations[0].workspaceFolder, submitted.body.conversation.workspaceFolder);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("Ordinary submit admitted before shutdown returns an explicit quiescing response", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-shutdown-admission-"));
  const local = createLocalConfigCenter({ configDirectory: directory });
  const birthGate = manualGate();
  const getDesktopAgentConfig = local.configCenter.getDesktopAgentConfig.bind(local.configCenter);
  Object.defineProperty(local.configCenter, "getDesktopAgentConfig", {
    configurable: true,
    value: async () => {
      birthGate.enter();
      await birthGate.released;
      return getDesktopAgentConfig();
    },
  });
  const server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    configCenter: local.configCenter,
    ordinaryAgentExecution: completedExecution("must not run", {}),
  });
  let closed = false;
  try {
    const submitting = requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "request already admitted" },
    });
    await birthGate.entered;
    const closing = server.close();
    birthGate.release();

    const response = await submitting;
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, "panel_runtime_quiescing");
    await closing;
    closed = true;
  } finally {
    birthGate.release();
    if (!closed) await server.close();
    await removeTemporaryTree(directory);
  }
});

test("Ordinary submit response keeps its command facts when a concurrent delete removes the run", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-submit-delete-"));
  let baseUrl = "";
  let conversationId = "";
  let raceRunId: string | undefined;
  let deleteRequest: Promise<Awaited<ReturnType<typeof requestJson>>> | undefined;
  const runtime = createPanelRuntime({
    configDirectory: directory,
    ordinaryAgentExecution: {
      async execute(input) {
        if (input.runInput.userMessage !== "race submit") {
          return completedOutcome("seed answer", {});
        }
        raceRunId = input.runId;
        deleteRequest = requestJson(baseUrl, `/api/conversations/${conversationId}`, { method: "DELETE" });
        return new Promise<OrdinaryExecutionOutcome>((resolve) => {
          input.abortSignal.addEventListener("abort", () => resolve({
            status: "cancelled",
            reason: String(input.abortSignal.reason),
            canonicalMessages: input.messages,
            toolCalls: [],
            usage: {},
          }), { once: true });
        });
      },
    },
  });
  const replay = runtime.ordinaryAgentFeature.events.replay.bind(runtime.ordinaryAgentFeature.events);
  Object.defineProperty(runtime.ordinaryAgentFeature.events, "replay", {
    configurable: true,
    value: async (runId: string, cursor?: Parameters<typeof replay>[1]) => {
      if (runId === raceRunId && deleteRequest !== undefined) await deleteRequest;
      return replay(runId, cursor);
    },
  });
  const httpServer = createServer(createPanelRequestHandler(runtime));
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  const address = httpServer.address();
  if (address === null || typeof address === "string") throw new Error("Panel test server did not expose a TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;
  let closed = false;
  try {
    const seed = await requestJson(baseUrl, "/api/conversations", {
      method: "POST",
      body: { goal: "seed" },
    });
    conversationId = seed.body.conversation.conversationId;
    await waitForView(baseUrl, seed.body.run.runId, "completed");

    const submitted = await requestJson(baseUrl, `/api/conversations/${conversationId}/messages`, {
      method: "POST",
      body: { goal: "race submit" },
    });
    const deleted = await deleteRequest;

    assert.equal(submitted.status, 202);
    assert.equal(submitted.body.run.runId, raceRunId);
    assert.equal(submitted.body.conversation.latestRunId, raceRunId);
    assert.equal(deleted?.status, 200);
    assert.equal((await requestJson(baseUrl, `/api/conversations/${conversationId}`)).status, 404);
    await closePanelServer(httpServer, runtime);
    closed = true;
  } finally {
    if (!closed) await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});

test("Ordinary Panel confirmation and cancellation commands return the established run contract", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-control-"));
  const execution: OrdinaryExecutionPort = {
    async execute(input) {
      if (input.runInput.userMessage === "needs approval") {
        const request = confirmation(input.runId);
        return {
          status: "approval_required",
          confirmationRequests: [request],
          canonicalMessages: [{ role: "user", content: input.runInput.userMessage }],
          toolCalls: [],
          usage: { inputTokens: 2, totalTokens: 2 },
          continuation: {
            availability: "live_only",
            async decide() {
              return completedOutcome("approved", { inputTokens: 4, outputTokens: 1, totalTokens: 5 });
            },
            async release() { return undefined; },
          },
        };
      }
      return new Promise<OrdinaryExecutionOutcome>((resolve) => {
        input.abortSignal.addEventListener("abort", () => resolve({
          status: "cancelled",
          reason: "cancelled_by_user",
          canonicalMessages: [{ role: "user", content: input.runInput.userMessage }],
          toolCalls: [],
          usage: {},
        }), { once: true });
      });
    },
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, ordinaryAgentExecution: execution });
  try {
    const approvalStart = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "needs approval" },
    });
    const approvalView = await waitForView(server.url, approvalStart.body.run.runId, "approval_needed");
    const confirmationId = approvalView.body.view.workView.pendingConfirmation.confirmationId;
    const decided = await requestJson(
      server.url,
      `/api/basic-agent/runs/${approvalStart.body.run.runId}/confirmations/${confirmationId}/decision`,
      { method: "POST", body: { decision: "approve_once" } },
    );
    assert.equal(decided.status, 200);
    assert.equal(decided.body.run.runId, approvalStart.body.run.runId);
    assert.equal("view" in decided.body.run, false);
    await waitForView(server.url, approvalStart.body.run.runId, "completed");

    const repeated = await requestJson(
      server.url,
      `/api/basic-agent/runs/${approvalStart.body.run.runId}/confirmations/${confirmationId}/decision`,
      { method: "POST", body: { decision: "approve_once" } },
    );
    assert.equal(repeated.status, 409);

    const cancelStart = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "wait until cancelled" },
    });
    const cancelled = await requestJson(server.url, `/api/basic-agent/runs/${cancelStart.body.run.runId}/cancel`, { method: "POST" });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.run.runId, cancelStart.body.run.runId);
    assert.equal(cancelled.body.run.status, "cancelled");
    assert.equal("state" in cancelled.body.run, false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("Ordinary conversation HTTP commands preserve queue ownership and attachment input facts", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-conversation-http-"));
  let executionCount = 0;
  let finishFirst: ((outcome: OrdinaryExecutionOutcome) => void) | undefined;
  const observedInputs: unknown[] = [];
  const execution: OrdinaryExecutionPort = {
    execute(input) {
      executionCount += 1;
      observedInputs.push(input.runInput);
      if (executionCount === 1) {
        return new Promise((resolve) => { finishFirst = resolve; });
      }
      return Promise.resolve(completedOutcome("second answer", { inputTokens: 2, outputTokens: 1, totalTokens: 3 }));
    },
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, ordinaryAgentExecution: execution });
  try {
    const first = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: {
        goal: "use attached context",
        taskSoilInput: {
          contextRefs: [{
            attachmentId: "attachment-1",
            ref: "file:notes/context.md",
            kind: "file",
            title: "context.md",
            readonlyPreview: { text: "attachment body" },
          }],
          permissionBoundaryRefs: ["read:file:notes/context.md"],
        },
      },
    });
    const conversationId = first.body.conversation.conversationId;
    const second = await requestJson(server.url, `/api/conversations/${conversationId}/messages`, {
      method: "POST",
      body: { goal: "follow up after the first run" },
    });
    assert.equal(second.status, 202);
    assert.equal(second.body.run.status, "queued");
    assert.equal(executionCount, 1);

    const renamed = await requestJson(server.url, `/api/conversations/${conversationId}/rename`, {
      method: "POST",
      body: { title: "Pinned task" },
    });
    assert.equal(renamed.body.conversation.title, "Pinned task");
    const pinned = await requestJson(server.url, `/api/conversations/${conversationId}/pin`, {
      method: "POST",
      body: { pinned: true },
    });
    assert.equal(typeof pinned.body.conversation.pinnedAt, "string");

    assert.notEqual(finishFirst, undefined);
    finishFirst!(completedOutcome("first answer", { inputTokens: 3, outputTokens: 1, totalTokens: 4 }));
    await waitForView(server.url, first.body.run.runId, "completed");
    await waitForView(server.url, second.body.run.runId, "completed");
    assert.equal(executionCount, 2);
    const observedAttachment = (observedInputs[0] as {
      taskSoil?: { contextRefs?: { attachmentId?: string; ref: string; readonlyPreview?: { text: string } }[] };
    }).taskSoil?.contextRefs?.[0];
    assert.equal(observedAttachment?.attachmentId, "attachment-1");
    assert.equal(observedAttachment?.ref, "file:notes/context.md");
    assert.equal(observedAttachment?.readonlyPreview?.text, "attachment body");

    const conversation = await requestJson(server.url, `/api/conversations/${conversationId}`);
    assert.equal(conversation.body.conversation.turns.length, 4);
    assert.equal(conversation.body.conversation.turns[0].attachments[0].attachmentId, "attachment-1");

    const rolledBack = await requestJson(server.url, `/api/conversations/${conversationId}/rollback`, {
      method: "POST",
      body: { targetRunId: first.body.run.runId },
    });
    assert.equal(rolledBack.status, 200);
    assert.equal(rolledBack.body.conversation.turns.length, 2);
    assert.equal(rolledBack.body.conversation.latestRunId, first.body.run.runId);

    const deleted = await requestJson(server.url, `/api/conversations/${conversationId}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.equal((await requestJson(server.url, `/api/conversations/${conversationId}`)).status, 404);
    assert.equal(deleted.body.conversations.some((item: { conversationId: string }) => item.conversationId === conversationId), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("Ordinary SSE replays the complete terminal activity history through final.result", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-sse-terminal-"));
  const server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    ordinaryAgentExecution: completedExecution("streamed answer", { inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
  });
  try {
    const submitted = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "replay a completed run" },
    });
    await waitForView(server.url, submitted.body.run.runId, "completed");

    const stream = await requestSse(
      server.url,
      `/api/basic-agent/runs/${submitted.body.run.runId}/stream`,
    );
    const events = ordinarySseEvents(stream.events);
    assert.equal(stream.status, 200);
    assert.deepEqual(events.map((event) => event.type), ["run.created", "run.started", "final.result"]);
    assert.equal(events.at(-1)?.type, "final.result");
    assert.deepEqual(events.map((event) => event.sequence), [...events.map((event) => event.sequence)].sort((left, right) => left - right));
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("Ordinary SSE preserves tool.completed before final.result in terminal replay", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-sse-tool-terminal-"));
  const server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    ordinaryAgentExecution: completedExecutionWithTool("tool-backed answer", { inputTokens: 2, outputTokens: 1, totalTokens: 3 }),
  });
  try {
    const submitted = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "use a tool then finish" },
    });
    await waitForView(server.url, submitted.body.run.runId, "completed");

    const stream = await requestSse(
      server.url,
      `/api/basic-agent/runs/${submitted.body.run.runId}/stream`,
    );
    const eventTypes = ordinarySseEvents(stream.events).map((event) => event.type);
    const toolIndex = eventTypes.indexOf("tool.completed");
    const terminalIndex = eventTypes.indexOf("final.result");
    assert.notEqual(toolIndex, -1);
    assert.equal(terminalIndex, eventTypes.length - 1);
    assert.equal(toolIndex < terminalIndex, true);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("Ordinary SSE reports an opaque-cursor reset and completes terminal replay after restart", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-sse-reset-"));
  let server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    ordinaryAgentExecution: completedExecutionWithTool("persisted answer", { inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
  });
  try {
    const submitted = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "persist and restart" },
    });
    const firstView = await waitForView(server.url, submitted.body.run.runId, "completed");
    const oldCursor = firstView.body.view.replay.cursor.token;
    await server.close();
    server = await startLocalPanelServer({
      port: 0,
      configDirectory: directory,
      ordinaryAgentExecution: completedExecution("unused", {}),
    });

    const stream = await requestSse(
      server.url,
      `/api/basic-agent/runs/${submitted.body.run.runId}/stream?cursor=${encodeURIComponent(oldCursor)}`,
    );
    assert.equal(stream.status, 200);
    assert.match(stream.text, /event: run\.stream\.reset/u);
    assert.match(stream.text, /id: [A-Za-z0-9_-]+/u);
    const eventTypes = ordinarySseEvents(stream.events).map((event) => event.type);
    assert.equal(eventTypes.includes("tool.completed"), true);
    assert.equal(eventTypes.at(-1), "final.result");
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("Panel close aborts the active Ordinary run without starting its queued successor", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-close-"));
  let executions = 0;
  let aborted = 0;
  const server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    ordinaryAgentExecution: {
      execute(input) {
        executions += 1;
        return new Promise((resolve) => input.abortSignal.addEventListener("abort", () => {
          aborted += 1;
          resolve({
            status: "cancelled",
            reason: "ordinary_feature_released",
            canonicalMessages: input.messages,
            toolCalls: [],
            usage: {},
          });
        }, { once: true }));
      },
    },
  });
  let closed = false;
  try {
    const first = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "stay active until close" },
    });
    await waitForView(server.url, first.body.run.runId, "running");
    const second = await requestJson(server.url, `/api/conversations/${first.body.conversation.conversationId}/messages`, {
      method: "POST",
      body: { goal: "must remain queued" },
    });
    assert.equal(second.body.run.status, "queued");

    await server.close();
    closed = true;
    assert.equal(aborted, 1);
    assert.equal(executions, 1);
  } finally {
    if (!closed) await server.close();
    await removeTemporaryTree(directory);
  }
});

test("Panel close releases a pending Ordinary approval continuation once", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-close-approval-"));
  let releases = 0;
  const server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    ordinaryAgentExecution: {
      async execute(input) {
        const request = confirmation(input.runId);
        return {
          status: "approval_required",
          confirmationRequests: [request],
          canonicalMessages: input.messages,
          toolCalls: [],
          usage: {},
          continuation: {
            availability: "live_only",
            async decide() { return completedOutcome("unused", {}); },
            async release() { releases += 1; },
          },
        };
      },
    },
  });
  let closed = false;
  try {
    const submitted = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "wait for approval until close" },
    });
    await waitForView(server.url, submitted.body.run.runId, "approval_needed");
    await server.close();
    closed = true;
    assert.equal(releases, 1);
  } finally {
    if (!closed) await server.close();
    await removeTemporaryTree(directory);
  }
});

function completedExecution(answer: string, usage: OrdinaryExecutionOutcome["usage"]): OrdinaryExecutionPort {
  return {
    async execute(input) {
      input.onTextDelta?.(answer);
      return completedOutcome(answer, usage);
    },
  };
}

function completedExecutionWithTool(answer: string, usage: OrdinaryExecutionOutcome["usage"]): OrdinaryExecutionPort {
  return {
    async execute(input) {
      const toolResult = completedToolResult();
      input.onToolResult?.(toolResult);
      return { ...completedOutcome(answer, usage), toolCalls: [toolResult] };
    },
  };
}

function completedToolResult(): ToolCallResult {
  return {
    callId: "call-read",
    toolName: "read_file",
    input: { path: "README.md" },
    output: { content: "read result" },
    status: "completed",
    durationMs: 2,
  };
}

function ordinarySseEvents(events: readonly unknown[]): readonly {
  readonly type: string;
  readonly sequence: number;
}[] {
  return events.filter((event): event is { readonly type: string; readonly sequence: number } => {
    if (typeof event !== "object" || event === null) return false;
    const record = event as Readonly<Record<string, unknown>>;
    return typeof record.type === "string" && typeof record.sequence === "number";
  });
}

function manualGate(): {
  readonly entered: Promise<void>;
  readonly released: Promise<void>;
  readonly enter: () => void;
  readonly release: () => void;
} {
  let enter: () => void = () => undefined;
  let release: () => void = () => undefined;
  return {
    entered: new Promise<void>((resolve) => { enter = resolve; }),
    released: new Promise<void>((resolve) => { release = resolve; }),
    enter: () => enter(),
    release: () => release(),
  };
}

function completedOutcome(answer: string, usage: OrdinaryExecutionOutcome["usage"]): OrdinaryExecutionOutcome {
  return {
    status: "completed",
    answer,
    canonicalMessages: [{ role: "assistant", content: answer }],
    toolCalls: [],
    usage,
  };
}

function confirmation(runId: string): ConfirmationRequest {
  return {
    confirmationId: `${runId}-confirmation`,
    runId,
    title: "Confirm command",
    actionSummary: "Run a command",
    affectedResources: ["workspace"],
    riskLevel: "medium",
    resumeAvailability: "live",
    requestedAt: new Date().toISOString(),
    sourceRefs: [],
  };
}

async function waitForView(baseUrl: string, runId: string, status: string) {
  const deadline = Date.now() + 4_000;
  let last: Awaited<ReturnType<typeof requestJson>> | undefined;
  while (Date.now() < deadline) {
    last = await requestJson(baseUrl, `/api/basic-agent/runs/${encodeURIComponent(runId)}/view`);
    if (last.status === 200 && last.body.view.run.status === status) return last;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for Ordinary run ${runId} status ${status}; last=${last?.text}`);
}
