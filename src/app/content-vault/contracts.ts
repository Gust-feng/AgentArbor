import { z } from "zod";

export const CONTENT_VAULT_PROTOCOL_VERSION = "content-vault/v1" as const;
// Managed text is transferred as one integrity-checked resource. Keep the
// bound large enough for normal project documents while preserving bounded
// request and IndexedDB sizes.
export const CONTENT_VAULT_MAX_INLINE_BYTES = 5 * 1_024 * 1_024;
export const CONTENT_VAULT_MAX_BATCH_MUTATIONS = 100;

const stableIdSchema = z.string().trim().min(1).max(512);
const isoDateSchema = z.iso.datetime({ offset: true });
const contentHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const relativePathSchema = z.string().trim().min(1).max(512).superRefine((value, context) => {
  const normalized = value.replace(/\\/gu, "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/u.test(normalized)) {
    context.addIssue({ code: "custom", message: "managed file paths must be relative" });
  }
  if (normalized.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    context.addIssue({ code: "custom", message: "managed file paths must not escape their managed root" });
  }
});

export const contentVaultResourceKindSchema = z.enum([
  "space",
  "space_reference",
  "personal_note",
  "knowledge_page",
  "knowledge_link",
  "knowledge_theme",
  "knowledge_assignment",
  "workbench_asset",
  "managed_root",
  "managed_file",
  "agent_notebook",
]);
export type ContentVaultResourceKind = z.infer<typeof contentVaultResourceKindSchema>;

const spaceReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("asset_folder") }).strict(),
  z.object({ kind: z.literal("workbench_asset"), assetId: stableIdSchema }).strict(),
  z.object({ kind: z.literal("managed_root"), managedRootId: stableIdSchema }).strict(),
]);

const payloadSchemas = {
  space: z.object({ title: z.string().trim().min(1).max(160), createdAt: isoDateSchema, updatedAt: isoDateSchema }).strict(),
  space_reference: z.object({
    spaceId: stableIdSchema,
    title: z.string().trim().min(1).max(160),
    parentId: stableIdSchema.optional(),
    reference: spaceReferenceSchema,
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  }).strict(),
  personal_note: z.object({
    spaceId: stableIdSchema,
    title: z.string().max(500),
    bodyMarkdown: z.string().max(CONTENT_VAULT_MAX_INLINE_BYTES),
    materialRefs: z.array(stableIdSchema).max(1_000),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    sourceRevision: z.number().int().positive(),
  }).strict(),
  knowledge_page: z.object({
    refId: stableIdSchema,
    kind: z.enum(["note", "material", "space_reference"]),
    collectedAt: z.number().int().nonnegative(),
    asset: z.object({
      status: z.literal("managed"),
      title: z.string().max(500),
      sourceLabel: z.string().max(500),
      contentKind: z.enum(["file", "directory"]),
      sourceReferenceId: stableIdSchema,
      sourceRelativePath: relativePathSchema,
    }).strict().optional(),
  }).strict(),
  knowledge_link: z.object({ from: stableIdSchema, to: stableIdSchema }).strict(),
  knowledge_theme: z.object({
    name: z.string().trim().min(1).max(160),
    color: z.string().trim().min(1).max(80),
    origin: z.enum(["agent", "user"]),
  }).strict(),
  knowledge_assignment: z.object({
    refId: stableIdSchema,
    themeId: stableIdSchema,
    by: z.enum(["agent", "user"]),
    locked: z.boolean(),
  }).strict(),
  workbench_asset: z.object({
    title: z.string().trim().min(1).max(500),
    kind: z.enum(["markdown", "code"]),
    text: z.string().max(CONTENT_VAULT_MAX_INLINE_BYTES),
    language: z.string().max(80),
  }).strict(),
  managed_root: z.object({ spaceId: stableIdSchema, title: z.string().trim().min(1).max(160) }).strict(),
  managed_file: z.object({
    managedRootId: stableIdSchema,
    relativePath: relativePathSchema,
    text: z.string().max(CONTENT_VAULT_MAX_INLINE_BYTES),
  }).strict(),
  agent_notebook: z.object({
    notebookId: stableIdSchema,
    label: z.string().trim().min(1).max(160),
    scope: z.literal("global"),
    content: z.string().max(20_000),
    updatedAt: isoDateSchema.optional(),
  }).strict(),
} satisfies Record<ContentVaultResourceKind, z.ZodType>;

const mutationBase = {
  protocolVersion: z.literal(CONTENT_VAULT_PROTOCOL_VERSION),
  mutationId: stableIdSchema,
  kind: contentVaultResourceKindSchema,
  resourceId: stableIdSchema,
  baseRevision: z.number().int().nonnegative(),
};

const upsertMutationSchema = z.object({
  ...mutationBase,
  operation: z.literal("upsert"),
  payloadSchemaVersion: z.literal(1),
  payload: z.record(z.string(), z.unknown()),
  contentHash: contentHashSchema,
}).strict().superRefine((value, context) => {
  const parsed = payloadSchemas[value.kind].safeParse(value.payload);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      context.addIssue({ ...issue, path: ["payload", ...issue.path] });
    }
  }
});

const deleteMutationSchema = z.object({
  ...mutationBase,
  operation: z.literal("delete"),
}).strict();

export const contentVaultMutationSchema = z.union([upsertMutationSchema, deleteMutationSchema]);
export type ContentVaultMutation = z.infer<typeof contentVaultMutationSchema>;

export const contentVaultMutationBatchSchema = z.object({
  protocolVersion: z.literal(CONTENT_VAULT_PROTOCOL_VERSION),
  mutations: z.array(contentVaultMutationSchema).min(1).max(CONTENT_VAULT_MAX_BATCH_MUTATIONS),
}).strict();

export type ContentVaultResource = {
  readonly kind: ContentVaultResourceKind;
  readonly resourceId: string;
  readonly revision: number;
  readonly deleted: boolean;
  readonly payloadSchemaVersion: 1;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly contentHash: string;
  readonly contentBytes: number;
  readonly updatedAt: string;
  readonly updatedByDeviceId: string;
};

export const contentVaultResourceSchema = z.object({
  kind: contentVaultResourceKindSchema,
  resourceId: stableIdSchema,
  revision: z.number().int().positive(),
  deleted: z.boolean(),
  payloadSchemaVersion: z.literal(1),
  payload: z.record(z.string(), z.unknown()).optional(),
  contentHash: contentHashSchema,
  contentBytes: z.number().int().nonnegative(),
  updatedAt: isoDateSchema,
  updatedByDeviceId: stableIdSchema,
}).strict().superRefine((value, context) => {
  if (value.deleted) {
    if (value.payload !== undefined) context.addIssue({ code: "custom", path: ["payload"], message: "deleted resources must not include payload" });
    return;
  }
  if (value.payload === undefined) {
    context.addIssue({ code: "custom", path: ["payload"], message: "active resources require payload" });
    return;
  }
  const parsed = payloadSchemas[value.kind].safeParse(value.payload);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) context.addIssue({ ...issue, path: ["payload", ...issue.path] });
  }
});

export type ContentVaultMutationResult =
  | { readonly status: "applied"; readonly mutationId: string; readonly cursor: number; readonly resource: ContentVaultResource }
  | {
      readonly status: "conflict";
      readonly mutationId: string;
      readonly reason: "resource_not_found" | "revision_mismatch" | "resource_deleted";
      readonly current?: ContentVaultResource;
    };

export type ContentVaultChange = { readonly cursor: number; readonly resource: ContentVaultResource };

/**
 * A snapshot is pinned to one change cursor and paged by the last stable
 * resource identity. This prevents concurrent inserts or deletes from moving
 * OFFSET pages and leaving a first-time client with an incomplete cache.
 */
export type ContentVaultSnapshotCursor =
  | { readonly changeCursor: number }
  | {
      readonly changeCursor: number;
      readonly afterKind: ContentVaultResourceKind;
      readonly afterResourceId: string;
    };

export const contentVaultMutationResultSchema = z.union([
  z.object({ status: z.literal("applied"), mutationId: stableIdSchema, cursor: z.number().int().positive(), resource: contentVaultResourceSchema }).strict(),
  z.object({
    status: z.literal("conflict"),
    mutationId: stableIdSchema,
    reason: z.enum(["resource_not_found", "revision_mismatch", "resource_deleted"]),
    current: contentVaultResourceSchema.optional(),
  }).strict(),
]);

export const contentVaultChangeSchema = z.object({ cursor: z.number().int().positive(), resource: contentVaultResourceSchema }).strict();

export type ContentVaultUsage = {
  readonly contentBytes: number;
  readonly contentLimitBytes: number;
  readonly activeResources: number;
  readonly resourceLimit: number;
};

export function parseContentVaultMutation(value: unknown): ContentVaultMutation {
  return contentVaultMutationSchema.parse(value);
}

export function parseContentVaultPayload(
  kind: ContentVaultResourceKind,
  value: unknown,
): Readonly<Record<string, unknown>> {
  return payloadSchemas[kind].parse(value) as Readonly<Record<string, unknown>>;
}

export function canonicalContentVaultJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

export function canonicalManagedFileIdentity(input: {
  readonly managedRootId: string;
  readonly relativePath: string;
}): string {
  const managedRootId = stableIdSchema.parse(input.managedRootId);
  const relativePath = relativePathSchema.parse(input.relativePath).replace(/\\/gu, "/");
  return canonicalContentVaultJson([managedRootId, relativePath]);
}

export function managedFileResourceIdFromSha256(digest: string): string {
  if (!/^[a-f0-9]{64}$/u.test(digest)) throw new Error("Managed file identity requires a SHA-256 hex digest");
  return `managed-file-${digest}`;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJsonValue(child)]));
  }
  return value;
}
