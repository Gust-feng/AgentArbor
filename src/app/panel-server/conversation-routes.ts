import type { IncomingMessage, ServerResponse } from "node:http";
import {
  turnModelFromConfig,
  type PanelConversationTurnAttachment,
  type PanelConversationReadModel,
  type PanelConversationSummaryReadModel,
} from "../panel-conversation/panel-conversations.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
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
import { persistPanelConversation, persistPanelRunInBackground } from "./run-persistence.js";
import { createPanelRunJobResponse } from "./run-job-response.js";
import { resolvePanelRouteRunMode } from "./run-mode-routing.js";
import { syncConversationPreviewsForRunningJobs } from "./conversation-sync.js";
import { createConversationCurrentRunReadModel } from "./conversation-current-run.js";
import type { PanelRuntime } from "./runtime.js";
import type { PanelContextAttachmentMediaEntry } from "./types.js";
import {
  workspaceFolderSummaryFromPath,
  type WorkspaceFolderSummary,
} from "../workspace-folder-summary.js";

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
    const readModel = runtime.conversations.getReadModelWithCurrentRun(conversationId, currentRun);
    return readModel === undefined
      ? undefined
      : enrichPanelConversationWorkspaceFolder(runtime, readModel);
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
  const userTurnAttachments = conversationTurnAttachmentsFromTaskSoilInput(
    mergedTaskSoilInput,
    runtime.contextAttachmentMedia
  );

  let started;
  try {
    started = runtime.conversations.startDesktopMessage({
      goal: runInput.goal,
      taskSoilInput: mergedTaskSoilInput,
      attachments: userTurnAttachments,
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
    workspaceDirectory: runInput.workspaceDirectory,
    reasoningEffort: runInput.reasoningEffort,
    toolConfirmationPolicy: runInput.toolConfirmationPolicy,
    modelOverride: runInput.modelOverride,
    startImmediately: !shouldQueue,
    deferSchedule: !shouldQueue,
    deferInitialPersistence: true,
  });
  const job = requirePanelRunJob(runtime, basicRun.runId);
  let shouldScheduleQueuedRun = false;
  if (shouldQueue) {
    runtime.conversations.queueRun({
      conversationId: started.conversation.conversationId,
      assistantTurnId: started.assistantTurn.turnId,
      runId: job.runId,
      responseModel: turnModelFromConfig(job.config),
    });
    shouldScheduleQueuedRun = queuedRunCanStartNow(runtime, runAfterRunId);
  } else {
    runtime.conversations.attachRun({
      conversationId: started.conversation.conversationId,
      assistantTurnId: started.assistantTurn.turnId,
      runId: job.runId,
      responseModel: turnModelFromConfig(job.config),
    });
  }
  await persistPanelConversation(runtime, started.conversation.conversationId);
  persistPanelRunInBackground(runtime, job);
  writeJson(response, 202, {
    ok: true,
    conversation: await getPanelConversation(runtime, started.conversation.conversationId),
    run: createPanelRunJobResponse(runtime, job),
  });
  if (shouldScheduleQueuedRun || !shouldQueue) {
    schedulePanelRunJob(runtime, job.runId);
  }
}

function conversationTurnAttachmentsFromTaskSoilInput(
  taskSoilInput: DesktopTaskSoilInput | undefined,
  mediaEntries: ReadonlyMap<string, PanelContextAttachmentMediaEntry>
): readonly PanelConversationTurnAttachment[] | undefined {
  const contextRefs = taskSoilInput?.contextRefs ?? [];
  if (contextRefs.length === 0) {
    return undefined;
  }
  const attachments: PanelConversationTurnAttachment[] = [];
  for (const ref of contextRefs) {
    const attachmentId = ref.attachmentId?.trim();
    if (attachmentId === undefined || attachmentId.length === 0) {
      continue;
    }
    const mediaEntry = mediaEntries.get(attachmentId);
    attachments.push({
      attachmentId,
      kind: ref.kind,
      title: ref.title ?? mediaEntry?.title ?? ref.summary ?? "附件",
      summary: conversationTurnAttachmentSummary(ref),
      readonlyPreviewMeta: {
        available: ref.metadata?.available,
        title: ref.title,
        byteLength: ref.metadata?.byteLength,
        mimeType: ref.metadata?.mimeType,
        truncated: ref.metadata?.truncated,
      },
      mediaPreview: mediaEntry === undefined
        ? undefined
        : {
            kind: "image",
            url: contextAttachmentMediaPreviewUrl(mediaEntry.attachmentId),
            mimeType: mediaEntry.mimeType,
            byteLength: mediaEntry.byteLength,
          },
    });
  }
  return attachments.length === 0 ? undefined : attachments;
}

function contextAttachmentMediaPreviewUrl(attachmentId: string): string {
  return `/api/context/attachments/media/${encodeURIComponent(attachmentId)}`;
}

function conversationTurnAttachmentSummary(
  ref: NonNullable<DesktopTaskSoilInput["contextRefs"]>[number]
): string | undefined {
  const parts = [ref.metadata?.mimeType, byteSizeLabel(ref.metadata?.byteLength)]
    .filter((value): value is string => value !== undefined);
  if (parts.length > 0) {
    return parts.join(" · ");
  }
  if (ref.ref.startsWith("local-file:")) {
    return "本地文件";
  }
  if (ref.ref.startsWith("local-project:")) {
    return "本地文件夹";
  }
  return ref.summary;
}

function byteSizeLabel(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${value} bytes`;
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
  return enrichPanelConversationSummaries(
    runtime,
    runtime.conversations.list().slice(0, Math.max(0, Math.floor(limit)))
  );
}

async function enrichPanelConversationSummaries(
  runtime: PanelRuntime,
  conversations: readonly PanelConversationSummaryReadModel[]
): Promise<readonly PanelConversationSummaryReadModel[]> {
  return Promise.all(
    conversations.map((conversation) => enrichPanelConversationWorkspaceFolder(runtime, conversation))
  );
}

async function enrichPanelConversationWorkspaceFolder<T extends PanelConversationSummaryReadModel>(
  runtime: PanelRuntime,
  conversation: T
): Promise<T> {
  const workspaceFolder = await workspaceFolderForConversation(runtime, conversation.conversationId);
  return workspaceFolder === undefined
    ? conversation
    : {
        ...conversation,
        workspaceFolder,
      };
}

async function workspaceFolderForConversation(
  runtime: PanelRuntime,
  conversationId: string
): Promise<WorkspaceFolderSummary | undefined> {
  const conversation = runtime.conversations.get(conversationId);
  for (const runId of assistantRunIdsByRecency(conversation)) {
    const liveRunWorkspace = runtime.runJobs.get(runId)?.capabilitySnapshot?.workspace.workspaceDirectory;
    if (liveRunWorkspace !== undefined) {
      return workspaceFolderSummaryFromPath(liveRunWorkspace);
    }
    const persistedRun = await runtime.runtimeDatabase?.getRun(runId);
    const runWorkspace = workspaceFolderSummaryFromPath(
      persistedRun?.run.workspacePath ?? persistedRun?.run.capabilitySnapshot?.workspace.workspaceDirectory
    );
    if (runWorkspace !== undefined) {
      return runWorkspace;
    }
  }
  return workspaceFolderFromConversationContext(conversation);
}

function assistantRunIdsByRecency(
  conversation: ReturnType<PanelRuntime["conversations"]["get"]>
): readonly string[] {
  const runIds: string[] = [];
  const seen = new Set<string>();
  for (let index = (conversation?.turns.length ?? 0) - 1; index >= 0; index -= 1) {
    const turn = conversation?.turns[index];
    if (turn?.role !== "assistant" || turn.runId === undefined || seen.has(turn.runId)) {
      continue;
    }
    seen.add(turn.runId);
    runIds.push(turn.runId);
  }
  return runIds;
}

function workspaceFolderFromConversationContext(
  conversation: ReturnType<PanelRuntime["conversations"]["get"]>
): WorkspaceFolderSummary | undefined {
  const userTurn = conversation?.turns.find((turn) => turn.role === "user");
  const contextWorkspace = workspacePathFromTaskSoilInput(userTurn?.taskSoilInput);
  if (contextWorkspace !== undefined) {
    return workspaceFolderSummaryFromPath(contextWorkspace);
  }
  const attachmentWorkspace = userTurn?.attachments
    ?.map(workspacePathFromTurnAttachment)
    .find((workspacePath): workspacePath is string => workspacePath !== undefined);
  return workspaceFolderSummaryFromPath(attachmentWorkspace);
}

function workspacePathFromTaskSoilInput(taskSoilInput: DesktopTaskSoilInput | undefined): string | undefined {
  return taskSoilInput?.contextRefs
    ?.filter((ref) => ref.kind === "workspace" || ref.kind === "project")
    .map((ref) => workspacePathFromLocalRef(ref.ref))
    .find((workspacePath): workspacePath is string => workspacePath !== undefined);
}

function workspacePathFromTurnAttachment(attachment: PanelConversationTurnAttachment): string | undefined {
  if (attachment.kind !== "workspace" && attachment.kind !== "project") {
    return undefined;
  }
  return workspacePathFromLocalRef(attachment.attachmentId);
}

function workspacePathFromLocalRef(ref: string | undefined): string | undefined {
  const prefix = ref?.startsWith("local-project:")
    ? "local-project:"
    : ref?.startsWith("local-workspace:")
      ? "local-workspace:"
      : undefined;
  if (prefix === undefined) {
    return undefined;
  }
  const value = ref?.slice(prefix.length).trim();
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
