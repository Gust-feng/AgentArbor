import type { IncomingMessage, ServerResponse } from "node:http";
import {
  turnModelFromConfig,
  type PanelConversationReadModel,
  type PanelConversationSummaryReadModel,
} from "../panel-conversations.js";
import type { PanelRunJob } from "../panel-run-jobs.js";
import { isTerminalPanelRunStatus } from "./runtime-records.js";
import { restorePersistedPanelConversation } from "./conversation-restore.js";
import { PanelHttpError, readJsonBody, writeJson } from "./http-utils.js";
import {
  asRecord,
  numberOrUndefined,
  optionalString,
  parseConversationPinInput,
  parseConversationRenameInput,
  parseRunInput,
} from "./request-parsers.js";
import { persistPanelConversation } from "./run-persistence.js";
import { createPanelRunJobResponse } from "./run-job-response.js";
import { resolvePanelRouteRunMode } from "./run-mode-routing.js";
import { syncConversationPreviewsForRunningJobs } from "./conversation-sync.js";
import { createConversationCurrentRunReadModel } from "./conversation-current-run.js";
import type { PanelRuntime } from "./runtime.js";

export async function handlePanelConversationRoute(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<boolean> {
  if (request.method === "GET" && url.pathname === "/api/conversations") {
    writeJson(response, 200, {
      ok: true,
      conversations: await listPanelConversations(runtime),
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/conversations") {
    await handleConversationMessageRequest(runtime, request, response, undefined);
    return true;
  }

  const conversationMatch = /^\/api\/conversations\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && conversationMatch !== null) {
    const conversationId = decodeURIComponent(conversationMatch[1] ?? "");
    const conversation = await getPanelConversation(runtime, conversationId);
    if (conversation === undefined) {
      throw new PanelHttpError(404, "conversation_not_found", "未找到对话。");
    }
    writeJson(response, 200, {
      ok: true,
      conversation,
    });
    return true;
  }

  const conversationMessagesMatch = /^\/api\/conversations\/([^/]+)\/messages$/.exec(url.pathname);
  if (request.method === "POST" && conversationMessagesMatch !== null) {
    await handleConversationMessageRequest(
      runtime,
      request,
      response,
      decodeURIComponent(conversationMessagesMatch[1] ?? "")
    );
    return true;
  }

  const conversationRenameMatch = /^\/api\/conversations\/([^/]+)\/rename$/.exec(url.pathname);
  if (request.method === "POST" && conversationRenameMatch !== null) {
    await handleConversationRenameRequest(
      runtime,
      request,
      response,
      decodeURIComponent(conversationRenameMatch[1] ?? "")
    );
    return true;
  }

  const conversationPinMatch = /^\/api\/conversations\/([^/]+)\/pin$/.exec(url.pathname);
  if (request.method === "POST" && conversationPinMatch !== null) {
    await handleConversationPinRequest(
      runtime,
      request,
      response,
      decodeURIComponent(conversationPinMatch[1] ?? "")
    );
    return true;
  }

  const conversationDeleteMatch = /^\/api\/conversations\/([^/]+)$/.exec(url.pathname);
  if (request.method === "DELETE" && conversationDeleteMatch !== null) {
    await handleConversationDeleteRequest(
      runtime,
      response,
      decodeURIComponent(conversationDeleteMatch[1] ?? "")
    );
    return true;
  }

  const conversationRollbackMatch = /^\/api\/conversations\/([^/]+)\/rollback$/.exec(url.pathname);
  if (request.method === "POST" && conversationRollbackMatch !== null) {
    await handleConversationRollbackRequest(
      runtime,
      request,
      response,
      decodeURIComponent(conversationRollbackMatch[1] ?? "")
    );
    return true;
  }

  return false;
}

export function schedulePanelRunJob(runtime: PanelRuntime, runId: string): void {
  runtime.runExecutor.schedule(runId);
}

export function scheduleNextQueuedConversationRun(runtime: PanelRuntime, completedJob: PanelRunJob): void {
  if (completedJob.conversationId === undefined) {
    return;
  }
  const nextRunId = runtime.conversations.peekNextQueuedRunId(completedJob.conversationId);
  if (nextRunId === undefined) {
    return;
  }
  const nextJob = runtime.runJobs.get(nextRunId);
  if (nextJob === undefined || nextJob.status !== "pending") {
    return;
  }
  schedulePanelRunJob(runtime, nextRunId);
}

export async function getPanelConversation(
  runtime: PanelRuntime,
  conversationId: string
): Promise<PanelConversationReadModel | undefined> {
  const conversation = runtime.conversations.get(conversationId);
  if (conversation !== undefined) {
    const currentRunId = conversation.currentRunId ?? conversation.latestRunId;
    const currentRun = currentRunId === undefined
      ? undefined
      : await createConversationCurrentRunReadModel(runtime, currentRunId);
    return runtime.conversations.getReadModelWithCurrentRun(conversationId, currentRun);
  }
  const persisted = await runtime.runtimeDatabase?.getConversation(conversationId);
  if (persisted === undefined) {
    return undefined;
  }
  await restorePersistedPanelConversation(runtime, persisted);
  return getPanelConversation(runtime, conversationId);
}

async function handleConversationMessageRequest(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  conversationId: string | undefined
): Promise<void> {
  const body = await readJsonBody(request);
  const runInput = parseRunInput(body);
  const runMode = resolvePanelRouteRunMode({
    runKind: "desktop",
    requestedRunMode: runInput.requestedRunMode,
    mismatchCode: "conversation_run_mode_not_supported",
    mismatchMessage: "对话入口当前只支持默认普通 agent 运行。请使用显式 deep 入口。",
  });
  if (conversationId !== undefined) {
    await ensurePanelConversationLoaded(runtime, conversationId);
  }
  const runAfterRunId = runtime.conversations.nextQueuePredecessor(conversationId);
  const shouldQueue = runAfterRunId !== undefined;
  const mergedTaskSoilInput = runInput.taskSoilInput;

  let started;
  try {
    started = runtime.conversations.startDesktopMessage({
      goal: runInput.goal,
      taskSoilInput: mergedTaskSoilInput,
      conversationId,
      queueBehindRunId: runAfterRunId,
    });
  } catch {
    throw new PanelHttpError(409, "conversation_busy", "无法创建对话消息。");
  }

  const basicRun = await runtime.runExecutor.start({
    runKind: "desktop",
    runMode,
    goal: runInput.goal,
    aiMode: runInput.aiMode,
    conversationId: started.conversation.conversationId,
    assistantTurnId: started.assistantTurn.turnId,
    runAfterRunId,
    taskSoilInput: mergedTaskSoilInput,
    reasoningEffort: runInput.reasoningEffort,
    modelOverride: runInput.modelOverride,
    startImmediately: !shouldQueue,
    deferSchedule: !shouldQueue,
  });
  const job = requirePanelRunJob(runtime, basicRun.runId);
  if (shouldQueue) {
    runtime.conversations.queueRun({
      conversationId: started.conversation.conversationId,
      assistantTurnId: started.assistantTurn.turnId,
      runId: job.runId,
      responseModel: turnModelFromConfig(job.config),
    });
    if (queuedRunCanStartNow(runtime, runAfterRunId)) {
      schedulePanelRunJob(runtime, job.runId);
    }
  } else {
    runtime.conversations.attachRun({
      conversationId: started.conversation.conversationId,
      assistantTurnId: started.assistantTurn.turnId,
      runId: job.runId,
      responseModel: turnModelFromConfig(job.config),
    });
  }
  writeJson(response, 202, {
    ok: true,
    conversation: await getPanelConversation(runtime, started.conversation.conversationId),
    run: createPanelRunJobResponse(runtime, job),
  });
  if (!shouldQueue) {
    schedulePanelRunJob(runtime, job.runId);
  }
}

function queuedRunCanStartNow(runtime: PanelRuntime, predecessorRunId: string | undefined): boolean {
  if (predecessorRunId === undefined) {
    return true;
  }
  const predecessor = runtime.runJobs.get(predecessorRunId);
  return predecessor === undefined || isTerminalPanelRunStatus(predecessor.status);
}

function requirePanelRunJob(runtime: PanelRuntime, runId: string): PanelRunJob {
  const job = runtime.runJobs.get(runId);
  if (job === undefined) {
    throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行。");
  }
  return job;
}

async function listPanelConversations(
  runtime: PanelRuntime,
  limit = 50
): Promise<readonly PanelConversationSummaryReadModel[]> {
  const persisted = (await runtime.runtimeDatabase?.listConversations(limit)) ?? [];
  for (const record of persisted) {
    if (runtime.conversations.get(record.conversationId) === undefined) {
      await restorePersistedPanelConversation(runtime, record);
    }
  }
  syncConversationPreviewsForRunningJobs({
    conversations: runtime.conversations,
    jobs: runtime.runJobs.list(),
    createResponse: (job) => createPanelRunJobResponse(runtime, job),
  });
  return runtime.conversations.list().slice(0, Math.max(0, Math.floor(limit)));
}

async function ensurePanelConversationLoaded(
  runtime: PanelRuntime,
  conversationId: string
): Promise<PanelConversationReadModel> {
  const memory = runtime.conversations.getReadModel(conversationId);
  if (memory !== undefined) {
    return memory;
  }
  const persisted = await runtime.runtimeDatabase?.getConversation(conversationId);
  if (persisted === undefined) {
    throw new PanelHttpError(404, "conversation_not_found", "未找到对话。");
  }
  return restorePersistedPanelConversation(runtime, persisted);
}

async function handleConversationRenameRequest(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  conversationId: string
): Promise<void> {
  await ensurePanelConversationLoaded(runtime, conversationId);
  const input = parseConversationRenameInput(await readJsonBody(request));
  try {
    runtime.conversations.rename({ conversationId, title: input.title });
    await persistPanelConversation(runtime, conversationId);
    writeJson(response, 200, {
      ok: true,
      conversation: await getPanelConversation(runtime, conversationId),
      conversations: await listPanelConversations(runtime),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("title cannot be empty")) {
      throw new PanelHttpError(400, "missing_conversation_title", "会话标题不能为空。");
    }
    throw error;
  }
}

async function handleConversationPinRequest(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  conversationId: string
): Promise<void> {
  await ensurePanelConversationLoaded(runtime, conversationId);
  const input = parseConversationPinInput(await readJsonBody(request));
  runtime.conversations.setPinned({ conversationId, pinned: input.pinned });
  await persistPanelConversation(runtime, conversationId);
  writeJson(response, 200, {
    ok: true,
    conversation: await getPanelConversation(runtime, conversationId),
    conversations: await listPanelConversations(runtime),
  });
}

async function handleConversationDeleteRequest(
  runtime: PanelRuntime,
  response: ServerResponse,
  conversationId: string
): Promise<void> {
  const conversation = await ensurePanelConversationLoaded(runtime, conversationId);
  if (conversation.activeRunId !== undefined || conversation.queuedRunCount > 0) {
    throw new PanelHttpError(409, "conversation_busy", "会话仍有运行中或排队中的任务，暂不能删除。");
  }
  runtime.conversations.delete(conversationId);
  await runtime.runtimeDatabase?.deleteConversation(conversationId);
  writeJson(response, 200, {
    ok: true,
    deletedConversationId: conversationId,
    conversations: await listPanelConversations(runtime),
  });
}

async function handleConversationRollbackRequest(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  conversationId: string
): Promise<void> {
  await ensurePanelConversationLoaded(runtime, conversationId);
  const body = asRecord(await readJsonBody(request));
  try {
    const conversation = runtime.conversations.rollback({
      conversationId,
      targetTurnId: optionalString(body.targetTurnId),
      stepsBack: numberOrUndefined(body.stepsBack),
      keepCompletedPairs: numberOrUndefined(body.keepCompletedPairs),
    });
    await persistPanelConversation(runtime, conversationId);
    writeJson(response, 200, {
      ok: true,
      conversation,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("turn not found")) {
      throw new PanelHttpError(404, "conversation_turn_not_found", "未找到要回退到的对话轮次。");
    }
    throw error;
  }
}
