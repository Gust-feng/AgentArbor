import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createUndergroundAiRuntimeConfig, UndergroundAiConfigurationError, type UndergroundAiMode } from "./intelligence-channel-factory.js";
import { runUndergroundDirectionSession, runUndergroundDirectionSessionWithIntelligence } from "./underground-direction-session.js";
import { createUndergroundDemoSummary, type UndergroundDemoAiInput, type UndergroundDemoSummary } from "./underground-demo-summary.js";
import { ConfigCenter, createLocalConfigCenter } from "./config-center.js";
import { createPanelHtml } from "./panel-assets.js";
import type { RunObservationSnapshot } from "../domain/observation/index.js";
import type { SanitizedModelProviderConfig, UpdateModelProviderConfigInput } from "../domain/config/index.js";
import {
  ROOTLET_CLUSTER_KINDS,
  type CandidatePoolCounts,
  type RootletClusterKind,
} from "../domain/underground/index.js";

export type PanelRunStatus = "pending" | "running" | "completed" | "failed";

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
};

type PanelRunResponse = {
  readonly ok: true;
  readonly status: "completed";
  readonly config: SanitizedModelProviderConfig;
  readonly summary: UndergroundDemoSummary;
  readonly observation: PanelObservationReadModel;
  readonly tracking: PanelRunTrackingReadModel;
};

type PanelObservationReadModel = Pick<
  RunObservationSnapshot,
  "traceId" | "goalId" | "currentPhase" | "currentStage" | "eventCursor" | "events" | "underground" | "handoff" | "aboveground"
>;

type PanelRunTrackingReadModel = {
  readonly run: {
    readonly status: PanelRunStatus;
    readonly phase: RunObservationSnapshot["currentPhase"];
    readonly stage: RunObservationSnapshot["currentStage"];
    readonly eventCount: number;
    readonly lastEventType?: string;
    readonly abovegroundStatus: RunObservationSnapshot["aboveground"]["status"];
  };
  readonly provider: {
    readonly requestedMode: UndergroundAiMode;
    readonly defaultAiMode: SanitizedModelProviderConfig["defaultAiMode"];
    readonly providerKind: SanitizedModelProviderConfig["providerKind"];
    readonly protocolKind: SanitizedModelProviderConfig["protocolKind"];
    readonly baseUrl: string;
    readonly model?: string;
    readonly secretConfigured: boolean;
    readonly status:
      | "network_disabled"
      | "fake_provider"
      | "ready"
      | "missing_model"
      | "missing_secret"
      | "missing_model_and_secret";
  };
  readonly rootletsByKind: Readonly<Record<RootletClusterKind, PanelRootletTrackingReadModel>>;
  readonly modelTotals: {
    readonly requested: number;
    readonly completed: number;
    readonly failed: number;
  };
  readonly candidates: {
    readonly total: CandidatePoolCounts;
    readonly byKind: Readonly<Record<RootletClusterKind, CandidatePoolCounts>>;
  };
  readonly aiCandidates: {
    readonly total: number;
    readonly fallbackTotal: number;
    readonly fallbackUsed: boolean;
  };
  readonly convergence: UndergroundDemoSummary["underground"]["convergence"];
  readonly package: {
    readonly id: string;
    readonly version: number;
    readonly status: string;
    readonly validationPassed: boolean;
    readonly validationErrorCount: number;
    readonly validationWarningCount: number;
  };
};

type PanelRootletTrackingReadModel = {
  readonly kind: RootletClusterKind;
  readonly clusterStatus: string;
  readonly invocationStatus?: string;
  readonly outputCount: number;
  readonly model: {
    readonly status: "not_requested" | "requested" | "completed" | "failed";
    readonly requested: number;
    readonly completed: number;
    readonly failed: number;
  };
  readonly candidates: CandidatePoolCounts;
  readonly aiCandidateCount: number;
  readonly fallbackCount: number;
  readonly aiFallbackUsed: boolean;
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
    };
  }
  const local = createLocalConfigCenter({ configDirectory: options.configDirectory });
  return {
    configCenter: local.configCenter,
    configDirectory: local.configDirectory,
    providerFetch: options.providerFetch,
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
      configDirectory: runtime.configDirectory,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      config: await runtime.configCenter.getModelProviderConfig(),
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
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/underground/run") {
    await handleRunRequest(runtime, request, response);
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
  response: ServerResponse
): Promise<void> {
  const body = await readJsonBody(request);
  const config = await runtime.configCenter.getModelProviderConfig();
  const runInput = parseRunInput(body, config.defaultAiMode);

  try {
    const run = await runUndergroundForPanel(runtime, runInput.goal, runInput.aiMode);
    const currentConfig = await runtime.configCenter.getModelProviderConfig();
    const tracking = createPanelRunTracking({
      config: currentConfig,
      summary: run.summary,
      observation: run.observation,
    });
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      config: currentConfig,
      summary: run.summary,
      observation: run.observation,
      tracking,
    } satisfies PanelRunResponse);
  } catch (error) {
    if (error instanceof UndergroundAiConfigurationError) {
      const message = panelConfigurationErrorMessage(error.issue.code);
      const ai = createConfigurationFailedAiSummary(error.issue.summaryInput, error, message);
      writeJson(response, 400, {
        ok: false,
        status: "failed",
        config,
        error: {
          code: error.issue.code,
          message,
        },
        summary: { ai },
      });
      return;
    }
    if (error instanceof PanelHttpError) {
      writePanelError(response, error, { config });
      return;
    }
    throw error;
  }
}

async function runUndergroundForPanel(
  runtime: PanelRuntime,
  goal: string,
  aiMode: UndergroundAiMode
): Promise<{ summary: UndergroundDemoSummary; observation: PanelObservationReadModel }> {
  if (aiMode === "none") {
    const result = runUndergroundDirectionSession(goal);
    const summary = createUndergroundDemoSummary(result, undefined, { enabled: false, mode: "none" });
    return { summary, observation: toPanelObservation(result.observationSnapshot) };
  }

  const aiConfig =
    aiMode === "fake"
      ? createUndergroundAiRuntimeConfig({ mode: "fake" })
      : createUndergroundAiRuntimeConfig({
          mode: "openai-compatible",
          env: await runtime.configCenter.createUndergroundAiEnvironment(),
          fetch: runtime.providerFetch,
        });

  if (!aiConfig.enabled) {
    throw new Error("Panel AI runtime config unexpectedly disabled for an enabled AI mode.");
  }

  const result = await runUndergroundDirectionSessionWithIntelligence(goal, {
    createIntelligenceChannel: aiConfig.createIntelligenceChannel,
  });
  const summary = createUndergroundDemoSummary(result, undefined, aiConfig.summaryInput);
  return { summary, observation: toPanelObservation(result.observationSnapshot) };
}

function toPanelObservation(snapshot: RunObservationSnapshot): PanelObservationReadModel {
  return {
    traceId: snapshot.traceId,
    goalId: snapshot.goalId,
    currentPhase: snapshot.currentPhase,
    currentStage: snapshot.currentStage,
    eventCursor: snapshot.eventCursor,
    events: snapshot.events,
    underground: snapshot.underground,
    handoff: snapshot.handoff,
    aboveground: snapshot.aboveground,
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

function createPanelRunTracking(input: {
  readonly config: SanitizedModelProviderConfig;
  readonly summary: UndergroundDemoSummary;
  readonly observation: PanelObservationReadModel;
}): PanelRunTrackingReadModel {
  const rootletAiByKind = new Map(input.summary.ai.rootletKinds.map((item) => [item.kind, item]));
  const clusterByKind = new Map(input.observation.underground.rootletClusters.map((cluster) => [cluster.kind, cluster]));
  const rootletsByKind = ROOTLET_CLUSTER_KINDS.reduce((result, kind) => {
    const ai = rootletAiByKind.get(kind);
    const cluster = clusterByKind.get(kind);
    result[kind] = {
      kind,
      clusterStatus: cluster?.status ?? "skipped",
      invocationStatus: cluster?.invocationStatus,
      outputCount: cluster?.outputRefs.length ?? 0,
      model: {
        status: ai?.status ?? "not_requested",
        requested: ai?.requested ?? 0,
        completed: ai?.completed ?? 0,
        failed: ai?.failed ?? 0,
      },
      candidates: countCandidateViews(input.observation.underground.candidatePool.candidatesByKind[kind]),
      aiCandidateCount: ai?.aiCandidateCount ?? 0,
      fallbackCount: ai?.fallbackCount ?? 0,
      aiFallbackUsed: ai?.aiFallbackUsed ?? false,
    };
    return result;
  }, {} as Record<RootletClusterKind, PanelRootletTrackingReadModel>);

  return {
    run: {
      status: "completed",
      phase: input.observation.currentPhase,
      stage: input.observation.currentStage,
      eventCount: input.observation.eventCursor.eventCount,
      lastEventType: input.observation.eventCursor.lastEventType,
      abovegroundStatus: input.observation.aboveground.status,
    },
    provider: {
      requestedMode: input.summary.ai.mode,
      defaultAiMode: input.config.defaultAiMode,
      providerKind: input.config.providerKind,
      protocolKind: input.config.protocolKind,
      baseUrl: input.config.baseUrl,
      model: input.config.model,
      secretConfigured: input.config.secretConfigured,
      status: providerStatus(input.config, input.summary.ai.mode),
    },
    rootletsByKind,
    modelTotals: input.summary.ai.eventCounts,
    candidates: {
      total: input.summary.underground.candidateCounts,
      byKind: ROOTLET_CLUSTER_KINDS.reduce((result, kind) => {
        result[kind] = rootletsByKind[kind].candidates;
        return result;
      }, {} as Record<RootletClusterKind, CandidatePoolCounts>),
    },
    aiCandidates: {
      total: input.summary.ai.aiCandidateCount,
      fallbackTotal: input.summary.ai.fallbackCount,
      fallbackUsed: input.summary.ai.aiFallbackUsed,
    },
    convergence: input.summary.underground.convergence,
    package: {
      id: input.summary.directionPackage.id,
      version: input.summary.directionPackage.version,
      status: input.summary.directionPackage.status,
      validationPassed: input.summary.directionPackage.validation.passed,
      validationErrorCount: input.summary.directionPackage.validation.errors.length,
      validationWarningCount: input.summary.directionPackage.validation.warnings.length,
    },
  };
}

function countCandidateViews(
  candidates: PanelObservationReadModel["underground"]["candidatePool"]["candidates"]
): CandidatePoolCounts {
  const counts: CandidatePoolCounts = {
    total: candidates.length,
    candidate: 0,
    accepted: 0,
    merged: 0,
    rejected: 0,
    unknown: 0,
  };
  for (const candidate of candidates) {
    if (
      candidate.status === "candidate" ||
      candidate.status === "accepted" ||
      candidate.status === "merged" ||
      candidate.status === "rejected" ||
      candidate.status === "unknown"
    ) {
      counts[candidate.status] += 1;
    }
  }
  return counts;
}

function providerStatus(
  config: SanitizedModelProviderConfig,
  requestedMode: UndergroundAiMode
): PanelRunTrackingReadModel["provider"]["status"] {
  if (requestedMode === "none") {
    return "network_disabled";
  }
  if (requestedMode === "fake") {
    return "fake_provider";
  }
  const missingModel = config.model === undefined;
  const missingSecret = !config.secretConfigured;
  if (missingModel && missingSecret) {
    return "missing_model_and_secret";
  }
  if (missingModel) {
    return "missing_model";
  }
  if (missingSecret) {
    return "missing_secret";
  }
  return "ready";
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

function parseAiMode(value: unknown): UndergroundAiMode | undefined {
  if (value === "none" || value === "fake" || value === "openai-compatible") {
    return value;
  }
  return undefined;
}

function panelConfigurationErrorMessage(code: UndergroundAiConfigurationError["issue"]["code"]): string {
  if (code === "missing_api_key") {
    return "OpenAI-compatible 模式缺少 API key，已在发起网络请求前停止。";
  }
  return "OpenAI-compatible 模式缺少模型名，已在发起网络请求前停止。";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isPanelRuntime(value: PanelServerOptions | PanelRuntime): value is PanelRuntime {
  return value.configCenter instanceof ConfigCenter;
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
