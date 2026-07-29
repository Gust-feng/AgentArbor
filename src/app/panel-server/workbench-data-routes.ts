import type { IncomingMessage, ServerResponse } from "node:http";

import { PanelHttpError, writeJson } from "./http-utils.js";
import type { PanelRuntime } from "./runtime.js";
import { WorkbenchDataMaintenanceError } from "./workbench-data-maintenance.js";

export async function handlePanelWorkbenchDataRoute(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname === "/api/workbench-data/health" && request.method === "GET") {
    const health = runtime.workbenchDataMaintenance.health();
    writeJson(response, health.ok ? 200 : 503, { ok: health.ok, health });
    return true;
  }
  if (url.pathname === "/api/workbench-data/backups" && request.method === "POST") {
    writeJson(response, 201, { ok: true, backup: await runtime.workbenchDataMaintenance.createBackup() });
    return true;
  }
  if (url.pathname === "/api/workbench-data/restore/select" && request.method === "POST") {
    writeJson(response, 200, { ok: true, result: await runtime.workbenchDataMaintenance.selectAndStageRestore() });
    return true;
  }
  return false;
}

export function workbenchDataHttpError(error: WorkbenchDataMaintenanceError): PanelHttpError {
  switch (error.code) {
    case "restore_picker_unavailable":
      return new PanelHttpError(501, error.code, error.message);
    case "restore_source_invalid":
      return new PanelHttpError(400, error.code, error.message);
    case "data_maintenance_failed":
      return new PanelHttpError(500, error.code, error.message);
  }
}
