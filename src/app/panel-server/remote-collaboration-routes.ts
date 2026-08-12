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
  if (request.method === "POST" && url.pathname === "/api/remote-collaboration/account/activate") {
    const body = parseRemoteBody(z.object({
      relayUrl: z.url().refine((value) => {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      }, "官方协同服务配置无效"),
      deviceName: z.string().trim().min(1).max(160),
      invitationCode: z.string().trim().min(8).max(128).optional(),
    }).strict(), await readJsonBody(request));
    const credential = await runtime.remoteCollaborationFeature.commands.activateAccount(
      body.relayUrl,
      body.deviceName,
      body.invitationCode,
    );
    writeJson(response, 201, { ok: true, credential, remote: runtime.remoteCollaborationFeature.queries.status() });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/remote-collaboration/pairings/start") {
    const pairing = await runtime.remoteCollaborationFeature.commands.beginPairing();
    writeJson(response, 201, { ok: true, pairing, remote: runtime.remoteCollaborationFeature.queries.status() });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/remote-collaboration/pairings/inspect") {
    const pairing = await runtime.remoteCollaborationFeature.commands.inspectPairing();
    writeJson(response, 200, { ok: true, pairing, remote: runtime.remoteCollaborationFeature.queries.status() });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/remote-collaboration/pairings/approve") {
    const pairing = await runtime.remoteCollaborationFeature.commands.approvePairing();
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
    await runtime.remoteCollaborationFeature.commands.forgetAccount();
    writeJson(response, 200, { ok: true, remote: runtime.remoteCollaborationFeature.queries.status() });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/remote-collaboration/revoke-phone") {
    await runtime.remoteCollaborationFeature.commands.revokePeerDevice();
    writeJson(response, 200, { ok: true, remote: runtime.remoteCollaborationFeature.queries.status() });
    return true;
  }
  if (request.method === "PATCH" && url.pathname === "/api/remote-collaboration/account/handle") {
    const body = parseRemoteBody(z.object({ handle: z.string().trim().min(3).max(32) }).strict(), await readJsonBody(request));
    const account = await runtime.remoteCollaborationFeature.commands.updateAccountHandle(body.handle);
    writeJson(response, 200, { ok: true, account, remote: runtime.remoteCollaborationFeature.queries.status() });
    return true;
  }
  return false;
}
