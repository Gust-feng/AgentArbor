import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { SpaceFeatureError, SpaceReference, SpaceTarget, SpaceTreeEntry } from "../spaces/index.js";
import { PanelHttpError, readJsonBody, writeJson } from "./http-utils.js";
import type { PanelRuntime } from "./runtime.js";

const titleSchema = z.string().trim().min(1).max(160);
const referenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local_file"), path: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("workspace_folder"), path: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("web_page"), url: z.string().url() }).strict(),
  z.object({ kind: z.literal("generated_artifact"), artifactRef: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("conversation"), conversationId: z.string().min(1), conversationTitle: z.string().min(1).optional() }).strict(),
]);

const createFolderSchema = z.object({ parentFolderId: z.string().min(1).optional(), title: titleSchema }).strict();
const addReferenceSchema = z.object({ parentFolderId: z.string().min(1).optional(), title: titleSchema, reference: referenceSchema }).strict();
const renameSchema = z.object({ title: titleSchema }).strict();
const moveSchema = z.object({
  target: z.object({ kind: z.enum(["folder", "reference"]), id: z.string().min(1) }).strict(),
  destinationSpaceId: z.string().min(1),
  destinationFolderId: z.string().min(1).optional(),
}).strict();

/** HTTP adapter for SpaceFeature. It never resolves or mutates referenced external resources. */
export async function handlePanelSpaceRoute(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  const feature = runtime.spaceFeature;

  if (url.pathname === "/api/spaces") {
    if (request.method === "GET") {
      writeJson(response, 200, { ok: true, spaces: await feature.queries.list() });
      return true;
    }
    if (request.method === "POST") {
      const input = parse(createSpaceSchema, await readJsonBody(request), "空间名称无效。");
      writeJson(response, 201, { ok: true, space: await feature.commands.createSpace(input) });
      return true;
    }
    return false;
  }

  const treeMatch = /^\/api\/spaces\/([^/]+)$/u.exec(url.pathname);
  if (treeMatch !== null && request.method === "GET") {
    const spaceId = decode(treeMatch[1]);
    const tree = await feature.queries.getTree(spaceId);
    if (tree === undefined) throw new PanelHttpError(404, "space_not_found", "未找到空间。");
    writeJson(response, 200, { ok: true, tree });
    return true;
  }

  const folderMatch = /^\/api\/spaces\/([^/]+)\/folders$/u.exec(url.pathname);
  if (folderMatch !== null && request.method === "POST") {
    const input = parse(createFolderSchema, await readJsonBody(request), "空间文件夹信息无效。");
    writeJson(response, 201, { ok: true, folder: await feature.commands.createFolder({ ...input, spaceId: decode(folderMatch[1]) }) });
    return true;
  }

  const referenceMatch = /^\/api\/spaces\/([^/]+)\/references$/u.exec(url.pathname);
  if (referenceMatch !== null && request.method === "POST") {
    const input = parse(addReferenceSchema, await readJsonBody(request), "空间引用信息无效。");
    writeJson(response, 201, {
      ok: true,
      item: await feature.commands.addReference({ ...input, spaceId: decode(referenceMatch[1]), reference: input.reference as SpaceReference }),
    });
    return true;
  }

  const moveMatch = /^\/api\/spaces\/([^/]+)\/move$/u.exec(url.pathname);
  if (moveMatch !== null && request.method === "POST") {
    const sourceSpaceId = decode(moveMatch[1]);
    const input = parse(moveSchema, await readJsonBody(request), "空间移动信息无效。");
    const tree = await feature.queries.getTree(sourceSpaceId);
    if (tree === undefined) throw new PanelHttpError(404, "space_not_found", "未找到空间。");
    if (!treeContainsTarget(tree.entries, input.target)) {
      throw new PanelHttpError(409, "space_invalid_move", "移动目标不属于源空间。");
    }
    await feature.commands.move(input);
    writeJson(response, 200, { ok: true });
    return true;
  }

  const spaceRename = /^\/api\/spaces\/([^/]+)\/rename$/u.exec(url.pathname);
  if (spaceRename !== null && request.method === "POST") {
    const input = parse(renameSchema, await readJsonBody(request), "空间名称无效。");
    const target: SpaceTarget = { kind: "space", id: decode(spaceRename[1]) };
    writeJson(response, 200, { ok: true, target: await feature.commands.rename({ target, ...input }) });
    return true;
  }

  const entryRename = /^\/api\/spaces\/(folders|references)\/([^/]+)\/rename$/u.exec(url.pathname);
  if (entryRename !== null && request.method === "POST") {
    const input = parse(renameSchema, await readJsonBody(request), "空间名称无效。");
    const target: SpaceTarget = { kind: entryRename[1] === "folders" ? "folder" : "reference", id: decode(entryRename[2]) };
    writeJson(response, 200, { ok: true, target: await feature.commands.rename({ target, ...input }) });
    return true;
  }

  const removeReference = /^\/api\/spaces\/references\/([^/]+)$/u.exec(url.pathname);
  if (removeReference !== null && request.method === "DELETE") {
    await feature.commands.removeReference(decode(removeReference[1]));
    await runtime.flushSpaceKnowledgeSync();
    writeJson(response, 200, { ok: true });
    return true;
  }

  const openReference = /^\/api\/spaces\/references\/([^/]+)\/open$/u.exec(url.pathname);
  if (openReference !== null && request.method === "POST") {
    const item = await feature.queries.getReference(decode(openReference[1]));
    if (item === undefined) throw new PanelHttpError(404, "space_reference_not_found", "未找到空间引用。");
    if (runtime.externalResourceOpener === undefined) {
      throw new PanelHttpError(501, "external_resource_open_unavailable", "当前运行方式不支持打开外部资源。");
    }
    if (item.reference.kind === "local_file" || item.reference.kind === "workspace_folder") {
      await runtime.externalResourceOpener({ kind: "path", value: item.reference.path });
    } else if (item.reference.kind === "web_page") {
      await runtime.externalResourceOpener({ kind: "url", value: item.reference.url });
    } else {
      throw new PanelHttpError(409, "space_reference_not_openable", "这个引用需要由它的来源功能打开。");
    }
    writeJson(response, 200, { ok: true });
    return true;
  }

  return false;
}

function treeContainsTarget(entries: readonly SpaceTreeEntry[], target: { readonly kind: "folder" | "reference"; readonly id: string }): boolean {
  return entries.some((entry) => {
    if (entry.kind === target.kind && (entry.kind === "folder" ? entry.folder.id : entry.item.id) === target.id) return true;
    return entry.kind === "folder" && treeContainsTarget(entry.children, target);
  });
}

const createSpaceSchema = z.object({ title: titleSchema }).strict();

function parse<T>(schema: z.ZodType<T>, raw: unknown, message: string): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new PanelHttpError(400, "invalid_space_input", message);
  return result.data;
}

function decode(value: string | undefined): string {
  return decodeURIComponent(value ?? "");
}

export function spaceFeatureHttpError(error: SpaceFeatureError): PanelHttpError {
  switch (error.code) {
    case "space_feature_released":
      return new PanelHttpError(503, "panel_runtime_quiescing", "面板正在关闭，不能接受新的请求。");
    case "space_not_found":
    case "space_folder_not_found":
    case "space_reference_not_found":
    case "space_parent_not_found":
      return new PanelHttpError(404, error.code, error.message);
    case "space_invalid_move":
    case "space_id_collision":
      return new PanelHttpError(409, error.code, error.message);
    case "space_invalid_input":
      return new PanelHttpError(400, error.code, error.message);
    case "space_snapshot_incompatible":
    case "space_repository_failure":
      return new PanelHttpError(500, error.code, error.message);
  }
}
