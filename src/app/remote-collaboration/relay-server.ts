import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { z } from "zod";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import {
  REMOTE_COLLABORATION_PROTOCOL_VERSION,
  isRemoteSyncSnapshot,
  parseRemoteClientFrame,
  type RemoteRelayMessage,
  type RemoteServerFrame,
} from "./protocol.js";
import {
  RemoteRelayError,
  type RelayAuthenticatedDevice,
  type RemoteRelayStore,
} from "./relay-store.js";

const MAX_HTTP_BODY_BYTES = 64 * 1_024;
const DEFAULT_MAX_SYNC_HTTP_BODY_BYTES = 20 * 1_024 * 1_024 + 64 * 1_024;
const MAX_WEBSOCKET_PAYLOAD_BYTES = 1_100_000;
const MAX_WEBSOCKET_BUFFERED_BYTES = 1_100_000;
const HELLO_TIMEOUT_MS = 10_000;

const deviceNameSchema = z.string().trim().min(1).max(160);
const pairingCodeSchema = z.string().regex(/^\d{6}$/u);
const claimSecretSchema = z.string().min(32).max(512);
const invitationCodeSchema = z.string().trim().min(8).max(128);

class RequestBodyTooLarge extends Error {}

export type RemoteRelayServerOptions = {
  readonly store: RemoteRelayStore;
  readonly host?: string;
  readonly port?: number;
  /** Optional built PWA root served by the same Linux process. */
  readonly staticRoot?: string;
  readonly maxSyncBodyBytes?: number;
};

export type StartedRemoteRelayServer = {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly websocketUrl: string;
  close(): Promise<void>;
};

export async function startRemoteRelayServer(options: RemoteRelayServerOptions): Promise<StartedRemoteRelayServer> {
  const sockets = new Map<string, WebSocket>();
  const deliveries = new Map<string, PendingDelivery>();
  const server = createServer((request, response) => {
    void handleHttp(
      options.store,
      sockets,
      deliveries,
      request,
      response,
      options.staticRoot,
      options.maxSyncBodyBytes ?? DEFAULT_MAX_SYNC_HTTP_BODY_BYTES,
    ).catch((error: unknown) => {
      writeHttpError(response, error);
    });
  });
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_WEBSOCKET_PAYLOAD_BYTES });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://relay.local");
    if (url.pathname !== "/v1/connect") {
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });
  websocketServer.on("connection", (websocket) => {
    handleWebSocket(options.store, sockets, deliveries, websocket);
  });
  await listen(server, options.port ?? 4310, options.host ?? "127.0.0.1");
  const address = server.address() as AddressInfo;
  const host = address.address === "::" ? "127.0.0.1" : address.address;
  const url = `http://${formatHost(host)}:${address.port}`;
  return {
    host,
    port: address.port,
    url,
    websocketUrl: `${url.replace(/^http/u, "ws")}/v1/connect`,
    async close() {
      for (const socket of sockets.values()) socket.close(1001, "relay_shutdown");
      deliveries.clear();
      await new Promise<void>((resolve) => websocketServer.close(() => resolve()));
      await closeServer(server);
    },
  };
}

async function handleHttp(
  store: RemoteRelayStore,
  sockets: Map<string, WebSocket>,
  deliveries: Map<string, PendingDelivery>,
  request: IncomingMessage,
  response: ServerResponse,
  staticRoot?: string,
  maxSyncBodyBytes = DEFAULT_MAX_SYNC_HTTP_BODY_BYTES,
): Promise<void> {
  setCorsHeaders(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  const url = new URL(request.url ?? "/", "http://relay.local");
  if (request.method === "GET" && url.pathname === "/health") {
    writeJson(response, 200, { ok: true, service: "agentarbor-remote-relay", protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION });
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/pairings") {
    const input = z.object({ deviceName: deviceNameSchema, invitationCode: invitationCodeSchema.optional() })
      .strict().parse(await readJson(request));
    writeJson(response, 201, { ok: true, pairing: store.createPairing(input.deviceName, input.invitationCode) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/pairings/join") {
    const input = z.object({ pairingCode: pairingCodeSchema, deviceName: deviceNameSchema }).strict()
      .parse(await readJson(request));
    writeJson(response, 201, { ok: true, pairing: store.joinPairing(input.pairingCode, input.deviceName) });
    return;
  }
  const pairingAction = /^\/v1\/pairings\/([^/]+)\/(status|confirm|token)$/u.exec(url.pathname);
  if (request.method === "POST" && pairingAction !== null) {
    const pairingId = decodeURIComponent(pairingAction[1]);
    const action = pairingAction[2];
    const raw = await readJson(request);
    if (action === "confirm") {
      const input = z.object({ claimSecret: claimSecretSchema, pairingCode: pairingCodeSchema }).strict().parse(raw);
      writeJson(response, 200, { ok: true, pairing: store.confirmPairing(pairingId, input.claimSecret, input.pairingCode) });
      return;
    }
    const input = z.object({ claimSecret: claimSecretSchema }).strict().parse(raw);
    if (action === "status") {
      writeJson(response, 200, { ok: true, pairing: store.pairingStatus(pairingId, input.claimSecret) });
      return;
    }
    writeJson(response, 200, { ok: true, device: store.issueDeviceToken(pairingId, input.claimSecret) });
    return;
  }
  if (request.method === "GET" && url.pathname === "/v1/devices") {
    writeJson(response, 200, { ok: true, devices: store.listDevices(bearerToken(request)) });
    return;
  }
  if (request.method === "GET" && url.pathname === "/v1/sync/snapshots") {
    const sync = store.listSyncSnapshots(bearerToken(request));
    writeJson(response, 200, { ok: true, ...sync });
    return;
  }
  const syncWrite = /^\/v1\/sync\/snapshots\/(space\.snapshot|notebook\.snapshot|asset\.snapshot|managed_folder\.snapshot)$/u.exec(url.pathname);
  if (request.method === "PUT" && syncWrite !== null) {
    const auth = store.authenticate(bearerToken(request));
    const snapshot = await readJson(request, maxSyncBodyBytes);
    if (typeof snapshot !== "object" || snapshot === null || !("kind" in snapshot) || snapshot.kind !== syncWrite[1]) {
      throw new RemoteRelayError("sync_write_forbidden", "The synchronized document kind does not match the request path");
    }
    const document = store.saveSyncSnapshot(auth, snapshot);
    writeJson(response, 200, {
      ok: true,
      document: {
        kind: document.kind,
        version: document.version,
        bytes: document.bytes,
        updatedAt: document.updatedAt,
      },
    });
    return;
  }
  const revoke = /^\/v1\/devices\/([^/]+)\/revoke$/u.exec(url.pathname);
  if (request.method === "POST" && revoke !== null) {
    const deviceId = decodeURIComponent(revoke[1]);
    store.revokeDevice(bearerToken(request), deviceId);
    sockets.get(deviceId)?.close(4003, "device_revoked");
    sockets.delete(deviceId);
    for (const [messageId, delivery] of deliveries) {
      if (delivery.sourceDeviceId === deviceId || delivery.targetDeviceId === deviceId) deliveries.delete(messageId);
    }
    writeJson(response, 200, { ok: true, revokedDeviceId: deviceId });
    return;
  }
  if (request.method === "GET" && staticRoot !== undefined && !url.pathname.startsWith("/v1/")) {
    if (await serveStaticMobileApp(staticRoot, url.pathname, response)) return;
  }
  writeJson(response, 404, { ok: false, error: { code: "route_not_found", message: "Relay route was not found" } });
}

async function serveStaticMobileApp(root: string, pathname: string, response: ServerResponse): Promise<boolean> {
  const rootPath = path.resolve(root);
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(rootPath, requested);
  const withinRoot = candidate === rootPath || candidate.startsWith(`${rootPath}${path.sep}`);
  if (!withinRoot) return false;
  let filePath = candidate;
  let body = await fs.readFile(filePath).catch(() => undefined);
  if (body === undefined && !path.extname(requested)) {
    filePath = path.join(rootPath, "index.html");
    body = await fs.readFile(filePath).catch(() => undefined);
  }
  if (body === undefined) return false;
  response.writeHead(200, {
    "content-type": contentType(filePath),
    "content-length": body.length,
    "cache-control": path.basename(filePath) === "sw.js" || path.basename(filePath) === "index.html"
      ? "no-cache"
      : "public, max-age=31536000, immutable",
  });
  response.end(body);
  return true;
}

function contentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json":
    case ".webmanifest": return "application/manifest+json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".ico": return "image/x-icon";
    default: return "application/octet-stream";
  }
}

function handleWebSocket(
  store: RemoteRelayStore,
  sockets: Map<string, WebSocket>,
  deliveries: Map<string, PendingDelivery>,
  websocket: WebSocket,
): void {
  let auth: RelayAuthenticatedDevice | undefined;
  let accessToken: string | undefined;
  const helloTimer = setTimeout(() => websocket.close(4401, "client_hello_required"), HELLO_TIMEOUT_MS);
  helloTimer.unref?.();

  websocket.on("message", (raw) => {
    void (async () => {
      let frame;
      try {
        frame = parseRemoteClientFrame(parseWebSocketJson(raw));
      } catch (error) {
        sendFrame(websocket, serverError("invalid_frame", error instanceof Error ? error.message : "Invalid frame"));
        return;
      }
      try {
        if (auth === undefined) {
          if (frame.type !== "client.hello") {
            throw new RemoteRelayError("invalid_device_token", "client.hello must be the first frame");
          }
          accessToken = frame.token;
          auth = store.authenticate(accessToken);
          clearTimeout(helloTimer);
          const previous = sockets.get(auth.deviceId);
          if (previous !== undefined && previous !== websocket) previous.close(4001, "connection_replaced");
          sockets.set(auth.deviceId, websocket);
          const peerOnline = sockets.has(auth.peerDeviceId);
          sendFrame(websocket, {
            protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
            type: "server.ready",
            deviceId: auth.deviceId,
            peerDeviceId: auth.peerDeviceId,
            peerDeviceName: auth.peerDeviceName,
            peerOnline,
          });
          if (peerOnline) sendFrame(sockets.get(auth.peerDeviceId)!, {
            protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
            type: "peer.presence",
            online: true,
          });
          return;
        }
        auth = store.authenticate(accessToken!);
        if (frame.type === "client.hello") {
          sendFrame(websocket, serverError("duplicate_hello", "client.hello was already accepted"));
          return;
        }
        if (frame.type === "heartbeat") {
          sendFrame(websocket, {
            protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
            type: "heartbeat.ack",
            sentAt: frame.sentAt,
          });
          return;
        }
        if (frame.type === "message.received") {
          settleDelivery(deliveries, sockets, auth, frame.messageId);
          return;
        }
        const peerSocket = sockets.get(auth.peerDeviceId);
        const syncSnapshot = frame.content.type === "event" && isRemoteSyncSnapshot(frame.content.event)
          ? frame.content.event
          : undefined;
        if (syncSnapshot !== undefined) {
          sendFrame(websocket, {
            protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
            type: "message.rejected",
            clientMessageId: frame.clientMessageId,
            code: "sync_requires_http",
            message: "Synchronized snapshots must use the authenticated HTTPS endpoint",
          });
          return;
        }
        if (peerSocket === undefined || peerSocket.readyState !== WebSocket.OPEN) {
          sendFrame(websocket, {
            protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
            type: "message.rejected",
            clientMessageId: frame.clientMessageId,
            code: "peer_offline",
            message: "The paired device is offline; the message remains in the local outbox",
          });
          return;
        }
        const message: RemoteRelayMessage = {
          protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
          messageId: randomUUID(),
          clientMessageId: frame.clientMessageId,
          sourceDeviceId: auth.deviceId,
          targetDeviceId: auth.peerDeviceId,
          createdAt: new Date().toISOString(),
          content: frame.content,
        };
        if (peerSocket !== undefined && peerSocket.readyState === WebSocket.OPEN) {
          deliveries.set(message.messageId, {
            messageId: message.messageId,
            clientMessageId: message.clientMessageId,
            sourceDeviceId: message.sourceDeviceId,
            targetDeviceId: message.targetDeviceId,
          });
        }
        sendFrame(websocket, {
          protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
          type: "message.accepted",
          clientMessageId: message.clientMessageId,
          messageId: message.messageId,
          settled: false,
        });
        if (peerSocket !== undefined && peerSocket.readyState === WebSocket.OPEN) {
          sendFrame(peerSocket, {
            protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
            type: "message.deliver",
            message,
          });
        }
      } catch (error) {
        sendFrame(websocket, relayServerError(error));
        if (error instanceof RemoteRelayError && ["invalid_device_token", "device_revoked"].includes(error.code)) {
          websocket.close(4403, error.code);
        }
      }
    })();
  });
  websocket.on("close", () => {
    clearTimeout(helloTimer);
    if (auth !== undefined && sockets.get(auth.deviceId) === websocket) {
      sockets.delete(auth.deviceId);
      for (const [messageId, delivery] of deliveries) {
        if (delivery.sourceDeviceId === auth.deviceId || delivery.targetDeviceId === auth.deviceId) deliveries.delete(messageId);
      }
      const peerSocket = sockets.get(auth.peerDeviceId);
      if (peerSocket !== undefined) sendFrame(peerSocket, {
        protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
        type: "peer.presence",
        online: false,
      });
    }
  });
  websocket.on("error", () => undefined);
}

function settleDelivery(
  deliveries: Map<string, PendingDelivery>,
  sockets: Map<string, WebSocket>,
  receiver: RelayAuthenticatedDevice,
  messageId: string,
): void {
  const delivery = deliveries.get(messageId);
  if (delivery === undefined || delivery.targetDeviceId !== receiver.deviceId) return;
  deliveries.delete(messageId);
  const sender = sockets.get(delivery.sourceDeviceId);
  if (sender === undefined) return;
  sendFrame(sender, {
    protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
    type: "message.received",
    clientMessageId: delivery.clientMessageId,
    messageId,
  });
}

function sendFrame(websocket: WebSocket, frame: RemoteServerFrame): boolean {
  if (websocket.readyState !== WebSocket.OPEN) return false;
  if (websocket.bufferedAmount > MAX_WEBSOCKET_BUFFERED_BYTES) {
    websocket.close(1013, "slow_consumer");
    return false;
  }
  websocket.send(JSON.stringify(frame));
  return true;
}

function relayServerError(error: unknown): RemoteServerFrame {
  if (error instanceof RemoteRelayError) return serverError(error.code, error.message);
  if (error instanceof z.ZodError) return serverError("invalid_frame", z.prettifyError(error));
  return serverError("relay_failure", error instanceof Error ? error.message : "Relay request failed");
}

function serverError(code: string, message: string): RemoteServerFrame {
  return { protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION, type: "server.error", code, message };
}

type PendingDelivery = {
  readonly messageId: string;
  readonly clientMessageId: string;
  readonly sourceDeviceId: string;
  readonly targetDeviceId: string;
};

function parseWebSocketJson(raw: RawData): unknown {
  return JSON.parse(raw.toString()) as unknown;
}

function bearerToken(request: IncomingMessage): string {
  const authorization = request.headers.authorization;
  if (authorization === undefined || !authorization.startsWith("Bearer ")) {
    throw new RemoteRelayError("invalid_device_token", "A bearer device token is required");
  }
  return authorization.slice("Bearer ".length).trim();
}

async function readJson(request: IncomingMessage, limitBytes = MAX_HTTP_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > limitBytes) throw new RequestBodyTooLarge("Request body is too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function writeHttpError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  if (error instanceof RemoteRelayError) {
    const status = error.code === "pairing_not_found" ? 404
      : ["invalid_claim", "invalid_device_token"].includes(error.code) ? 401
        : error.code === "device_revoked" ? 403
          : 409;
    writeJson(response, status, { ok: false, error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    writeJson(response, 400, { ok: false, error: { code: "invalid_request", message: error.message } });
    return;
  }
  if (error instanceof RequestBodyTooLarge) {
    writeJson(response, 413, { ok: false, error: { code: "request_too_large", message: error.message } });
    return;
  }
  writeJson(response, 500, { ok: false, error: { code: "relay_failure", message: error instanceof Error ? error.message : "Relay request failed" } });
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "authorization, content-type");
  response.setHeader("access-control-allow-methods", "GET, POST, PUT, OPTIONS");
}

function formatHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
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

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}
