import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createConfiguredToolCenterFactory,
  createUndergroundAiRuntimeConfig,
  createUndergroundAiDisabledConfigurationError,
  UndergroundAiConfigurationError,
  type UndergroundAiMode,
} from "./intelligence-channel-factory.js";
import { runMinimalLoop } from "./minimal-loop.js";
import {
  runUndergroundDirectionSessionWithIntelligence,
  type UndergroundDirectionSessionRuntimeContext,
} from "./underground-direction-session.js";
import { createUndergroundDemoSummary, type UndergroundDemoAiInput, type UndergroundDemoSummary } from "./underground-demo-summary.js";
import { ConfigCenter, createLocalConfigCenter } from "./config-center.js";
import { createPanelHtml } from "./panel-assets.js";
import type {
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
  SanitizedWebSearchConfig,
  UpdateInformationAccessConfigInput,
  UpdateModelProviderConfigInput,
  UpdateWebSearchConfigInput,
} from "../domain/config/index.js";
import type { ModelOutputDelta } from "../domain/intelligence/index.js";
import {
  createPanelRunTrace,
  createPanelRunStreamEvents,
  createPanelRunTracking,
  createPanelRunTranscript,
  toPanelObservation,
  type PanelObservationReadModel,
  type PanelRunStreamCursor,
  type PanelRunStreamEvent,
  type PanelRunStatus,
  type PanelRunTraceReadModel,
  type PanelRunTrackingReadModel,
  type PanelRunTranscript,
} from "./panel-run-read-model.js";
import { createPanelRunCanvas, type PanelRunCanvasReadModel } from "./panel-canvas-read-model.js";
import { PanelRunJobStore, type PanelRunJob, type PanelRunKind } from "./panel-run-jobs.js";
import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";

export type PanelServerOptions = {
  readonly host?: string;
  readonly port?: number;
  readonly configDirectory?: string;
  readonly configCenter?: ConfigCenter;
  readonly providerFetch?: PanelProviderFetch;
};

export type PanelProviderFetch = (
  url: string,
  init: {
    readonly method: "POST";
    readonly headers: Record<string, string>;
    readonly body: string;
  }
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
  readonly text?: () => Promise<string>;
}>;

export type StartedPanelServer = {
  readonly url: string;
  readonly configDirectory?: string;
  close(): Promise<void>;
};

type PanelRuntime = {
  readonly configCenter: ConfigCenter;
  readonly configDirectory?: string;
  readonly providerFetch?: PanelProviderFetch;
  readonly runJobs: PanelRunJobStore;
};

type PanelRunResponse = {
  readonly ok: true;
  readonly runKind: PanelRunKind;
  readonly status: "completed";
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly summary?: UndergroundDemoSummary;
  readonly observation: PanelObservationReadModel;
  readonly tracking: PanelRunTrackingReadModel;
  readonly trace: PanelRunTraceReadModel;
  readonly transcript: PanelRunTranscript;
  readonly workNotes: PanelRunTranscript["workNotes"];
  readonly streamCursor: PanelRunStreamCursor;
  readonly canvas?: PanelRunCanvasReadModel;
};

type PanelRunExecutionResult = {
  readonly summary?: UndergroundDemoSummary;
  readonly observation: PanelObservationReadModel;
  readonly eventEntries: readonly EventLogEntry[];
  readonly canvas?: PanelRunCanvasReadModel;
};

type PanelToolsConfig = {
  readonly webSearch: SanitizedWebSearchConfig;
};

class PanelHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "PanelHttpError";
  }
}

export async function startLocalPanelServer(options: PanelServerOptions = {}): Promise<StartedPanelServer> {
  const runtime = createPanelRuntime(options);
  const server = createServer(createPanelRequestHandler(runtime));
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 9090;

  await listen(server, port, host);
  const address = server.address() as AddressInfo;
  return {
    url: `http://${host}:${address.port}/`,
    configDirectory: runtime.configDirectory,
    close: () => close(server),
  };
}

export function createPanelRequestHandler(options: PanelServerOptions | PanelRuntime = {}): (request: IncomingMessage, response: ServerResponse) => void {
  const runtime = isPanelRuntime(options) ? options : createPanelRuntime(options);

  return (request, response) => {
    handlePanelRequest(runtime, request, response).catch((error) => {
      if (error instanceof PanelHttpError) {
        writePanelError(response, error);
        return;
      }
      writePanelError(response, new PanelHttpError(500, "panel_internal_error", "面板请求失败。"));
    });
  };
}

function createPanelRuntime(options: PanelServerOptions): PanelRuntime {
  if (options.configCenter !== undefined) {
    return {
      configCenter: options.configCenter,
      configDirectory: options.configDirectory,
      providerFetch: options.providerFetch,
      runJobs: new PanelRunJobStore(),
    };
  }
  const local = createLocalConfigCenter({ configDirectory: options.configDirectory });
  return {
    configCenter: local.configCenter,
    configDirectory: local.configDirectory,
    providerFetch: options.providerFetch,
    runJobs: new PanelRunJobStore(),
  };
}

async function handlePanelRequest(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/") {
    writeHtml(response, createPanelHtml());
    return;
  }

  if (request.method === "GET" && url.pathname === "/favicon.ico") {
    response.writeHead(204, { "cache-control": "no-store" });
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      config: await runtime.configCenter.getModelProviderConfig(),
      informationAccess: await runtime.configCenter.getInformationAccessConfig(),
      configDirectory: runtime.configDirectory,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      config: await runtime.configCenter.getModelProviderConfig(),
      informationAccess: await runtime.configCenter.getInformationAccessConfig(),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/config/tools") {
    const tools: PanelToolsConfig = {
      webSearch: await runtime.configCenter.getWebSearchConfig(),
    };
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      tools,
      informationAccess: await runtime.configCenter.getInformationAccessConfig(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/config/model-provider") {
    const body = await readJsonBody(request);
    const config = await runtime.configCenter.updateModelProviderConfig(parseConfigUpdate(body));
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      config,
      informationAccess: await runtime.configCenter.getInformationAccessConfig(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/config/information-sources") {
    const body = await readJsonBody(request);
    const informationAccess = await runtime.configCenter.updateInformationAccessConfig(parseInformationAccessUpdate(body));
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      informationAccess,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/config/tools/web-search") {
    const body = await readJsonBody(request);
    const webSearch = await runtime.configCenter.updateWebSearchConfig(parseWebSearchUpdate(body));
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      tools: { webSearch },
      informationAccess: await runtime.configCenter.getInformationAccessConfig(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/underground/run") {
    await handleRunRequest(runtime, request, response, "underground");
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/underground/runs") {
    await handleStartRunRequest(runtime, request, response, "underground");
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/desktop/runs") {
    await handleStartRunRequest(runtime, request, response, "desktop");
    return;
  }

  const runMatch = /^\/api\/underground\/runs\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && runMatch !== null) {
    handleGetRunRequest(runtime, decodeURIComponent(runMatch[1] ?? ""), "underground", response);
    return;
  }

  const desktopRunMatch = /^\/api\/desktop\/runs\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && desktopRunMatch !== null) {
    handleGetRunRequest(runtime, decodeURIComponent(desktopRunMatch[1] ?? ""), "desktop", response);
    return;
  }

  const runStreamMatch = /^\/api\/underground\/runs\/([^/]+)\/stream$/.exec(url.pathname);
  if (request.method === "GET" && runStreamMatch !== null) {
    handleGetRunStreamRequest(runtime, decodeURIComponent(runStreamMatch[1] ?? ""), "underground", url, request, response);
    return;
  }

  const desktopRunStreamMatch = /^\/api\/desktop\/runs\/([^/]+)\/stream$/.exec(url.pathname);
  if (request.method === "GET" && desktopRunStreamMatch !== null) {
    handleGetRunStreamRequest(runtime, decodeURIComponent(desktopRunStreamMatch[1] ?? ""), "desktop", url, request, response);
    return;
  }

  writeJson(response, 404, {
    ok: false,
    status: "failed",
    error: {
      code: "not_found",
      message: "未找到面板路由。",
    },
  });
}

async function handleRunRequest(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  runKind: PanelRunKind
): Promise<void> {
  const body = await readJsonBody(request);
  const config = await runtime.configCenter.getModelProviderConfig();
  const informationAccess = await runtime.configCenter.getInformationAccessConfig();
  const runInput = parseRunInput(body, runKind === "desktop" ? "fake" : config.defaultAiMode);

  try {
    const run = await runForPanel(runtime, runKind, runInput.goal, runInput.aiMode);
    const currentConfig = await runtime.configCenter.getModelProviderConfig();
    const currentInformationAccess = await runtime.configCenter.getInformationAccessConfig();
    const trace = createPanelRunTrace({ status: "completed", eventEntries: run.eventEntries });
    const tracking = createPanelRunTracking({
      status: "completed",
      config: currentConfig,
      informationAccess: currentInformationAccess,
      requestedMode: runInput.aiMode,
      summary: run.summary,
      observation: run.observation,
      eventEntries: run.eventEntries,
    });
    const transcript = createPanelRunTranscript({
      runId: run.observation.traceId,
      status: "completed",
      eventEntries: run.eventEntries,
      summary: run.summary,
      observation: run.observation,
      createdAt: run.eventEntries[0]?.recordedAt ?? new Date(0).toISOString(),
      updatedAt: run.eventEntries.at(-1)?.recordedAt ?? new Date(0).toISOString(),
    });
    writeJson(response, 200, {
      ok: true,
      runKind,
      status: "completed",
      config: currentConfig,
      informationAccess: currentInformationAccess,
      summary: run.summary,
      observation: run.observation,
      tracking,
      trace,
      transcript,
      workNotes: transcript.workNotes,
      streamCursor: {
        runId: run.observation.traceId,
        lastSequence: transcript.events.at(-1)?.sequence ?? 0,
      },
      canvas: run.canvas,
    } satisfies PanelRunResponse);
  } catch (error) {
    if (error instanceof UndergroundAiConfigurationError) {
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
  const config = await runtime.configCenter.getModelProviderConfig();
  const informationAccess = await runtime.configCenter.getInformationAccessConfig();
  const runInput = parseRunInput(body, runKind === "desktop" ? "fake" : config.defaultAiMode);
  const job = runtime.runJobs.create({
    runKind,
    goal: runInput.goal,
    aiMode: runInput.aiMode,
    config,
    informationAccess,
  });

  writeJson(response, 202, createPanelRunJobResponse(job));
  schedulePanelRunJob(runtime, job.runId);
}

function handleGetRunRequest(
  runtime: PanelRuntime,
  runId: string,
  expectedRunKind: PanelRunKind,
  response: ServerResponse
): void {
  const job = runtime.runJobs.get(runId);
  if (job === undefined || job.runKind !== expectedRunKind) {
    throw new PanelHttpError(404, "run_not_found", runNotFoundMessage(expectedRunKind));
  }
  writeJson(response, 200, createPanelRunJobResponse(job));
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
    throw new PanelHttpError(404, "run_not_found", runNotFoundMessage(expectedRunKind));
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
    const events = syncPanelRunStreamEventsForJob(current);
    for (const event of events) {
      if (event.sequence <= lastSequence) {
        continue;
      }
      writeSseEvent(response, event);
      lastSequence = event.sequence;
    }
    if (current.status === "completed" || current.status === "failed") {
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

async function executePanelRunJob(runtime: PanelRuntime, runId: string): Promise<void> {
  const job = runtime.runJobs.get(runId);
  if (job === undefined) {
    return;
  }
  runtime.runJobs.markRunning(runId);
  try {
    const run = await runForPanel(runtime, job.runKind, job.goal, job.aiMode, {
      onRuntimeReady: (context) => {
        runtime.runJobs.attachRuntime({
          runId,
          runtime: context.runtime,
          traceId: context.traceId,
          goalId: context.goalId,
        });
      },
      onModelOutputDelta: (delta) => {
        appendLiveModelOutputDelta(runtime, runId, delta);
      },
    });
    const currentConfig = await runtime.configCenter.getModelProviderConfig();
    const currentInformationAccess = await runtime.configCenter.getInformationAccessConfig();
    runtime.runJobs.complete(runId, {
      config: currentConfig,
      informationAccess: currentInformationAccess,
      summary: run.summary,
      observation: run.observation,
      canvas: run.canvas,
    });
  } catch (error) {
    const config = await runtime.configCenter.getModelProviderConfig().catch(() => job.config);
    const informationAccess = await runtime.configCenter.getInformationAccessConfig().catch(() => job.informationAccess);
    if (error instanceof UndergroundAiConfigurationError) {
      const message = panelConfigurationErrorMessage(error.issue.code);
      runtime.runJobs.fail(runId, {
        config,
        informationAccess,
        error: {
          code: error.issue.code,
          message,
        },
        summary: {
          ai: createConfigurationFailedAiSummary(error.issue.summaryInput, error, message),
        },
      });
      return;
    }
    if (error instanceof PanelHttpError) {
      runtime.runJobs.fail(runId, {
        config,
        informationAccess,
        error: {
          code: error.code,
          message: error.message,
        },
      });
      return;
    }
    runtime.runJobs.fail(runId, {
      config,
      informationAccess,
      error: {
        code: "panel_internal_error",
        message: job.runKind === "desktop" ? "Desktop Shell 运行 job 失败。" : "地下兼容运行 job 失败。",
      },
    });
  }
}

function schedulePanelRunJob(runtime: PanelRuntime, runId: string): void {
  setImmediate(() => {
    void executePanelRunJob(runtime, runId);
  });
}

function createPanelRunJobResponse(job: PanelRunJob): {
  readonly ok: true;
  readonly runId: string;
  readonly runKind: PanelRunKind;
  readonly status: PanelRunStatus;
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly trace: PanelRunTraceReadModel;
  readonly tracking: PanelRunTrackingReadModel;
  readonly transcript: PanelRunTranscript;
  readonly workNotes: PanelRunTranscript["workNotes"];
  readonly streamCursor: PanelRunStreamCursor;
  readonly summary?: UndergroundDemoSummary | { readonly ai: UndergroundDemoSummary["ai"] };
  readonly observation?: PanelObservationReadModel;
  readonly canvas?: PanelRunCanvasReadModel;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
} {
  const eventEntries = job.runtime?.eventLog.list() ?? [];
  const config = job.completed?.config ?? job.failed?.config ?? job.config;
  const informationAccess = job.completed?.informationAccess ?? job.failed?.informationAccess ?? job.informationAccess;
  const summary = job.completed?.summary;
  const observation = job.completed?.observation;
  const trace = createPanelRunTrace({ status: job.status, eventEntries });
  const tracking = createPanelRunTracking({
    status: job.status,
    config,
    informationAccess,
    requestedMode: job.aiMode,
    summary,
    observation,
    eventEntries,
  });
  const streamEvents = syncPanelRunStreamEventsForJob(job);
  const transcript = {
    ...createPanelRunTranscript({
      runId: job.runId,
      status: job.status,
      eventEntries,
      summary,
      observation,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }),
    events: streamEvents,
  };

  return {
    ok: true,
    runId: job.runId,
    runKind: job.runKind,
    status: job.status,
    config,
    informationAccess,
    trace,
    tracking,
    transcript,
    workNotes: transcript.workNotes,
    streamCursor: {
      runId: job.runId,
      lastSequence: transcript.events.at(-1)?.sequence ?? 0,
    },
    summary: job.completed?.summary ?? job.failed?.summary,
    observation: job.completed?.observation,
    canvas: job.completed?.canvas,
    error: job.failed?.error,
  };
}

function syncPanelRunStreamEventsForJob(job: PanelRunJob): readonly PanelRunStreamEvent[] {
  const derived = createPanelRunStreamEvents({
    runId: job.runId,
    status: job.status,
    eventEntries: job.runtime?.eventLog.list() ?? [],
    summary: job.completed?.summary ?? job.failed?.summary,
    observation: job.completed?.observation,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.failed?.error,
  });
  for (const event of derived) {
    appendPanelRunStreamEvent(job, event);
  }
  return [...job.streamEvents].sort((left, right) => left.sequence - right.sequence);
}

function appendPanelRunStreamEvent(job: PanelRunJob, event: Omit<PanelRunStreamEvent, "sequence"> | PanelRunStreamEvent): PanelRunStreamEvent {
  const existing = job.streamEventIds.has(event.eventId)
    ? job.streamEvents.find((item) => item.eventId === event.eventId)
    : undefined;
  if (existing !== undefined) {
    return existing;
  }
  if (event.type === "model.output.delta") {
    const liveDelta = liveModelDeltaForSameCall(job, event);
    if (liveDelta !== undefined) {
      return liveDelta;
    }
  }
  const next: PanelRunStreamEvent = {
    ...event,
    sequence: job.nextStreamSequence,
  };
  job.nextStreamSequence += 1;
  job.streamEvents.push(next);
  job.streamEventIds.add(next.eventId);
  return next;
}

function liveModelDeltaForSameCall(
  job: PanelRunJob,
  event: Omit<PanelRunStreamEvent, "sequence"> | PanelRunStreamEvent
): PanelRunStreamEvent | undefined {
  const requestIds = new Set(event.modelCallRefs);
  if (requestIds.size === 0) {
    return undefined;
  }
  return job.streamEvents.find(
    (item) =>
      item.type === "model.output.delta" &&
      item.eventId.startsWith(`${job.runId}:live:model.output.delta:`) &&
      item.modelCallRefs.some((requestId) => requestIds.has(requestId))
  );
}

function appendLiveModelOutputDelta(runtime: PanelRuntime, runId: string, delta: ModelOutputDelta): void {
  if (delta.delta.length === 0) {
    return;
  }
  runtime.runJobs.appendStreamEvent(runId, {
    eventId: `${runId}:live:model.output.delta:${delta.requestId}:${delta.index}`,
    runId,
    type: "model.output.delta",
    createdAt: delta.createdAt,
    agentLabel: "模型",
    delta: delta.delta,
    status: "running",
    sourceRefs: [],
    modelCallRefs: [delta.requestId],
    toolCallRefs: [],
  });
}

async function runForPanel(
  runtime: PanelRuntime,
  runKind: PanelRunKind,
  goal: string,
  aiMode: UndergroundAiMode,
  options: {
    readonly onRuntimeReady?: (context: UndergroundDirectionSessionRuntimeContext) => void;
    readonly onModelOutputDelta?: (delta: ModelOutputDelta) => void;
  } = {}
): Promise<PanelRunExecutionResult> {
  return runKind === "desktop"
    ? runDesktopForPanel(runtime, goal, aiMode, options)
    : runUndergroundForPanel(runtime, goal, aiMode, options);
}

async function runDesktopForPanel(
  runtime: PanelRuntime,
  goal: string,
  aiMode: UndergroundAiMode,
  options: {
    readonly onRuntimeReady?: (context: UndergroundDirectionSessionRuntimeContext) => void;
    readonly onModelOutputDelta?: (delta: ModelOutputDelta) => void;
  } = {}
): Promise<PanelRunExecutionResult> {
  if (aiMode === "none") {
    throw createUndergroundAiDisabledConfigurationError();
  }

  const aiEnvironment = await runtime.configCenter.createUndergroundAiEnvironment();
  const createToolCenter = await createConfiguredToolCenterFactory(runtime.configCenter, {
    fetch: runtime.providerFetch,
  });
  const result = await runMinimalLoop(goal, {
    aiMode,
    aiEnvironment,
    providerFetch: runtime.providerFetch,
    createToolCenter,
    onRuntimeReady: options.onRuntimeReady,
    onModelOutputDelta: options.onModelOutputDelta,
  });
  const observation = toPanelObservation(result.observationSnapshot);
  const eventEntries = result.runtime.eventLog.list();
  const config = await runtime.configCenter.getModelProviderConfig();
  const informationAccess = await runtime.configCenter.getInformationAccessConfig();
  const tracking = createPanelRunTracking({
    status: "completed",
    config,
    informationAccess,
    requestedMode: aiMode,
    observation,
    eventEntries,
  });
  const transcript = createPanelRunTranscript({
    runId: result.observationSnapshot.traceId,
    status: "completed",
    eventEntries,
    observation,
    createdAt: eventEntries[0]?.recordedAt ?? new Date(0).toISOString(),
    updatedAt: eventEntries.at(-1)?.recordedAt ?? new Date(0).toISOString(),
  });

  return {
    observation,
    eventEntries,
    canvas: createPanelRunCanvas({
      result,
      observation,
      tracking,
      transcript,
    }),
  };
}

async function runUndergroundForPanel(
  runtime: PanelRuntime,
  goal: string,
  aiMode: UndergroundAiMode,
  options: {
    readonly onRuntimeReady?: (context: UndergroundDirectionSessionRuntimeContext) => void;
    readonly onModelOutputDelta?: (delta: ModelOutputDelta) => void;
  } = {}
): Promise<PanelRunExecutionResult> {
  if (aiMode === "none") {
    throw createUndergroundAiDisabledConfigurationError();
  }

  const aiEnvironment = await runtime.configCenter.createUndergroundAiEnvironment();
  const aiConfig =
    aiMode === "fake"
      ? createUndergroundAiRuntimeConfig({ mode: "fake", env: aiEnvironment, onModelOutputDelta: options.onModelOutputDelta })
      : createUndergroundAiRuntimeConfig({
          mode: "openai-compatible",
          env: aiEnvironment,
          fetch: runtime.providerFetch,
          onModelOutputDelta: options.onModelOutputDelta,
        });

  if (!aiConfig.enabled) {
    throw createUndergroundAiDisabledConfigurationError(aiConfig.summaryInput);
  }

  const createToolCenter = await createConfiguredToolCenterFactory(runtime.configCenter, {
    fetch: runtime.providerFetch,
  });
  const result = await runUndergroundDirectionSessionWithIntelligence(goal, {
    createIntelligenceChannel: aiConfig.createIntelligenceChannel,
    createToolCenter,
    onRuntimeReady: options.onRuntimeReady,
  });
  const summary = createUndergroundDemoSummary(result, undefined, aiConfig.summaryInput);
  return {
    summary,
    observation: toPanelObservation(result.observationSnapshot),
    eventEntries: result.runtime.eventLog.list(),
  };
}

function createConfigurationFailedAiSummary(
  input: UndergroundDemoAiInput,
  error: UndergroundAiConfigurationError,
  message: string
): UndergroundDemoSummary["ai"] {
  return {
    ...input,
    status: "configuration_failed",
    eventCounts: { requested: 0, completed: 0, failed: 0 },
    aiCandidateCount: 0,
    fallbackCount: 0,
    aiFallbackUsed: false,
    rootletKinds: [],
    modelCallRefs: [],
    configurationError: {
      code: error.issue.code,
      message,
    },
  };
}

function parseConfigUpdate(raw: unknown): UpdateModelProviderConfigInput {
  const record = asRecord(raw);
  return {
    baseUrl: optionalString(record.baseUrl),
    model: optionalString(record.model),
    defaultAiMode: parseOptionalAiMode(record.defaultAiMode, "默认 AI 模式无效。"),
    apiKey: optionalString(record.apiKey),
  };
}

function parseInformationAccessUpdate(raw: unknown): UpdateInformationAccessConfigInput {
  const record = asRecord(raw);
  return {
    tavilyApiKey: optionalString(record.tavilyApiKey),
    tavilyMaxResults: numberOrUndefined(record.tavilyMaxResults),
    sourcePreference: informationSourcePreferenceOrUndefined(record.sourcePreference),
  };
}

function parseWebSearchUpdate(raw: unknown): UpdateWebSearchConfigInput {
  const record = asRecord(raw);
  return {
    provider: parseOptionalWebSearchProvider(record.provider),
    apiKey: optionalString(record.apiKey),
    tavilyApiKey: optionalString(record.tavilyApiKey),
    maxResults: numberOrUndefined(record.maxResults),
    tavilyMaxResults: numberOrUndefined(record.tavilyMaxResults),
  };
}

function parseOptionalWebSearchProvider(value: unknown): UpdateWebSearchConfigInput["provider"] {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "tavily" || value === "none") {
    return value;
  }
  throw new PanelHttpError(400, "invalid_web_search_provider", "搜索工具 provider 无效。");
}

function informationSourcePreferenceOrUndefined(
  value: unknown
): UpdateInformationAccessConfigInput["sourcePreference"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const sources = value.filter(isInformationSourceKind);
  return sources.length === 0 ? undefined : [...new Set(sources)];
}

function parseRunInput(raw: unknown, defaultAiMode: UndergroundAiMode): { goal: string; aiMode: UndergroundAiMode } {
  const record = asRecord(raw);
  const goal = optionalString(record.goal);
  if (goal === undefined) {
    throw new PanelHttpError(400, "missing_goal", "运行需要填写目标。");
  }
  return {
    goal,
    aiMode: parseOptionalAiMode(record.aiMode, "AI 模式无效。") ?? defaultAiMode,
  };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of request) {
    raw += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (raw.length > 128_000) {
      throw new PanelHttpError(413, "request_body_too_large", "面板请求体过大。");
    }
  }
  if (raw.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new PanelHttpError(400, "invalid_json", "请求 JSON 格式无效。");
  }
}

function writeHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'",
  });
  response.end(html);
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function writeSseEvent(response: ServerResponse, event: PanelRunStreamEvent): void {
  response.write(`id: ${event.sequence}\n`);
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function writePanelError(response: ServerResponse, error: PanelHttpError, extra?: Record<string, unknown>): void {
  writeJson(response, error.statusCode, {
    ok: false,
    status: "failed",
    ...extra,
    error: {
      code: error.code,
      message: error.message,
    },
  });
}

function parseOptionalAiMode(value: unknown, invalidMessage: string): UndergroundAiMode | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = parseAiMode(value);
  if (parsed === undefined) {
    throw new PanelHttpError(400, "invalid_ai_mode", invalidMessage);
  }
  return parsed;
}

function parseStreamCursor(queryValue: string | null, lastEventId: string | string[] | undefined): number {
  const raw = queryValue ?? (Array.isArray(lastEventId) ? lastEventId[0] : lastEventId);
  const parsed = raw === undefined ? 0 : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function parseAiMode(value: unknown): UndergroundAiMode | undefined {
  if (value === "none" || value === "fake" || value === "openai-compatible") {
    return value;
  }
  return undefined;
}

function panelConfigurationErrorMessage(code: UndergroundAiConfigurationError["issue"]["code"]): string {
  if (code === "ai_disabled") {
    return "Underground Cognitive Runtime 方向智能阶段需要 AI；AI 禁用模式只作为边界检查，未启动运行。";
  }
  if (code === "missing_api_key") {
    return "OpenAI-compatible 模式缺少 API key，已在发起网络请求前停止。";
  }
  return "OpenAI-compatible 模式缺少模型名，已在发起网络请求前停止。";
}

function runNotFoundMessage(runKind: PanelRunKind): string {
  return runKind === "desktop" ? "未找到 Desktop Shell 运行 job。" : "未找到地下兼容运行 job。";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isInformationSourceKind(
  value: unknown
): value is NonNullable<UpdateInformationAccessConfigInput["sourcePreference"]>[number] {
  return (
    value === "web" ||
    value === "page" ||
    value === "codebase" ||
    value === "soil" ||
    value === "run_memory" ||
    value === "docs" ||
    value === "packages" ||
    value === "github"
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isPanelRuntime(value: PanelServerOptions | PanelRuntime): value is PanelRuntime {
  return (
    value.configCenter instanceof ConfigCenter &&
    "runJobs" in value &&
    value.runJobs instanceof PanelRunJobStore
  );
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
