import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";

import { PanelHttpError, readJsonBody, writeJson } from "./http-utils.js";
import type { PanelRuntime } from "./runtime.js";

function parseRemoteBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new PanelHttpError(400, "invalid_request", z.prettifyError(parsed.error));
  }
  return parsed.data;
}

export async function handlePanelRemoteCollaborationRoute(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (request.method === "GET" && url.pathname === "/api/remote-collaboration/status") {
    writeJson(response, 200, { ok: true, remote: runtime.remoteCollaborationFeature.queries.status() });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/remote-collaboration/pairings") {
    const body = parseRemoteBody(z.object({
      relayUrl: z.url().refine((value) => {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      }, "Relay 地址必须使用 http 或 https"),
      deviceName: z.string().trim().min(1).max(160),
      invitationCode: z.string().trim().min(8).max(128).optional(),
    }).strict(), await readJsonBody(request));
    const pairing = await runtime.remoteCollaborationFeature.commands.beginPairing(
      body.relayUrl,
      body.deviceName,
      body.invitationCode,
    );
    writeJson(response, 201, { ok: true, pairing, remote: runtime.remoteCollaborationFeature.queries.status() });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/remote-collaboration/pairings/inspect") {
    const pairing = await runtime.remoteCollaborationFeature.commands.inspectPairing();
    writeJson(response, 200, { ok: true, pairing, remote: runtime.remoteCollaborationFeature.queries.status() });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/remote-collaboration/pairings/confirm") {
    const pairing = await runtime.remoteCollaborationFeature.commands.confirmPairing();
    writeJson(response, 200, { ok: true, pairing, remote: runtime.remoteCollaborationFeature.queries.status() });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/remote-collaboration/connect") {
    await runtime.remoteCollaborationFeature.commands.connect();
    writeJson(response, 200, { ok: true, remote: runtime.remoteCollaborationFeature.queries.status() });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/remote-collaboration/disconnect") {
    runtime.remoteCollaborationFeature.commands.disconnect();
    writeJson(response, 200, { ok: true, remote: runtime.remoteCollaborationFeature.queries.status() });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/remote-collaboration/forget") {
    await runtime.remoteCollaborationFeature.commands.forgetDevice();
    writeJson(response, 200, { ok: true, remote: runtime.remoteCollaborationFeature.queries.status() });
    return true;
  }
  const share = /^\/api\/remote-collaboration\/conversations\/([^/]+)\/share$/u.exec(url.pathname);
  if (request.method === "POST" && share !== null) {
    const conversationId = decodeURIComponent(share[1]);
    const conversation = await runtime.ordinaryAgentFeature.queries.getConversation(conversationId);
    if (conversation === undefined) {
      throw new PanelHttpError(404, "conversation_not_found", "未找到要共享的对话。");
    }
    runtime.remoteDesktopStore.shareConversation(conversationId, new Date().toISOString());
    await runtime.remoteCollaborationFeature.commands.publishSnapshots();
    if (conversation.activeRunId !== undefined) {
      await runtime.remoteCollaborationFeature.commands.publishRun(conversation.activeRunId);
    }
    writeJson(response, 200, { ok: true, conversationId, shared: true });
    return true;
  }
  return false;
}
