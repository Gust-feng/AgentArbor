import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  PANEL_BRAND_LEGACY_ICON_PATHNAME,
  PANEL_BRAND_LOGO_PATHNAME,
  createPanelHtml,
  readPanelBrandIconAsset,
  readPanelBrandLogoAsset,
  readPanelStaticAsset,
} from "./panel-assets.js";
import {
  PanelHttpError,
  readJsonBody,
  writeHtml,
  writeJson,
  writePanelError,
} from "./http-utils.js";
import { handlePanelBasicAgentRoute } from "./basic-agent-routes.js";
import { handlePanelConfigRoute } from "./config-routes.js";
import { handlePanelContextRoute } from "./context-routes.js";
import {
  handlePanelConversationRoute,
  scheduleNextQueuedConversationRun,
} from "./conversation-routes.js";
import type { PanelModelCatalogFetch, PanelProviderFetch, PanelServerOptions, StartedPanelServer } from "./types.js";
import { asRecord } from "./request-parsers.js";
import { waitForPanelPersistenceIdle as waitForPanelPersistenceChainsIdle } from "./persistence.js";
import {
  cleanupPanelRuntimeOwnedBackgroundProcesses,
  createPanelRuntime,
  isPanelRuntime,
  type PanelRuntime,
  type PanelRuntimeHooks,
} from "./runtime.js";
import {
  executeBasicPanelRun,
  failPanelRunJob,
} from "./run-execution.js";
import { handlePanelRunRoute } from "./run-routes.js";
import { handlePanelDeepRoute } from "./deep-routes.js";
import { listPanelSkillSettings, refreshPanelSkillSettings, setPanelSkillEnabled } from "./skill-service.js";
import { handlePanelAppUpdateRoute } from "./app-update-routes.js";
import { OrdinaryRuntimeSnapshotContractError } from "../basic-agent-runtime/persistence-snapshot-contract.js";
import { BasicAgentRunAdmissionClosedError } from "../basic-agent-runtime/run-executor.js";
import { RuntimeSnapshotIncompatibleError } from "../../domain/runtime-database/index.js";
export type { PanelModelCatalogFetch, PanelProviderFetch, PanelServerOptions, StartedPanelServer } from "./types.js";

const PANEL_REQUEST_DRAIN_TIMEOUT_MS = 1_000;
const PANEL_RUNTIME_SHUTDOWN_TIMEOUT_MS = 30_000;

export type PanelServerCloseOptions = {
  /** Host-level graceful cleanup deadline; production callers use 30 seconds. */
  readonly runtimeCleanupTimeoutMs?: number;
};

export class PanelShutdownTimeoutError extends Error {
  readonly code = "panel_shutdown_timeout";

  constructor(readonly timeoutMs: number) {
    super(`Panel runtime cleanup did not finish within ${timeoutMs} ms.`);
    this.name = "PanelShutdownTimeoutError";
  }
}

export async function startLocalPanelServer(options: PanelServerOptions = {}): Promise<StartedPanelServer> {
  const runtime = createPanelRuntime(options, createPanelRuntimeHooks());
  const server = createServer(createPanelRequestHandler(runtime));
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 9090;

  await listen(server, port, host);
  const address = server.address() as AddressInfo;
  return {
    url: `http://${host}:${address.port}/`,
    configDirectory: runtime.configDirectory,
    runtimeDirectory: runtime.runtimePaths?.runtimeHome,
    close: () => closePanelServer(server, runtime),
  };
}

export function createPanelRequestHandler(options: PanelServerOptions | PanelRuntime = {}): (request: IncomingMessage, response: ServerResponse) => void {
  const runtime = isPanelRuntime(options) ? options : createPanelRuntime(options, createPanelRuntimeHooks());

  return (request, response) => {
    let requestJob: Promise<void>;
    requestJob = handlePanelRequest(runtime, request, response).catch((error) => {
      if (error instanceof PanelHttpError) {
        writePanelError(response, error);
        return;
      }
      if (error instanceof BasicAgentRunAdmissionClosedError) {
        writePanelError(response, new PanelHttpError(503, error.code, error.message));
        return;
      }
      if (error instanceof OrdinaryRuntimeSnapshotContractError) {
        writePanelError(response, new PanelHttpError(410, error.code, error.message));
        return;
      }
      if (error instanceof RuntimeSnapshotIncompatibleError) {
        writePanelError(response, new PanelHttpError(410, error.code, error.message));
        return;
      }
      logUnhandledPanelRequestError(request, error);
      writePanelError(response, new PanelHttpError(500, "panel_internal_error", "面板请求失败。"));
    }).finally(() => {
      runtime.activeRequestJobs.delete(requestJob);
    });
    runtime.activeRequestJobs.add(requestJob);
  };
}

function createPanelRuntimeHooks(): PanelRuntimeHooks {
  return {
    executeRun: executeBasicPanelRun,
    failRun: failPanelRunJob,
    scheduleNextQueuedConversationRun,
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

  if (request.method === "GET" && url.pathname === PANEL_BRAND_LOGO_PATHNAME) {
    const asset = readPanelBrandLogoAsset();
    response.writeHead(200, {
      "content-type": asset.contentType,
      "cache-control": "no-store",
    });
    response.end(asset.body);
    return;
  }

  if (request.method === "GET" && url.pathname === PANEL_BRAND_LEGACY_ICON_PATHNAME) {
    const asset = readPanelBrandIconAsset();
    response.writeHead(200, {
      "content-type": asset.contentType,
      "cache-control": "no-store",
    });
    response.end(asset.body);
    return;
  }

  if (request.method === "GET") {
    const asset = readPanelStaticAsset(url.pathname);
    if (asset !== undefined) {
      response.writeHead(200, {
        "content-type": asset.contentType,
        "cache-control": "no-store",
      });
      response.end(asset.body);
      return;
    }
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

  if (runtime.isQuiescing) {
    throw new PanelHttpError(503, "panel_runtime_quiescing", "面板正在关闭，不能接受新的请求。");
  }

  // /api/deep/* —— deep 产品 API 端点族（T3-1/T3-2/T3-3）。前缀明确，置于分发链靠前。
  if (await handlePanelDeepRoute(runtime, request, response, url)) {
    return;
  }

  if (await handlePanelAppUpdateRoute(runtime, request, response, url)) {
    return;
  }

  if (await handlePanelConfigRoute(runtime, request, response, url)) {
    return;
  }

  if (await handlePanelContextRoute(runtime, request, response, url)) {
    return;
  }

  if (await handlePanelRunRoute(runtime, request, response, url)) {
    return;
  }

  if (await handlePanelConversationRoute(runtime, request, response, url)) {
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/skills") {
    writeJson(response, 200, {
      ok: true,
      skills: await listPanelSkillSettings(runtime),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/skills/refresh") {
    writeJson(response, 200, {
      ok: true,
      skills: await refreshPanelSkillSettings(runtime),
    });
    return;
  }

  const skillStateMatch = /^\/api\/skills\/([^/]+)\/state$/.exec(url.pathname);
  if (request.method === "POST" && skillStateMatch !== null) {
    await handleUpdateSkillStateRequest(runtime, decodeURIComponent(skillStateMatch[1] ?? ""), request, response);
    return;
  }

  if (await handlePanelBasicAgentRoute(runtime, request, response, url)) {
    return;
  }

  writeJson(response, 404, {
    ok: false,
    status: "failed",
    error: {
      code: "not_found",
      message: "请求资源不存在。",
    },
  });
}

async function handleUpdateSkillStateRequest(
  runtime: PanelRuntime,
  skillId: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readJsonBody(request);
  const record = asRecord(body);
  if (typeof record.enabled !== "boolean") {
    throw new PanelHttpError(400, "invalid_skill_state", "技能状态必须包含 enabled 布尔值。");
  }
  const stateKey = typeof record.stateKey === "string" && record.stateKey.trim().length > 0
    ? record.stateKey.trim()
    : undefined;
  let updated: boolean;
  try {
    updated = await setPanelSkillEnabled(runtime, skillId, record.enabled, stateKey);
  } catch (error) {
    throw new PanelHttpError(
      400,
      "ambiguous_skill_state",
      error instanceof Error ? error.message : "技能来源不明确，无法更新状态。"
    );
  }
  if (!updated) {
    throw new PanelHttpError(501, "skill_state_unavailable", "当前环境没有可用的技能状态存储。");
  }
  writeJson(response, 200, {
    ok: true,
    skills: await listPanelSkillSettings(runtime),
  });
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

export async function closePanelServer(
  server: Server,
  runtime: PanelRuntime,
  options: PanelServerCloseOptions = {},
): Promise<void> {
  const runtimeCleanupTimeoutMs = resolveRuntimeCleanupTimeout(options.runtimeCleanupTimeoutMs);
  // Enter quiescing before any asynchronous shutdown work. Ordinary terminal
  // callbacks may still run while active jobs converge, but they must not
  // admit the next queued conversation run.
  runtime.isQuiescing = true;
  runtime.runExecutor.quiesce();
  // dispose() closes Multi-Agent command admission synchronously before its
  // asynchronous cleanup starts. This covers requests that already passed the
  // Panel gate but are still reading their body or resolving configuration.
  const multiAgentDisposal = runtime.multiAgentFeature.dispose();
  void multiAgentDisposal.catch(() => undefined);
  let serverCloseError: unknown;
  const serverClosed = close(server).catch((error: unknown) => {
    serverCloseError = error;
  });

  const runtimeCleanup = (async () => {
    abortPanelRuntimeActiveRuns(runtime);
    await cleanupPanelRuntimeOwnedBackgroundProcesses(runtime);
    await waitForPanelRequestIdle(server, runtime);
    abortPanelRuntimeActiveRuns(runtime);
    await Promise.all([
      waitForPanelRuntimeIdle(runtime),
      multiAgentDisposal,
    ]);
    await runtime.runExecutor.dispose();
    runtime.runStreamProjection.clear();
    await runtime.toolOutputStore.clear();
    await cleanupPanelRuntimeOwnedBackgroundProcesses(runtime);
    await waitForPanelPersistenceIdle(runtime);
  })();
  // A forced timeout may return while a broken provider promise is still
  // pending. Own its eventual rejection so shutdown never creates an unhandled
  // promise rejection.
  void runtimeCleanup.catch(() => undefined);
  let shutdownTimeoutError: PanelShutdownTimeoutError | undefined;
  try {
    const cleaned = await settleWithin([runtimeCleanup], runtimeCleanupTimeoutMs);
    if (cleaned) {
      await runtimeCleanup;
    } else {
      shutdownTimeoutError = new PanelShutdownTimeoutError(runtimeCleanupTimeoutMs);
    }
  } finally {
    // SSE and other long-lived responses are not active request jobs after
    // their handlers install listeners. Force-close any remaining sockets only
    // after runtime cleanup has converged.
    server.closeAllConnections();
    await serverClosed;
  }

  if (shutdownTimeoutError !== undefined) {
    throw shutdownTimeoutError;
  }
  if (serverCloseError !== undefined) {
    throw serverCloseError;
  }
}

function resolveRuntimeCleanupTimeout(value: number | undefined): number {
  const resolved = value ?? PANEL_RUNTIME_SHUTDOWN_TIMEOUT_MS;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new RangeError("Panel runtime cleanup timeout must be a positive safe integer.");
  }
  return resolved;
}

async function waitForPanelRequestIdle(server: Server, runtime: PanelRuntime): Promise<void> {
  let forcedConnectionsClosed = false;
  while (runtime.activeRequestJobs.size > 0) {
    const jobs = [...runtime.activeRequestJobs];
    if (!forcedConnectionsClosed) {
      const drained = await settleWithin(jobs, PANEL_REQUEST_DRAIN_TIMEOUT_MS);
      if (drained) {
        continue;
      }
      server.closeAllConnections();
      forcedConnectionsClosed = true;
      continue;
    }
    await Promise.allSettled(jobs);
  }
}

function settleWithin(jobs: readonly Promise<void>[], timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    void Promise.allSettled(jobs).then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function waitForPanelRuntimeIdle(runtime: PanelRuntime): Promise<void> {
  while (runtime.activeRunJobs.size > 0) {
    // A job that was already converging when shutdown started can register a
    // replacement controller before the active-job set reaches zero. Abort on
    // every pass so late controllers do not escape the one-time initial scan.
    abortPanelRuntimeActiveRuns(runtime);
    await Promise.allSettled([...runtime.activeRunJobs]);
  }
  abortPanelRuntimeActiveRuns(runtime);
}

async function waitForPanelPersistenceIdle(runtime: PanelRuntime): Promise<void> {
  await waitForPanelPersistenceChainsIdle(runtime.persistenceChains);
}

function abortPanelRuntimeActiveRuns(runtime: PanelRuntime): void {
  for (const controller of runtime.abortControllers.values()) {
    controller.abort();
  }
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

function logUnhandledPanelRequestError(request: IncomingMessage, error: unknown): void {
  const method = request.method ?? "UNKNOWN";
  const url = request.url ?? "/";
  console.error(`[panel-server] unhandled request failure ${method} ${url}`);
  console.error(error);
}
