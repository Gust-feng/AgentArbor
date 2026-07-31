import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import type { PersonalNoteRevision } from "../panel-api-contracts.js";
import { PersonalKnowledgeError, type PersonalKnowledgeCommand } from "../personal-knowledge/index.js";
import { PanelHttpError, readJsonBody, writeJson } from "./http-utils.js";
import type { PanelRuntime } from "./runtime.js";
import { managedKnowledgeReference } from "./knowledge-asset-store.js";
import type { SpaceReferenceItem } from "../spaces/index.js";
import {
  buildLocalReferencePreview,
  streamLocalReferenceContent,
  updateLocalReferenceText,
  type LocalReferenceMeta,
} from "./local-reference-preview.js";
import { createWorkbenchAssetTextPreview } from "./workbench-asset-routes.js";

const id = z.string().trim().min(1).max(512);
const timestamp = z.number().int().nonnegative();
const pageKind = z.enum(["note", "material", "space_reference"]);
const origin = z.enum(["agent", "user"]);
const actor = z.enum(["agent", "user"]);

const createNoteSchema = z.object({
  id: id.optional(),
  spaceId: id,
  title: z.string().max(1_000).optional(),
  bodyMarkdown: z.string().max(10_000_000).optional(),
  materialRefs: z.array(id).max(10_000).optional(),
}).strict();

const updateNoteSchema = z.object({
  expectedRevision: z.number().int().positive(),
  title: z.string().max(1_000).optional(),
  bodyMarkdown: z.string().max(10_000_000).optional(),
}).strict().refine((value) => value.title !== undefined || value.bodyMarkdown !== undefined, "No note fields were provided.");

const updateAssetTextSchema = z.object({
  relativePath: z.string().max(4_096).optional(),
  expectedFingerprint: z.string().min(1).max(512),
  text: z.string().max(512 * 1024),
}).strict();

const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("knowledge.collect"), page: z.object({ refId: id, kind: pageKind, collectedAt: timestamp }).strict() }).strict(),
  z.object({ type: z.literal("knowledge.uncollect"), refId: id }).strict(),
  z.object({ type: z.literal("knowledge.link_add"), link: z.object({ from: id, to: id }).strict() }).strict(),
  z.object({ type: z.literal("knowledge.link_remove"), link: z.object({ from: id, to: id }).strict() }).strict(),
  z.object({ type: z.literal("knowledge.opened"), refId: id, openedAt: timestamp }).strict(),
  z.object({ type: z.literal("theme.create"), theme: z.object({ id, name: z.string().trim().min(1).max(200), color: z.string().min(1).max(100), origin }).strict() }).strict(),
  z.object({ type: z.literal("theme.rename"), themeId: id, name: z.string().trim().min(1).max(200) }).strict(),
  z.object({ type: z.literal("theme.delete"), themeId: id }).strict(),
  z.object({ type: z.literal("theme.merge"), fromId: id, toId: id }).strict(),
  z.object({ type: z.literal("theme.assign"), assignment: z.object({ refId: id, themeId: id, by: actor, locked: z.boolean() }).strict() }).strict(),
  z.object({ type: z.literal("theme.unassign"), refId: id, themeId: id }).strict(),
  z.object({ type: z.literal("theme.toggle_lock"), refId: id, themeId: id }).strict(),
]);

export async function handlePanelPersonalKnowledgeRoute(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  const feature = runtime.personalKnowledgeFeature;
  if (url.pathname === "/api/personal-knowledge/search" && request.method === "GET") {
    await runtime.ensureInitialWorkbenchData();
    const query = url.searchParams.get("q")?.trim();
    const spaceId = url.searchParams.get("spaceId")?.trim() || undefined;
    const limitValue = url.searchParams.get("limit");
    const limit = limitValue === null ? undefined : Number(limitValue);
    if (query === undefined || query.length === 0 || query.length > 1_000
      || (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100))) {
      throw invalidInput();
    }
    writeJson(response, 200, {
      ok: true,
      results: await feature.queries.search({ query, spaceId, limit }),
    });
    return true;
  }
  if (url.pathname === "/api/personal-knowledge" && request.method === "GET") {
    await runtime.ensureInitialWorkbenchData();
    const snapshot = await feature.queries.snapshot();
    const materialIds = new Set(snapshot.pages.filter((page) => page.kind === "material").map((page) => page.refId));
    const materialPreviews = (await runtime.workbenchAssets.list())
      .filter((asset) => materialIds.has(asset.id))
      .map((asset) => createWorkbenchAssetTextPreview(asset));
    writeJson(response, 200, { ok: true, snapshot, materialPreviews });
    return true;
  }
  if (url.pathname === "/api/personal-knowledge/collect-space-reference" && request.method === "POST") {
    const input = parse(z.object({ referenceId: id, relativePath: z.string().max(4_096).optional() }).strict(), await readJsonBody(request));
    const page = await feature.commands.collectSpaceReference(input);
    writeJson(response, 201, { ok: true, page });
    return true;
  }
  const assetPreview = /^\/api\/personal-knowledge\/assets\/([^/]+)\/preview$/u.exec(url.pathname);
  if (assetPreview !== null && request.method === "GET") {
    await runtime.knowledgeAssetsReady;
    const refId = decode(assetPreview[1]);
    const page = (await feature.queries.snapshot()).pages.find((candidate) => candidate.refId === refId);
    if (page === undefined) throw new PanelHttpError(404, "knowledge_asset_not_found", "知识条目已不存在。");
    const { rootDir, meta } = localReferenceInfo(managedKnowledgeReference(requireAssetRoot(runtime), page));
    writeJson(response, 200, { ok: true, preview: await buildLocalReferencePreview(
      rootDir,
      url.searchParams.get("path") ?? "",
      meta,
      {
        contentBaseUrl: `/api/personal-knowledge/assets/${encodeURIComponent(refId)}/content`,
        contentTypeHintPath: page.asset?.sourceLabel,
      },
    ) });
    return true;
  }
  const assetContent = /^\/api\/personal-knowledge\/assets\/([^/]+)\/content$/u.exec(url.pathname);
  if (assetContent !== null && request.method === "GET") {
    await runtime.knowledgeAssetsReady;
    const refId = decode(assetContent[1]);
    const page = (await feature.queries.snapshot()).pages.find((candidate) => candidate.refId === refId);
    if (page === undefined) throw new PanelHttpError(404, "knowledge_asset_not_found", "知识条目已不存在。");
    const { rootDir } = localReferenceInfo(managedKnowledgeReference(requireAssetRoot(runtime), page));
    await streamLocalReferenceContent(
      rootDir,
      url.searchParams.get("path") ?? "",
      request,
      response,
      page.asset?.sourceLabel,
    );
    return true;
  }
  if (assetContent !== null && request.method === "PUT") {
    await runtime.knowledgeAssetsReady;
    const refId = decode(assetContent[1]);
    const page = (await feature.queries.snapshot()).pages.find((candidate) => candidate.refId === refId);
    if (page === undefined) throw new PanelHttpError(404, "knowledge_asset_not_found", "知识条目已不存在。");
    const { rootDir, meta, mutationKey } = localReferenceInfo(managedKnowledgeReference(requireAssetRoot(runtime), page));
    const input = parse(updateAssetTextSchema, await readJsonBody(request));
    const contentBaseUrl = `/api/personal-knowledge/assets/${encodeURIComponent(refId)}/content`;
    writeJson(response, 200, {
      ok: true,
      preview: await runtime.fileMutationCoordinator.run(mutationKey, async () =>
        await updateLocalReferenceText(
          rootDir,
          input.relativePath ?? "",
          { expectedFingerprint: input.expectedFingerprint, text: input.text },
          meta,
          { contentBaseUrl, contentTypeHintPath: page.asset?.sourceLabel },
        )),
    });
    return true;
  }
  if (url.pathname === "/api/personal-knowledge/notes" && request.method === "POST") {
    const input = parse(createNoteSchema, await readJsonBody(request));
    writeJson(response, 201, { ok: true, note: await feature.commands.createNote({ ...input, actor: USER_ACTOR }) });
    return true;
  }
  if (url.pathname === "/api/personal-knowledge/notes/reorder" && request.method === "POST") {
    const input = parse(z.object({ orderedIds: z.array(id).max(100_000) }).strict(), await readJsonBody(request));
    await feature.commands.reorderNotes(input.orderedIds);
    writeJson(response, 200, { ok: true });
    return true;
  }
  const noteMatch = /^\/api\/personal-knowledge\/notes\/([^/]+)$/u.exec(url.pathname);
  const revisionsMatch = /^\/api\/personal-knowledge\/notes\/([^/]+)\/revisions$/u.exec(url.pathname);
  if (revisionsMatch !== null && request.method === "GET") {
    const limitValue = url.searchParams.get("limit");
    const limit = limitValue === null ? undefined : Number(limitValue);
    const revisions = await feature.queries.noteRevisions(decode(revisionsMatch[1]), limit) satisfies readonly PersonalNoteRevision[];
    writeJson(response, 200, { ok: true, revisions });
    return true;
  }
  if (noteMatch !== null && request.method === "GET") {
    const note = await feature.queries.note(decode(noteMatch[1]));
    if (note === undefined) throw new PersonalKnowledgeError("personal_note_not_found", "笔记已不存在。");
    writeJson(response, 200, { ok: true, note });
    return true;
  }
  if (noteMatch !== null && request.method === "PATCH") {
    const input = parse(updateNoteSchema, await readJsonBody(request));
    await feature.commands.updateNote({ id: decode(noteMatch[1]), ...input, actor: USER_ACTOR });
    writeJson(response, 200, { ok: true });
    return true;
  }
  if (noteMatch !== null && request.method === "DELETE") {
    const expectedRevision = Number(url.searchParams.get("expectedRevision"));
    if (!Number.isInteger(expectedRevision) || expectedRevision <= 0) throw invalidInput();
    await feature.commands.deleteNote({ id: decode(noteMatch[1]), expectedRevision, actor: USER_ACTOR });
    writeJson(response, 200, { ok: true });
    return true;
  }
  if (url.pathname === "/api/personal-knowledge/commands" && request.method === "POST") {
    const command = parse(commandSchema, await readJsonBody(request)) as PersonalKnowledgeCommand;
    if (command.type === "knowledge.uncollect") await feature.commands.uncollect(command.refId);
    else await feature.commands.execute(command as Exclude<PersonalKnowledgeCommand, { readonly type: "note.create" | "note.update" | "note.delete" | "note.reorder" }>);
    writeJson(response, 200, { ok: true });
    return true;
  }
  return false;
}

function requireAssetRoot(runtime: PanelRuntime): string {
  if (runtime.knowledgeAssetRoot === undefined) throw new PanelHttpError(503, "knowledge_asset_storage_unavailable", "知识资产存储不可用。");
  return runtime.knowledgeAssetRoot;
}

/** 从托管知识引用中提取 rootDir、元数据和变更协调键。 */
function localReferenceInfo(item: SpaceReferenceItem): {
  rootDir: string;
  meta: LocalReferenceMeta;
  mutationKey: string;
} {
  if (item.reference.kind !== "local_file" && item.reference.kind !== "workspace_folder") {
    throw new PanelHttpError(404, "knowledge_asset_not_found", "知识资产类型不支持预览。");
  }
  return {
    rootDir: item.reference.path,
    meta: { itemId: item.id, title: item.title, sourceKind: item.reference.kind },
    mutationKey: item.reference.path,
  };
}

const USER_ACTOR = { kind: "user" } as const;

export function personalKnowledgeHttpError(error: PersonalKnowledgeError): PanelHttpError {
  switch (error.code) {
    case "personal_knowledge_released":
      return new PanelHttpError(503, "panel_runtime_quiescing", error.message);
    case "personal_knowledge_invalid_input":
      return new PanelHttpError(400, error.code, error.message);
    case "personal_note_not_found":
    case "knowledge_theme_not_found":
      return new PanelHttpError(404, error.code, error.message);
    case "personal_note_revision_conflict":
      return new PanelHttpError(409, error.code, error.message);
    case "personal_knowledge_repository_failure":
      return new PanelHttpError(500, error.code, error.message);
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw invalidInput();
  return result.data;
}

function invalidInput(): PanelHttpError {
  return new PanelHttpError(400, "invalid_personal_knowledge_input", "个人知识数据无效。");
}

function decode(value: string | undefined): string {
  return decodeURIComponent(value ?? "");
}
