import type { IncomingMessage, ServerResponse } from "node:http";
import type { ConfigCenter } from "../config-center.js";
import {
  ContextAttachmentPreviewError,
  createContextAttachmentPreview,
  type CreateContextAttachmentPreviewInput,
} from "../context-attachments.js";
import { PanelHttpError, readJsonBody, writeJson } from "./http-utils.js";
import { asRecord, optionalString } from "./request-parsers.js";

export type PanelContextRouteRuntime = {
  readonly configCenter: ConfigCenter;
};

export async function handlePanelContextRoute(
  runtime: PanelContextRouteRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<boolean> {
  if (request.method === "POST" && url.pathname === "/api/context/attachments/preview") {
    const body = await readJsonBody(request);
    const workspace = await runtime.configCenter.getWorkspaceConfig();
    const attachment = await createContextAttachmentPreview({
      raw: parseContextAttachmentPreviewInput(body),
      workspaceRoot: workspace.workspaceDirectory,
    }).catch((error: unknown) => {
      if (error instanceof ContextAttachmentPreviewError) {
        throw new PanelHttpError(400, error.code, error.message);
      }
      throw error;
    });
    writeJson(response, 200, { ok: true, attachment });
    return true;
  }
  return false;
}

function parseContextAttachmentPreviewInput(raw: unknown): CreateContextAttachmentPreviewInput {
  const record = asRecord(raw);
  const kind = optionalString(record.kind);
  if (kind !== undefined && kind !== "workspace" && kind !== "file" && kind !== "project" && kind !== "web") {
    throw new PanelHttpError(400, "invalid_context_attachment_kind", "上下文附件类型必须是 workspace、file、project 或 web。");
  }
  return {
    kind,
    value: optionalString(record.value),
    ref: optionalString(record.ref),
    title: optionalString(record.title),
    summary: optionalString(record.summary),
  };
}
