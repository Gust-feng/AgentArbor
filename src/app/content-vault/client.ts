import {
  CONTENT_VAULT_PROTOCOL_VERSION,
  contentVaultChangeSchema,
  contentVaultMutationResultSchema,
  contentVaultResourceKindSchema,
  contentVaultResourceSchema,
  type ContentVaultChange,
  type ContentVaultMutation,
  type ContentVaultMutationResult,
  type ContentVaultResource,
  type ContentVaultSnapshotCursor,
  type ContentVaultUsage,
} from "./contracts.js";

export type ContentVaultHttpClient = ReturnType<typeof createContentVaultHttpClient>;

export function createContentVaultHttpClient(input: {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetch?: typeof globalThis.fetch;
}) {
  const fetch = input.fetch ?? globalThis.fetch;
  const baseUrl = input.baseUrl.replace(/\/$/u, "");

  async function mutate(mutations: readonly ContentVaultMutation[]): Promise<readonly ContentVaultMutationResult[]> {
    const body = await requestJson(fetch, `${baseUrl}/v1/vault/mutations`, input.token, {
      method: "POST",
      body: JSON.stringify({ protocolVersion: CONTENT_VAULT_PROTOCOL_VERSION, mutations }),
    });
    const results = Array.isArray(body.results) ? body.results.map((result) => contentVaultMutationResultSchema.parse(result)) : [];
    return results;
  }

  async function changes(after: number, limit = 100): Promise<{
    readonly changes: readonly ContentVaultChange[];
    readonly nextCursor: number;
    readonly hasMore: boolean;
  }> {
    const body = await requestJson(fetch, `${baseUrl}/v1/vault/changes?after=${encodeURIComponent(String(after))}&limit=${encodeURIComponent(String(limit))}`, input.token);
    return {
      changes: Array.isArray(body.changes) ? body.changes.map((change) => contentVaultChangeSchema.parse(change)) : [],
      nextCursor: numberField(body.nextCursor, after),
      hasMore: body.hasMore === true,
    };
  }

  async function snapshot(cursor?: ContentVaultSnapshotCursor, limit = 100): Promise<{
    readonly resources: readonly ContentVaultResource[];
    readonly nextCursor?: ContentVaultSnapshotCursor;
    readonly changeCursor: number;
  }> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor !== undefined) {
      query.set("at", String(cursor.changeCursor));
      if ("afterKind" in cursor) {
        query.set("afterKind", cursor.afterKind);
        query.set("afterResourceId", cursor.afterResourceId);
      }
    }
    const body = await requestJson(fetch, `${baseUrl}/v1/vault/snapshot?${query}`, input.token);
    const changeCursor = requiredNonnegativeInteger(body.changeCursor, "Content Vault snapshot change cursor is invalid");
    const next = snapshotCursorField(body.nextCursor, changeCursor);
    if (body.nextCursor !== undefined && next === undefined) {
      throw new Error("Content Vault snapshot continuation is invalid");
    }
    return {
      resources: Array.isArray(body.resources) ? body.resources.map((resource) => contentVaultResourceSchema.parse(resource)) : [],
      ...(next === undefined ? {} : { nextCursor: next }),
      changeCursor,
    };
  }

  async function resource(kind: string, resourceId: string): Promise<ContentVaultResource | undefined> {
    const response = await fetch(`${baseUrl}/v1/vault/resources/${encodeURIComponent(kind)}/${encodeURIComponent(resourceId)}`, {
      headers: { authorization: `Bearer ${input.token}` },
    });
    if (response.status === 404) return undefined;
    const body = await readResponse(response);
    return contentVaultResourceSchema.parse(body.resource);
  }

  async function usage(): Promise<ContentVaultUsage> {
    const body = await requestJson(fetch, `${baseUrl}/v1/vault/usage`, input.token);
    const usage = body.usage;
    if (typeof usage !== "object" || usage === null) throw new Error("Content Vault usage is invalid");
    const value = usage as Record<string, unknown>;
    return {
      contentBytes: numberField(value.contentBytes, 0),
      contentLimitBytes: numberField(value.contentLimitBytes, 0),
      activeResources: numberField(value.activeResources, 0),
      resourceLimit: numberField(value.resourceLimit, 0),
    };
  }

  return { mutate, changes, snapshot, resource, usage };
}

async function requestJson(
  fetch: typeof globalThis.fetch,
  url: string,
  token: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init?.headers ?? {}), ...(init?.body === undefined ? {} : { "content-type": "application/json" }) },
  });
  return readResponse(response);
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json() as unknown;
  if (!response.ok) {
    const value = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
    const error = typeof value.error === "object" && value.error !== null ? value.error as Record<string, unknown> : {};
    throw new Error(typeof error.message === "string" ? error.message : `Content Vault request failed (${response.status})`);
  }
  if (typeof body !== "object" || body === null) throw new Error("Content Vault response is invalid");
  return body as Record<string, unknown>;
}

function numberField(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function requiredNonnegativeInteger(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(message);
  return value;
}

function snapshotCursorField(value: unknown, changeCursor: number): ContentVaultSnapshotCursor | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const kind = contentVaultResourceKindSchema.safeParse(candidate.afterKind);
  if (candidate.changeCursor !== changeCursor
    || !kind.success
    || typeof candidate.afterResourceId !== "string") return undefined;
  return {
    changeCursor,
    afterKind: kind.data,
    afterResourceId: candidate.afterResourceId,
  };
}
