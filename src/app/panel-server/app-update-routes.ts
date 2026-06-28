import type { IncomingMessage, ServerResponse } from "node:http";
import type { PanelRuntime } from "./runtime.js";
import { writeJson } from "./http-utils.js";

export async function handlePanelAppUpdateRoute(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<boolean> {
  if (request.method === "GET" && url.pathname === "/api/app/update") {
    writeJson(response, 200, runtime.appUpdateService.status());
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/app/update/check") {
    writeJson(response, 200, await runtime.appUpdateService.check());
    return true;
  }

  return false;
}
