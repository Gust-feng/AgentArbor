import type { IncomingMessage, ServerResponse } from "node:http";
import type { BasicAgentRun, DesktopWorkSessionReadModel } from "../../domain/basic-agent/index.js";
import type { ToolDisplayProjection, ToolResultEnvelope } from "../../domain/tools/index.js";
import type { RuntimeConfirmationRecord, RuntimeDatabase } from "../../domain/runtime-database/index.js";
import {
  basicRunFromRuntimeSnapshot,
  basicRunReplayFromRuntimeSnapshot,
  BasicAgentConfirmationDecisionError,
  createDesktopWorkSessionReadModel,
  submitRestoredBasicConfirmationDecision,
  type BasicAgentRunExecutor,
} from "../basic-agent-runtime/index.js";
import type { PanelRunJob } from "../panel-run-jobs.js";
import { createPanelTranscriptNodes } from "../panel-run-read-model.js";
import {
  PanelHttpError,
  parseStreamCursor,
  readJsonBody,
  writeSseEvent,
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

  const basicRunStreamMatch = /^\/api\/basic-agent\/runs\/([^/]+)\/stream$/.exec(url.pathname);
  if (request.method === "GET" && basicRunStreamMatch !== null) {
    await handleGetBasicRunStreamRequest(
      runtime,
      decodeURIComponent(basicRunStreamMatch[1] ?? ""),
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
        toolEvidence: toolEnvelopesFromStreamEvents(job.streamEvents),
        toolDisplays: toolDisplaysFromStreamEvents(job.streamEvents),
        transcriptNodes: createPanelTranscriptNodes(job.streamEvents),
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
      pendingConfirmation: restoredPendingConfirmation(snapshot.confirmations),
      toolEvidence: snapshot.toolCalls.map((call) => call.envelope).filter((envelope): envelope is ToolResultEnvelope => envelope !== undefined),
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

async function handleGetBasicRunStreamRequest(
  runtime: PanelBasicAgentRouteRuntime,
  runId: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  syncLiveRunEvents: (job: PanelRunJob) => void
): Promise<void> {
  let restoredReplay: ReturnType<typeof basicRunReplayFromRuntimeSnapshot> | undefined;
  if (runtime.runJobs.get(runId) === undefined) {
    const snapshot = await runtime.runtimeDatabase?.getRun(runId);
    if (snapshot === undefined) {
      throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行事件。");
    }
    restoredReplay = basicRunReplayFromRuntimeSnapshot(snapshot);
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
    syncLiveRunEvents(job);
    const replay = runtime.runExecutor.replayEvents(runId, lastSequence);
    for (const event of replay?.events ?? []) {
      writeSseEvent(response, event);
      lastSequence = event.sequence;
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
    if (error instanceof BasicAgentConfirmationDecisionError) {
      throw new PanelHttpError(409, error.code, error.message);
    }
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

function restoredPendingConfirmation(confirmations: readonly RuntimeConfirmationRecord[]): DesktopWorkSessionReadModel["pendingConfirmation"] {
  const pending = confirmations.find((confirmation) => confirmation.status === "pending");
  if (pending === undefined) {
    return undefined;
  }
  return {
    confirmationId: pending.confirmationId,
    runId: pending.runId,
    conversationId: pending.conversationId,
    title: pending.title,
    actionSummary: pending.actionSummary,
    affectedResources: pending.affectedResources,
    riskLevel: pending.riskLevel,
    resumeAvailability: "lost_after_restart",
    requestedAt: pending.requestedAt,
    expiresAt: pending.expiresAt,
    sourceRefs: pending.eventRefs,
  };
}

function shouldCloseBasicRunStream(status: BasicAgentRun["status"]): boolean {
  return status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "blocked" ||
    status === "approval_needed" ||
    status === "needs_input";
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

function toolEnvelopesFromStreamEvents(events: readonly PanelRunJob["streamEvents"][number][]): readonly ToolResultEnvelope[] {
  const envelopes: ToolResultEnvelope[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    const envelope = event.detail?.envelope;
    if (envelope === undefined) {
      continue;
    }
    const key = envelope.diagnosticRef ?? JSON.stringify({
      summary: envelope.agentSummary,
      evidenceRefs: envelope.evidenceRefs,
    });
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    envelopes.push(envelope);
  }
  return envelopes;
}
