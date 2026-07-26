import type { IncomingMessage, ServerResponse } from "node:http";
import type { PathMemoryFeatureError } from "../path-memory/contracts.js";
import { PanelHttpError, writeJson } from "./http-utils.js";
import { parsePathMemoryListQuery, parsePathMemorySearchQuery } from "./request-parsers.js";
import type { PanelRuntime } from "./runtime.js";

/** Read-only PathMemory management plus explicit delete (ADR-0032 phase 2). */
export async function handlePanelPathMemoryRoute(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (request.method === "GET" && url.pathname === "/api/path-memory/records") {
    const filter = parsePathMemoryListQuery(Object.fromEntries(url.searchParams));
    writeJson(response, 200, {
      ok: true,
      memories: await runtime.pathMemoryFeature.queries.list(filter),
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/path-memory/search") {
    const searchInput = parsePathMemorySearchQuery(Object.fromEntries(url.searchParams));
    writeJson(response, 200, {
      ok: true,
      results: await runtime.pathMemoryFeature.queries.search(searchInput),
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/path-memory/diagnostics") {
    // Read-only snapshot; records.total scans the full list because current
    // data volume is small (no caching by design).
    const memories = await runtime.pathMemoryFeature.queries.list();
    writeJson(response, 200, {
      ok: true,
      diagnostics: {
        ...runtime.ordinaryPathMemoryConnector.diagnostics(),
        records: { total: memories.length },
      },
    });
    return true;
  }

  const record = /^\/api\/path-memory\/records\/([^/]+)$/u.exec(url.pathname);
  if (record === null) return false;
  const memoryId = decodeURIComponent(record[1] ?? "");

  if (request.method === "GET") {
    const memory = await runtime.pathMemoryFeature.queries.get(memoryId);
    if (memory === undefined) {
      throw new PanelHttpError(404, "path_memory_not_found", "未找到路径记忆记录。");
    }
    writeJson(response, 200, { ok: true, memory });
    return true;
  }

  if (request.method === "DELETE") {
    await runtime.pathMemoryFeature.commands.delete(memoryId);
    writeJson(response, 200, { ok: true });
    return true;
  }

  return false;
}

export function pathMemoryFeatureHttpError(error: PathMemoryFeatureError): PanelHttpError {
  switch (error.code) {
    case "path_memory_feature_released":
      return new PanelHttpError(503, "panel_runtime_quiescing", "面板正在关闭，不能接受新的请求。");
    case "path_memory_not_found":
      return new PanelHttpError(404, error.code, error.message);
    case "path_memory_source_conflict":
      return new PanelHttpError(409, error.code, error.message);
    case "path_memory_snapshot_incompatible":
    case "path_memory_repository_failure":
      return new PanelHttpError(500, error.code, error.message);
  }
}
