import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";

import {
  CONTENT_VAULT_PROTOCOL_VERSION,
  CONTENT_VAULT_MAX_INLINE_BYTES,
  contentVaultMutationBatchSchema,
  contentVaultResourceKindSchema,
  type ContentVaultResourceKind,
} from "./contracts.js";
import { ContentVaultError, type ContentVaultRepository } from "./sqlite-repository.js";

// One maximum-size inline resource plus JSON envelope and mutation metadata.
// Sync clients flush durable mutations individually, so this stays bounded.
const MAX_VAULT_BODY_BYTES = CONTENT_VAULT_MAX_INLINE_BYTES + 1 * 1_024 * 1_024;
const MAX_VAULT_RESPONSE_ITEMS_BYTES = 8 * 1_024 * 1_024;
const cursorSchema = z.coerce.number().int().nonnegative();
const limitSchema = z.coerce.number().int().min(1).max(500);
const snapshotQuerySchema = z.object({
  at: cursorSchema.optional(),
  afterKind: contentVaultResourceKindSchema.optional(),
  afterResourceId: z.string().trim().min(1).max(512).optional(),
}).superRefine((value, context) => {
  if ((value.afterKind === undefined) !== (value.afterResourceId === undefined)) {
    context.addIssue({ code: "custom", message: "snapshot keyset fields must be provided together" });
  }
  if (value.at === undefined && value.afterKind !== undefined) {
    context.addIssue({ code: "custom", message: "snapshot keyset requires a fixed change cursor" });
  }
});

export type ContentVaultAuthenticator = (accessToken: string) => {
  readonly accountId: string;
  readonly deviceId: string;
};

export type ContentVaultHttpHandler = {
  handle(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
  subscribe(listener: (event: ContentVaultChangedEvent) => void): () => void;
};

export type ContentVaultChangedEvent = {
  readonly accountId: string;
  readonly sourceDeviceId: string;
  readonly cursor: number;
};

export function createContentVaultHttpHandler(input: {
  readonly repository: ContentVaultRepository;
  readonly authenticate: ContentVaultAuthenticator;
  readonly now?: () => string;
}): ContentVaultHttpHandler {
  const now = input.now ?? (() => new Date().toISOString());
  const listeners = new Set<(event: ContentVaultChangedEvent) => void>();

  return {
    async handle(request, response): Promise<boolean> {
      const url = new URL(request.url ?? "/", "http://vault.local");
      if (!url.pathname.startsWith("/v1/vault/")) return false;
      try {
        let auth: ReturnType<ContentVaultAuthenticator>;
        try {
          auth = input.authenticate(readBearerToken(request));
        } catch {
          throw new ContentVaultHttpError(401, "invalid_device_token", "The device token is invalid");
        }
        if (request.method === "POST" && url.pathname === "/v1/vault/mutations") {
          const batch = contentVaultMutationBatchSchema.parse(await readJson(request));
          const results = batch.mutations.map((mutation) => input.repository.applyMutation({
            accountId: auth.accountId,
            deviceId: auth.deviceId,
            mutation,
            at: now(),
          }));
          writeJson(response, 200, { ok: true, protocolVersion: CONTENT_VAULT_PROTOCOL_VERSION, results });
          const cursor = results.reduce((highest, result) => result.status === "applied"
            ? Math.max(highest, result.cursor)
            : highest, 0);
          if (cursor > 0) {
            for (const listener of [...listeners]) {
              try { listener({ accountId: auth.accountId, sourceDeviceId: auth.deviceId, cursor }); } catch {
                // A committed Vault mutation is independent from realtime invalidation delivery.
              }
            }
          }
          return true;
        }
        if (request.method === "GET" && url.pathname === "/v1/vault/changes") {
          const after = parseQueryNumber(url.searchParams.get("after"), 0, cursorSchema);
          const limit = parseQueryNumber(url.searchParams.get("limit"), 100, limitSchema);
          const changes = input.repository.listChanges(auth.accountId, after, limit, MAX_VAULT_RESPONSE_ITEMS_BYTES);
          const nextCursor = changes.length === 0 ? after : changes[changes.length - 1]!.cursor;
          writeJson(response, 200, {
            ok: true,
            protocolVersion: CONTENT_VAULT_PROTOCOL_VERSION,
            after,
            changes,
            nextCursor,
            hasMore: nextCursor < input.repository.currentCursor(auth.accountId),
          });
          return true;
        }
        if (request.method === "GET" && url.pathname === "/v1/vault/snapshot") {
          const limit = parseQueryNumber(url.searchParams.get("limit"), 100, limitSchema);
          const query = snapshotQuerySchema.parse({
            ...(url.searchParams.has("at") ? { at: url.searchParams.get("at") } : {}),
            ...(url.searchParams.has("afterKind") ? { afterKind: url.searchParams.get("afterKind") } : {}),
            ...(url.searchParams.has("afterResourceId") ? { afterResourceId: url.searchParams.get("afterResourceId") } : {}),
          });
          const snapshotCursor = query.at === undefined
            ? undefined
            : query.afterKind === undefined || query.afterResourceId === undefined
              ? { changeCursor: query.at }
              : { changeCursor: query.at, afterKind: query.afterKind, afterResourceId: query.afterResourceId };
          const snapshot = input.repository.snapshot(auth.accountId, snapshotCursor, limit, MAX_VAULT_RESPONSE_ITEMS_BYTES);
          writeJson(response, 200, {
            ok: true,
            protocolVersion: CONTENT_VAULT_PROTOCOL_VERSION,
            ...snapshot,
          });
          return true;
        }
        const resourceMatch = /^\/v1\/vault\/resources\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
        if (request.method === "GET" && resourceMatch !== null) {
          const kind = parseResourceKind(decodeURIComponent(resourceMatch[1]!));
          const resource = input.repository.readResource(auth.accountId, kind, decodeURIComponent(resourceMatch[2]!));
          if (resource === undefined) {
            writeJson(response, 404, { ok: false, error: { code: "resource_not_found", message: "The vault resource was not found" } });
            return true;
          }
          writeJson(response, 200, { ok: true, protocolVersion: CONTENT_VAULT_PROTOCOL_VERSION, resource });
          return true;
        }
        if (request.method === "GET" && url.pathname === "/v1/vault/usage") {
          writeJson(response, 200, { ok: true, protocolVersion: CONTENT_VAULT_PROTOCOL_VERSION, usage: input.repository.usage(auth.accountId) });
          return true;
        }
        writeJson(response, 404, { ok: false, error: { code: "not_found", message: "The Content Vault route was not found" } });
        return true;
      } catch (error) {
        writeVaultError(response, error);
        return true;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function parseResourceKind(value: string): ContentVaultResourceKind {
  return contentVaultResourceKindSchema.parse(value);
}

function parseQueryNumber<T extends z.ZodType<number>>(value: string | null, fallback: number, schema: T): number {
  return schema.parse(value === null ? fallback : value);
}

function readBearerToken(request: IncomingMessage): string {
  const authorization = request.headers.authorization;
  if (authorization === undefined || !authorization.startsWith("Bearer ")) throw new ContentVaultHttpError(401, "invalid_device_token", "A bearer device token is required");
  const token = authorization.slice("Bearer ".length).trim();
  if (token.length === 0) throw new ContentVaultHttpError(401, "invalid_device_token", "A bearer device token is required");
  return token;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_VAULT_BODY_BYTES) throw new ContentVaultHttpError(413, "batch_too_large", "The Content Vault request is too large");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    throw new ContentVaultHttpError(400, "invalid_json", "The request body is not valid JSON", error);
  }
}

function writeVaultError(response: ServerResponse, error: unknown): void {
  if (error instanceof ContentVaultHttpError) {
    writeJson(response, error.status, { ok: false, error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof ContentVaultError) {
    const status = error.code === "resource_too_large" || error.code === "vault_quota_exceeded" || error.code === "vault_resource_limit_exceeded" ? 413 : error.code === "mutation_id_reused" ? 409 : 400;
    writeJson(response, status, { ok: false, error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof z.ZodError) {
    writeJson(response, 400, { ok: false, error: { code: "invalid_vault_request", message: z.prettifyError(error) } });
    return;
  }
  writeJson(response, 500, { ok: false, error: { code: "vault_failure", message: error instanceof Error ? error.message : "Content Vault request failed" } });
}

class ContentVaultHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, options?: unknown) {
    super(message, options === undefined ? undefined : { cause: options });
  }
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}
