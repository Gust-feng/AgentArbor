import type { IncomingMessage, ServerResponse } from "node:http";
import type { BasicAgentRun } from "../../domain/basic-agent/index.js";
import type { RuntimeDatabase, RuntimeRunSnapshot } from "../../domain/runtime-database/index.js";
import {
  BasicAgentConfirmationDecisionError,
  projectRunStreamEventToRunEvent,
  submitRestoredBasicConfirmationDecision,
  type BasicAgentRunExecutor,
} from "../basic-agent-runtime/index.js";
import {
  createPersistedBasicAgentReplay,
  createPersistedBasicAgentRun,
} from "./basic-agent-read-models.js";
import type { PanelRunJob } from "./run-jobs.js";
import { createBasicAgentRunViewReadModel } from "./basic-agent-run-view.js";
import {
  PanelHttpError,
  parseStreamCursor,
  readJsonBody,
  writeSseEvent,
  writeJson,
} from "./http-utils.js";
import { parseConfirmationDecision } from "./request-parsers.js";
import { appRunEventsAfterSequence } from "../run-runtime-core/event-stream.js";
import { enqueuePanelPersistence } from "./persistence.js";

export type PanelBasicAgentRouteRuntime = {
  readonly runJobs: {
    get(runId: string): PanelRunJob | undefined;
  };
  readonly runExecutor: BasicAgentRunExecutor;
  readonly runtimeDatabase?: RuntimeDatabase;
  /**
   * Restored confirmation decisions must share the same per-run writer as
   * background run snapshots. Otherwise a late snapshot can overwrite the
   * decision made from the persisted record.
   */
  readonly persistenceChains: Map<string, Promise<void>>;
};

export async function handlePanelBasicAgentRoute(
  runtime: PanelBasicAgentRouteRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<boolean> {
  const basicWorkViewMatch = /^\/api\/basic-agent\/runs\/([^/]+)\/work-view$/.exec(url.pathname);
  if (request.method === "GET" && basicWorkViewMatch !== null) {
    await handleGetBasicWorkViewRequest(
      runtime,
      decodeURIComponent(basicWorkViewMatch[1] ?? ""),
      response
    );
    return true;
  }

  const basicRunEventsMatch = /^\/api\/basic-agent\/runs\/([^/]+)\/events$/.exec(url.pathname);
  if (request.method === "GET" && basicRunEventsMatch !== null) {
    await handleGetBasicRunEventsRequest(
      runtime,
      decodeURIComponent(basicRunEventsMatch[1] ?? ""),
      url,
      request,
      response
    );
    return true;
  }

  const basicRunViewMatch = /^\/api\/basic-agent\/runs\/([^/]+)\/view$/.exec(url.pathname);
  if (request.method === "GET" && basicRunViewMatch !== null) {
    await handleGetBasicRunViewRequest(
      runtime,
      decodeURIComponent(basicRunViewMatch[1] ?? ""),
      url,
      request,
      response
    );
    return true;
  }

  const basicRunStreamMatch = /^\/api\/basic-agent\/runs\/([^/]+)\/stream$/.exec(url.pathname);
  if (request.method === "GET" && basicRunStreamMatch !== null) {
    await handleGetBasicRunStreamRequest(
      runtime,
      decodeURIComponent(basicRunStreamMatch[1] ?? ""),
      url,
      request,
      response
    );
    return true;
  }

  const basicRunMatch = /^\/api\/basic-agent\/runs\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && basicRunMatch !== null) {
    await handleGetBasicRunRequest(
      runtime,
      decodeURIComponent(basicRunMatch[1] ?? ""),
      response
    );
    return true;
  }

  const basicRunCancelMatch = /^\/api\/basic-agent\/runs\/([^/]+)\/cancel$/.exec(url.pathname);
  if (request.method === "POST" && basicRunCancelMatch !== null) {
    await handleCancelBasicRunRequest(runtime, decodeURIComponent(basicRunCancelMatch[1] ?? ""), response);
    return true;
  }

  const confirmationDecisionMatch = /^\/api\/basic-agent\/runs\/([^/]+)\/confirmations\/([^/]+)\/decision$/.exec(url.pathname);
  if (request.method === "POST" && confirmationDecisionMatch !== null) {
    await handleConfirmationDecisionRequest(
      runtime,
      decodeURIComponent(confirmationDecisionMatch[1] ?? ""),
      decodeURIComponent(confirmationDecisionMatch[2] ?? ""),
      request,
      response
    );
    return true;
  }

  return false;
}

async function handleGetBasicWorkViewRequest(
  runtime: PanelBasicAgentRouteRuntime,
  runId: string,
  response: ServerResponse
): Promise<void> {
  const view = await createBasicAgentRunViewReadModel(runtime, runId, 0);
  if (view === undefined) {
    throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行。");
  }
  writeJson(response, 200, {
    ok: true,
    workView: view.workView,
  });
}

async function handleGetBasicRunEventsRequest(
  runtime: PanelBasicAgentRouteRuntime,
  runId: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const cursor = parseStreamCursor(url.searchParams.get("cursor"), request.headers["last-event-id"]);
  const replay = runtime.runExecutor.replayEvents(runId, cursor);
  if (replay !== undefined) {
    writeJson(response, 200, {
      ok: true,
      runId,
      cursor: replay.cursor,
      events: replay.events,
    });
    return;
  }

  const snapshot = await runtime.runtimeDatabase?.getRun(runId);
  if (snapshot === undefined) {
    throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行事件。");
  }
  const restored = createPersistedBasicAgentReplay(snapshot);
  writeJson(response, 200, {
    ok: true,
    runId,
    cursor: restored.cursor,
    events: restored.events.filter((event) => event.sequence > cursor),
  });
}

async function handleGetBasicRunViewRequest(
  runtime: PanelBasicAgentRouteRuntime,
  runId: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const cursor = parseStreamCursor(url.searchParams.get("cursor"), request.headers["last-event-id"]);
  const view = await createBasicAgentRunViewReadModel(runtime, runId, cursor);
  if (view === undefined) {
    throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行视图。");
  }
  writeJson(response, 200, {
    ok: true,
    view,
  });
}

async function handleGetBasicRunStreamRequest(
  runtime: PanelBasicAgentRouteRuntime,
  runId: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  let restoredReplay: ReturnType<typeof createPersistedBasicAgentReplay> | undefined;
  if (runtime.runJobs.get(runId) === undefined) {
    const snapshot = await runtime.runtimeDatabase?.getRun(runId);
    if (snapshot === undefined) {
      throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行事件。");
    }
    restoredReplay = createPersistedBasicAgentReplay(snapshot);
  }

  let lastSequence = parseStreamCursor(url.searchParams.get("cursor"), request.headers["last-event-id"]);
  let closed = false;
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.write(`: AgentArbor basic agent stream ${runId}\n\n`);

  const flushRestored = (): void => {
    if (restoredReplay === undefined || closed) {
      return;
    }
    for (const event of restoredReplay.events) {
      if (event.sequence <= lastSequence) {
        continue;
      }
      writeSseEvent(response, event);
      lastSequence = event.sequence;
    }
    cleanup();
  };

  const flushLive = (): void => {
    if (closed) {
      return;
    }
    const job = runtime.runJobs.get(runId);
    if (job === undefined) {
      flushRestored();
      return;
    }
    for (const event of appRunEventsAfterSequence(job.streamEvents, lastSequence)) {
      const runEvent = projectRunStreamEventToRunEvent(event);
      writeSseEvent(response, runEvent);
      lastSequence = runEvent.sequence;
    }
    const run = runtime.runExecutor.get(runId);
    if (run !== undefined && shouldCloseBasicRunStream(run.status)) {
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

  const interval = setInterval(flushLive, 100);
  request.on("close", cleanup);
  restoredReplay === undefined ? flushLive() : flushRestored();
}

async function handleGetBasicRunRequest(
  runtime: PanelBasicAgentRouteRuntime,
  runId: string,
  response: ServerResponse
): Promise<void> {
  const job = runtime.runJobs.get(runId);
  if (job !== undefined) {
    if (isTerminalPanelJobStatus(job.status)) {
      await runtime.runExecutor.waitForTerminalCommit(runId);
    }
    writeJson(response, 200, {
      ok: true,
      run: requireBasicRun(runtime, runId),
    });
    return;
  }
  const snapshot = await runtime.runtimeDatabase?.getRun(runId);
  if (snapshot === undefined) {
    throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行。");
  }
  writeJson(response, 200, {
    ok: true,
    run: createPersistedBasicAgentRun(snapshot),
  });
}

async function handleCancelBasicRunRequest(
  runtime: PanelBasicAgentRouteRuntime,
  runId: string,
  response: ServerResponse
): Promise<void> {
  const run = await runtime.runExecutor.cancel(runId).catch((error: unknown) => {
    if (error instanceof Error && error.message.includes("not found")) {
      throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行。");
    }
    throw error;
  });
  writeJson(response, 200, { ok: true, run });
}

async function handleConfirmationDecisionRequest(
  runtime: PanelBasicAgentRouteRuntime,
  runId: string,
  confirmationId: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readJsonBody(request);
  const decision = parseConfirmationDecision(body);
  const run = await runtime.runExecutor.submitConfirmationDecision({
    runId,
    confirmationId,
    decision: decision.decision,
    guidance: decision.guidance,
  }).catch(async (error: unknown) => {
    if (error instanceof BasicAgentConfirmationDecisionError) {
      throw new PanelHttpError(409, error.code, error.message);
    }
    if (error instanceof Error && error.message.includes("not found")) {
      let restored: RuntimeRunSnapshot | undefined;
      await enqueuePanelPersistence(runtime.persistenceChains, runId, async () => {
        restored = await submitRestoredBasicConfirmationDecision({
          runtimeDatabase: runtime.runtimeDatabase,
          runId,
          confirmationId,
          decision,
        });
      });
      if (restored !== undefined) {
        return createPersistedBasicAgentRun(restored);
      }
      throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行。");
    }
    throw error;
  });
  writeJson(response, 200, { ok: true, run });
}

function requireBasicRun(runtime: PanelBasicAgentRouteRuntime, runId: string): BasicAgentRun {
  const run = runtime.runExecutor.get(runId);
  if (run === undefined) {
    throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行。");
  }
  return run;
}

function shouldCloseBasicRunStream(status: BasicAgentRun["status"]): boolean {
  return status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "blocked" ||
    status === "approval_needed" ||
    status === "needs_input";
}

function isTerminalPanelJobStatus(status: PanelRunJob["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "blocked";
}
