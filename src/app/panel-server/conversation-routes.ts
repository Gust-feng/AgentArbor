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
import { asRecord, defaultAiModeForRunKind, numberOrUndefined, optionalString, parseRunInput } from "./request-parsers.js";
import { persistPanelConversation, persistPanelRun } from "./run-persistence.js";
import { createPanelRunJobResponse } from "./run-job-response.js";
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

export async function startGuidanceFollowUpRun(
  runtime: PanelRuntime,
  job: PanelRunJob,
  guidance: string
): Promise<void> {
  if (job.conversationId === undefined || guidance.trim().length === 0) {
    return;
  }
  const started = runtime.conversations.startDesktopMessage({
    goal: guidance,
    taskSoilInput: job.taskSoilInput,
    conversationId: job.conversationId,
  });
  const basicRun = await runtime.runExecutor.start({
    runKind: "desktop",
    runMode: job.runMode,
    goal: guidance,
    aiMode: job.aiMode,
    conversationId: started.conversation.conversationId,
    assistantTurnId: started.assistantTurn.turnId,
    routeDecision: undefined,
    taskSoilInput: job.taskSoilInput,
    reasoningEffort: job.reasoningEffort,
    startImmediately: true,
  });
  const followUpJob = requirePanelRunJob(runtime, basicRun.runId);
  runtime.conversations.attachRun({
    conversationId: started.conversation.conversationId,
    assistantTurnId: started.assistantTurn.turnId,
    runId: followUpJob.runId,
    responseModel: turnModelFromConfig(followUpJob.config),
  });
  await persistPanelRun(runtime, followUpJob);
  await persistPanelConversation(runtime, started.conversation.conversationId);
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
  const memory = runtime.conversations.getReadModel(conversationId);
  if (memory !== undefined) {
    return memory;
  }
  const persisted = await runtime.runtimeDatabase?.getConversation(conversationId);
  return persisted === undefined ? undefined : restorePersistedPanelConversation(runtime, persisted);
}

async function handleConversationMessageRequest(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  conversationId: string | undefined
): Promise<void> {
  const body = await readJsonBody(request);
  const config = await runtime.configCenter.getModelProviderConfig();
  const runInput = parseRunInput(body, defaultAiModeForRunKind("desktop", config.defaultAiMode));
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
    runMode: runInput.runMode,
    goal: runInput.goal,
    aiMode: runInput.aiMode,
    conversationId: started.conversation.conversationId,
    assistantTurnId: started.assistantTurn.turnId,
    runAfterRunId,
    routeDecision: undefined,
    taskSoilInput: mergedTaskSoilInput,
    reasoningEffort: runInput.reasoningEffort,
    startImmediately: !shouldQueue,
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
  await persistPanelRun(runtime, job);

  writeJson(response, 202, {
    ok: true,
    conversation: runtime.conversations.getReadModel(started.conversation.conversationId),
    run: createPanelRunJobResponse(runtime, job),
  });
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
