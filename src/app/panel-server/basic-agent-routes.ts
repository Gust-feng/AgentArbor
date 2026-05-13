import type { IncomingMessage, ServerResponse } from "node:http";
import type { BasicAgentRun, DesktopWorkSessionReadModel } from "../../domain/basic-agent/index.js";
import type { ToolDisplayProjection } from "../../domain/tools/index.js";
import type { RuntimeDatabase } from "../../domain/runtime-database/index.js";
import {
  basicRunFromRuntimeSnapshot,
  basicRunReplayFromRuntimeSnapshot,
  createDesktopWorkSessionReadModel,
  submitRestoredBasicConfirmationDecision,
  type BasicAgentRunExecutor,
} from "../basic-agent-runtime/index.js";
import type { PanelRunJob } from "../panel-run-jobs.js";
import {
  PanelHttpError,
  parseStreamCursor,
  readJsonBody,
  writeJson,
} from "./http-utils.js";
import { parseConfirmationDecision } from "./request-parsers.js";

export type PanelBasicAgentRouteRuntime = {
  readonly runJobs: {
    get(runId: string): PanelRunJob | undefined;
  };
  readonly runExecutor: BasicAgentRunExecutor;
  readonly runtimeDatabase?: RuntimeDatabase;
};

export async function handlePanelBasicAgentRoute(
  runtime: PanelBasicAgentRouteRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  syncLiveRunEvents: (job: PanelRunJob) => void
): Promise<boolean> {
  const basicWorkSessionMatch = /^\/api\/basic-agent\/runs\/([^/]+)\/work-session$/.exec(url.pathname);
  if (request.method === "GET" && basicWorkSessionMatch !== null) {
    await handleGetBasicWorkSessionRequest(
      runtime,
      decodeURIComponent(basicWorkSessionMatch[1] ?? ""),
      response,
      syncLiveRunEvents
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
      response,
      syncLiveRunEvents
    );
    return true;
  }

  const basicRunMatch = /^\/api\/basic-agent\/runs\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && basicRunMatch !== null) {
    await handleGetBasicRunRequest(
      runtime,
      decodeURIComponent(basicRunMatch[1] ?? ""),
      response,
      syncLiveRunEvents
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

async function handleGetBasicWorkSessionRequest(
  runtime: PanelBasicAgentRouteRuntime,
  runId: string,
  response: ServerResponse,
  syncLiveRunEvents: (job: PanelRunJob) => void
): Promise<void> {
  const job = runtime.runJobs.get(runId);
  if (job !== undefined) {
    syncLiveRunEvents(job);
    const replay = runtime.runExecutor.replayEvents(runId, 0);
    writeJson(response, 200, {
      ok: true,
      workSession: createDesktopWorkSessionReadModel({
        run: requireBasicRun(runtime, runId),
        events: replay?.events ?? [],
        canvas: job.completed?.canvas,
        taskSoilInput: job.taskSoilInput,
        toolDisplays: toolDisplaysFromStreamEvents(job.streamEvents),
      }) satisfies DesktopWorkSessionReadModel,
    });
    return;
  }

  const snapshot = await runtime.runtimeDatabase?.getRun(runId);
  if (snapshot === undefined) {
    throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 工作会话。");
  }
  const replay = basicRunReplayFromRuntimeSnapshot(snapshot);
  writeJson(response, 200, {
    ok: true,
    workSession: createDesktopWorkSessionReadModel({
      run: basicRunFromRuntimeSnapshot(snapshot),
      events: replay.events,
      toolDisplays: snapshot.toolCalls.map((call) => call.display).filter((display): display is ToolDisplayProjection => display !== undefined),
      restoredResult:
        snapshot.run.resultTitle === undefined && snapshot.run.resultSummary === undefined
          ? undefined
          : {
              title: snapshot.run.resultTitle ?? "结果已生成",
              summary: snapshot.run.resultSummary ?? "结果已经整理完成。",
            },
    }) satisfies DesktopWorkSessionReadModel,
  });
}

async function handleGetBasicRunEventsRequest(
  runtime: PanelBasicAgentRouteRuntime,
  runId: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  syncLiveRunEvents: (job: PanelRunJob) => void
): Promise<void> {
  const job = runtime.runJobs.get(runId);
  if (job !== undefined) {
    syncLiveRunEvents(job);
  }
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
  const restored = basicRunReplayFromRuntimeSnapshot(snapshot);
  writeJson(response, 200, {
    ok: true,
    runId,
    cursor: restored.cursor,
    events: restored.events.filter((event) => event.sequence > cursor),
  });
}

async function handleGetBasicRunRequest(
  runtime: PanelBasicAgentRouteRuntime,
  runId: string,
  response: ServerResponse,
  syncLiveRunEvents: (job: PanelRunJob) => void
): Promise<void> {
  const job = runtime.runJobs.get(runId);
  if (job !== undefined) {
    syncLiveRunEvents(job);
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
    run: basicRunFromRuntimeSnapshot(snapshot),
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
    if (error instanceof Error && error.message.includes("not found")) {
      const restored = await submitRestoredBasicConfirmationDecision({
        runtimeDatabase: runtime.runtimeDatabase,
        runId,
        confirmationId,
        decision,
      });
      if (restored !== undefined) {
        return restored;
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

function toolDisplaysFromStreamEvents(events: readonly PanelRunJob["streamEvents"][number][]): readonly ToolDisplayProjection[] {
  const displays: ToolDisplayProjection[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    const display = event.detail?.display;
    if (display === undefined) {
      continue;
    }
    const key = JSON.stringify(display);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    displays.push(display);
  }
  return displays;
}
