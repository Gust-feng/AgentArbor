import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ModelRuntimeConfigurationError,
} from "../model-runtime/index.js";
import type { RuntimeRunSnapshot } from "../../domain/runtime-database/index.js";
import type { PanelRunJob, PanelRunKind } from "../panel-run-jobs.js";
import { getPanelConversation } from "./conversation-routes.js";
import { syncConversationTurnForJob } from "./conversation-sync.js";
import {
  PanelHttpError,
  parseStreamCursor,
  readJsonBody,
  writeJson,
  writePanelError,
  writeSseEvent,
} from "./http-utils.js";
import { createPersistedPanelRunResponse } from "./persisted-run-response.js";
import { parseRunInput } from "./request-parsers.js";
import {
  createPanelRunResponse,
  createConfigurationFailedAiSummary,
  panelConfigurationErrorMessage,
  runForPanel,
  type PanelRunResponse,
} from "./run-execution.js";
import { createPanelRunJobResponse, type PanelRunJobResponse } from "./run-job-response.js";
import { persistPanelConversation, persistPanelRun } from "./run-persistence.js";
import { syncPanelRunStreamEventsForJob } from "./run-stream-sync.js";
import { resolvePanelRouteRunMode } from "./run-mode-routing.js";
import { isTerminalPanelRunStatus } from "./runtime-records.js";
import type { PanelRuntime } from "./runtime.js";

export async function handlePanelRunRoute(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<boolean> {
  if (request.method === "POST" && url.pathname === "/api/underground/run") {
    await handleRunRequest(runtime, request, response, "underground");
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/underground/runs") {
    await handleStartRunRequest(runtime, request, response, "underground");
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/desktop/runs") {
    await handleStartRunRequest(runtime, request, response, "desktop");
    return true;
  }

  const runMatch = /^\/api\/underground\/runs\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && runMatch !== null) {
    await handleGetRunRequest(runtime, decodeURIComponent(runMatch[1] ?? ""), "underground", response);
    return true;
  }

  const desktopRunMatch = /^\/api\/desktop\/runs\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && desktopRunMatch !== null) {
    await handleGetRunRequest(runtime, decodeURIComponent(desktopRunMatch[1] ?? ""), "desktop", response);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/runtime/runs") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    writeJson(response, 200, {
      ok: true,
      runs: (await runtime.runtimeDatabase?.listRuns(Number.isFinite(limit) ? limit : 50)) ?? [],
    });
    return true;
  }

  const runtimeRunMatch = /^\/api\/runtime\/runs\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && runtimeRunMatch !== null) {
    const runId = decodeURIComponent(runtimeRunMatch[1] ?? "");
    const snapshot = await runtime.runtimeDatabase?.getRun(runId);
    if (snapshot === undefined) {
      throw new PanelHttpError(404, "run_not_found", "未找到持久化运行记录。");
    }
    writeJson(response, 200, await createPersistedRunResponse(runtime, snapshot));
    return true;
  }

  const runStreamMatch = /^\/api\/underground\/runs\/([^/]+)\/stream$/.exec(url.pathname);
  if (request.method === "GET" && runStreamMatch !== null) {
    handleGetRunStreamRequest(runtime, decodeURIComponent(runStreamMatch[1] ?? ""), "underground", url, request, response);
    return true;
  }

  const desktopRunStreamMatch = /^\/api\/desktop\/runs\/([^/]+)\/stream$/.exec(url.pathname);
  if (request.method === "GET" && desktopRunStreamMatch !== null) {
    handleGetRunStreamRequest(runtime, decodeURIComponent(desktopRunStreamMatch[1] ?? ""), "desktop", url, request, response);
    return true;
  }

  return false;
}

async function handleRunRequest(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  runKind: PanelRunKind
): Promise<void> {
  if (runKind === "desktop") {
    throw new PanelHttpError(
      400,
      "desktop_sync_run_not_supported",
      "Desktop 默认运行入口必须创建异步普通 agent run。"
    );
  }
  const body = await readJsonBody(request);
  const config = await runtime.configCenter.getModelProviderConfig();
  const informationAccess = await runtime.configCenter.getInformationAccessConfig();
  const runInput = parseRunInput(body);
  const runMode = resolveRunModeForRoute(runKind, runInput.requestedRunMode);
  const aiMode = runInput.aiMode ?? config.defaultAiMode;

  try {
    const run = await runForPanel(runtime, runKind, runInput.goal, aiMode, runInput.taskSoilInput, runMode, {
      config,
      informationAccess,
      reasoningEffort: runInput.reasoningEffort,
    });
    writeJson(response, 200, await createPanelRunResponse({
      runtime,
      runKind,
      runMode,
      requestedMode: aiMode,
      reasoningEffort: runInput.reasoningEffort,
      run,
    }) satisfies PanelRunResponse);
  } catch (error) {
    if (error instanceof ModelRuntimeConfigurationError) {
      const message = panelConfigurationErrorMessage(error.issue.code);
      const ai = createConfigurationFailedAiSummary(error.issue.summaryInput, error, message);
      writeJson(response, 400, {
        ok: false,
        status: "failed",
        config,
        informationAccess,
        error: {
          code: error.issue.code,
          message,
        },
        summary: { ai },
      });
      return;
    }
    if (error instanceof PanelHttpError) {
      writePanelError(response, error, { config, informationAccess });
      return;
    }
    throw error;
  }
}

async function handleStartRunRequest(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  runKind: PanelRunKind
): Promise<void> {
  const body = await readJsonBody(request);
  const runInput = parseRunInput(body);
  const runMode = resolveRunModeForRoute(runKind, runInput.requestedRunMode);
  const basicRun = await runtime.runExecutor.start({
    runKind,
    runMode,
    goal: runInput.goal,
    aiMode: runInput.aiMode,
    taskSoilInput: runInput.taskSoilInput,
    reasoningEffort: runInput.reasoningEffort,
    deferSchedule: true,
  });
  const job = requirePanelRunJob(runtime, basicRun.runId);

  writeJson(response, 202, createPanelRunJobResponse(runtime, job));
  runtime.runExecutor.schedule(job.runId);
}

function requirePanelRunJob(runtime: PanelRuntime, runId: string): PanelRunJob {
  const job = runtime.runJobs.get(runId);
  if (job === undefined) {
    throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行。");
  }
  return job;
}

async function handleGetRunRequest(
  runtime: PanelRuntime,
  runId: string,
  expectedRunKind: PanelRunKind,
  response: ServerResponse
): Promise<void> {
  const job = runtime.runJobs.get(runId);
  if (job !== undefined && job.runKind === expectedRunKind) {
    if (isTerminalPanelRunStatus(job.status)) {
      await persistPanelRun(runtime, job);
    }
    let jobResponse = createPanelRunJobResponse(runtime, job);
    if (job.status === "approval_needed" || job.status === "needs_input") {
      syncConversationTurnForJob({
        conversations: runtime.conversations,
        job,
        response: jobResponse,
      });
      if (job.conversationId !== undefined) {
        await persistPanelConversation(runtime, job.conversationId);
      }
      jobResponse = {
        ...jobResponse,
        conversation: job.conversationId === undefined ? undefined : runtime.conversations.getReadModel(job.conversationId),
      };
    }
    writeJson(response, 200, jobResponse);
    return;
  }
  const snapshot = await runtime.runtimeDatabase?.getRun(runId);
  if (snapshot === undefined || snapshot.run.runKind !== expectedRunKind) {
    throw new PanelHttpError(404, "run_not_found", runNotFoundMessage());
  }
  writeJson(response, 200, await createPersistedRunResponse(runtime, snapshot));
}

function handleGetRunStreamRequest(
  runtime: PanelRuntime,
  runId: string,
  expectedRunKind: PanelRunKind,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse
): void {
  const job = runtime.runJobs.get(runId);
  if (job === undefined || job.runKind !== expectedRunKind) {
    throw new PanelHttpError(404, "run_not_found", runNotFoundMessage());
  }

  let lastSequence = parseStreamCursor(url.searchParams.get("cursor"), request.headers["last-event-id"]);
  let closed = false;
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.write(`: AgentArbor panel run stream ${runId}\n\n`);

  const flush = (): void => {
    if (closed) {
      return;
    }
    const current = runtime.runJobs.get(runId);
    if (current === undefined) {
      writeSseEvent(response, {
        eventId: `${runId}:run.failed:not-found`,
        runId,
        sequence: lastSequence + 1,
        type: "run.failed",
        createdAt: new Date().toISOString(),
        agentLabel: "AgentArbor Runtime",
        summary: "运行已不存在。",
        status: "failed",
        sourceRefs: [],
        modelCallRefs: [],
        toolCallRefs: [],
      });
      cleanup();
      return;
    }
    const events = syncPanelRunStreamEventsForJob(runtime, current);
    for (const event of events) {
      if (event.sequence <= lastSequence) {
        continue;
      }
      writeSseEvent(response, event);
      lastSequence = event.sequence;
    }
    if (isTerminalPanelRunStatus(current.status)) {
      cleanup();
    }
  };

  const cleanup = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(interval);
    response.end();
  };

  const interval = setInterval(flush, 100);
  request.on("close", cleanup);
  flush();
}

async function createPersistedRunResponse(
  runtime: PanelRuntime,
  snapshot: RuntimeRunSnapshot
): Promise<PanelRunJobResponse> {
  const config =
    snapshot.run.capabilitySnapshot?.activeModel ??
    await runtime.configCenter.getModelProviderConfig();
  const informationAccess =
    snapshot.run.informationAccess ??
    await runtime.configCenter.getInformationAccessConfig();
  const conversation =
    snapshot.run.conversationId === undefined
      ? undefined
      : await getPanelConversation(runtime, snapshot.run.conversationId);
  return createPersistedPanelRunResponse({
    snapshot,
    config,
    informationAccess,
    conversation,
  });
}

function runNotFoundMessage(): string {
  return "未找到运行。";
}

function resolveRunModeForRoute(
  runKind: PanelRunKind,
  requestedRunMode: PanelRunJobResponse["runMode"] | undefined
): PanelRunJobResponse["runMode"] {
  return resolvePanelRouteRunMode({ runKind, requestedRunMode });
}
