import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createPanelHtml, readPanelStaticAsset } from "../panel-assets.js";
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
import { syncPanelRunStreamEventsForJob } from "./run-stream-sync.js";
import { createPanelRuntime, isPanelRuntime, type PanelRuntime, type PanelRuntimeHooks } from "./runtime.js";
import {
  executeBasicPanelRun,
  failPanelRunJob,
} from "./run-execution.js";
import { handlePanelRunRoute } from "./run-routes.js";
import { listPanelSkills, refreshPanelSkills, setPanelSkillEnabled } from "./skill-service.js";
export type { PanelModelCatalogFetch, PanelProviderFetch, PanelServerOptions, StartedPanelServer } from "./types.js";

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
    handlePanelRequest(runtime, request, response).catch((error) => {
      if (error instanceof PanelHttpError) {
        writePanelError(response, error);
        return;
      }
      writePanelError(response, new PanelHttpError(500, "panel_internal_error", "面板请求失败。"));
    });
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
      skills: await listPanelSkills(runtime),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/skills/refresh") {
    writeJson(response, 200, {
      ok: true,
      skills: await refreshPanelSkills(runtime),
    });
    return;
  }

  const skillStateMatch = /^\/api\/skills\/([^/]+)\/state$/.exec(url.pathname);
  if (request.method === "POST" && skillStateMatch !== null) {
    await handleUpdateSkillStateRequest(runtime, decodeURIComponent(skillStateMatch[1] ?? ""), request, response);
    return;
  }

  if (await handlePanelBasicAgentRoute(runtime, request, response, url, (job) => {
    syncPanelRunStreamEventsForJob(runtime, job);
  })) {
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
  const updated = await setPanelSkillEnabled(runtime, skillId, record.enabled);
  if (!updated) {
    throw new PanelHttpError(501, "skill_state_unavailable", "当前环境没有可用的技能状态存储。");
  }
  writeJson(response, 200, {
    ok: true,
    skills: await listPanelSkills(runtime),
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

async function closePanelServer(server: Server, runtime: PanelRuntime): Promise<void> {
  await close(server);
  await waitForPanelRuntimeIdle(runtime);
  await waitForPanelPersistenceIdle(runtime);
}

async function waitForPanelRuntimeIdle(runtime: PanelRuntime): Promise<void> {
  while (runtime.activeRunJobs.size > 0) {
    await Promise.allSettled([...runtime.activeRunJobs]);
  }
}

async function waitForPanelPersistenceIdle(runtime: PanelRuntime): Promise<void> {
  await waitForPanelPersistenceChainsIdle(runtime.persistenceChains);
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
