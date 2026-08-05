import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { z } from "zod";
import type { DocumentTextUpdateInput } from "../panel-api-contracts.js";
import type { SpaceFeatureError, SpaceReference, SpaceTarget } from "../spaces/index.js";
import { PanelHttpError, readJsonBody, writeJson } from "./http-utils.js";
import type { PanelRuntime } from "./runtime.js";
import { createManagedSpaceFolder, deleteManagedSpaceFolder } from "./space-managed-folder-store.js";
import { reconcileSpaceReferenceAvailability } from "./space-reference-availability.js";
import { spaceReferenceMutationKey } from "./space-reference-deletion.js";
import { createPanelDocumentPreview, writePanelSpaceReferenceContent } from "./space-reference-preview.js";
import { getWorkbenchAssetPreview, updateWorkbenchAssetTextPreview } from "./workbench-asset-routes.js";
import { createPanelSpaceReferenceEntry, deletePanelSpaceReferenceEntry, renamePanelSpaceReferenceEntry, updatePanelSpaceReferenceText } from "./space-reference-mutations.js";

const titleSchema = z.string().trim().min(1).max(160);
const referenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local_file"), path: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("workspace_folder"), path: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("web_page"), url: z.string().url() }).strict(),
  z.object({ kind: z.literal("generated_artifact"), artifactRef: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("conversation"), conversationId: z.string().min(1), conversationTitle: z.string().min(1).optional() }).strict(),
]);

const createFolderSchema = z.object({ title: titleSchema }).strict();
const addReferenceSchema = z.object({ title: titleSchema, reference: referenceSchema }).strict();
const renameSchema = z.object({ title: titleSchema }).strict();
const moveSchema = z.object({
  target: z.object({ kind: z.literal("reference"), id: z.string().min(1) }).strict(),
  destinationSpaceId: z.string().min(1),
}).strict();
const updateTextSchema: z.ZodType<DocumentTextUpdateInput> = z.object({
  relativePath: z.string().max(4_096).optional(),
  expectedFingerprint: z.string().min(1).max(512),
  text: z.string().max(512 * 1024),
}).strict();
const referenceEntrySchema = z.object({ relativePath: z.string().min(1).max(4_096) }).strict();
const renameReferenceEntrySchema = referenceEntrySchema.extend({ name: z.string().trim().min(1).max(255) }).strict();
const createReferenceEntrySchema = z.object({
  parentRelativePath: z.string().max(4_096),
  name: z.string().trim().min(1).max(255),
  kind: z.enum(["file", "directory"]),
}).strict();

/** HTTP adapter for SpaceFeature and explicitly authorized local reference operations. */
export async function handlePanelSpaceRoute(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  const feature = runtime.spaceFeature;

  if (url.pathname === "/api/spaces") {
    if (request.method === "GET") {
      await runtime.ensureInitialWorkbenchData();
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
    await runtime.ensureInitialWorkbenchData();
    const spaceId = decode(treeMatch[1]);
    const known = await feature.queries.getTree(spaceId);
    if (known === undefined) throw new PanelHttpError(404, "space_not_found", "未找到空间。");
    await reconcileSpaceReferenceAvailability(feature, known.entries.map((entry) => entry.item));
    const tree = await feature.queries.getTree(spaceId);
    writeJson(response, 200, { ok: true, tree });
    return true;
  }
  if (treeMatch !== null && request.method === "DELETE") {
    await feature.commands.deleteSpace(decode(treeMatch[1]));
    await runtime.flushSpaceKnowledgeSync();
    writeJson(response, 200, { ok: true });
    return true;
  }

  const managedFolderMatch = /^\/api\/spaces\/([^/]+)\/managed-folders$/u.exec(url.pathname);
  if (managedFolderMatch !== null && request.method === "POST") {
    const input = parse(createFolderSchema, await readJsonBody(request), "空间文件夹信息无效。");
    const item = await runtime.fileMutationCoordinator.run(runtime.managedSpaceFolderRoot, async () => {
      const folder = await createManagedSpaceFolder(runtime.managedSpaceFolderRoot);
      try {
        return await feature.commands.addReference({
          ...input,
          spaceId: decode(managedFolderMatch[1]),
          reference: { kind: "managed_folder", path: folder },
        });
      } catch (error) {
        await deleteManagedSpaceFolder(runtime.managedSpaceFolderRoot, folder).catch(() => undefined);
        throw error;
      }
    });
    writeJson(response, 201, { ok: true, item });
    return true;
  }

  const referenceMatch = /^\/api\/spaces\/([^/]+)\/references$/u.exec(url.pathname);
  if (referenceMatch !== null && request.method === "POST") {
    const input = parse(addReferenceSchema, await readJsonBody(request), "空间引用信息无效。");
    const reference = absoluteLocalReference(input.reference as SpaceReference);
    writeJson(response, 201, {
      ok: true,
      item: await feature.commands.addReference({ ...input, spaceId: decode(referenceMatch[1]), reference }),
    });
    return true;
  }

  const moveMatch = /^\/api\/spaces\/([^/]+)\/move$/u.exec(url.pathname);
  if (moveMatch !== null && request.method === "POST") {
    const sourceSpaceId = decode(moveMatch[1]);
    const input = parse(moveSchema, await readJsonBody(request), "空间移动信息无效。");
    const tree = await feature.queries.getTree(sourceSpaceId);
    if (tree === undefined) throw new PanelHttpError(404, "space_not_found", "未找到空间。");
    if (!tree.entries.some((entry) => entry.item.id === input.target.id)) {
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

  const entryRename = /^\/api\/spaces\/references\/([^/]+)\/rename$/u.exec(url.pathname);
  if (entryRename !== null && request.method === "POST") {
    const input = parse(renameSchema, await readJsonBody(request), "空间名称无效。");
    const target: SpaceTarget = { kind: "reference", id: decode(entryRename[1]) };
    writeJson(response, 200, { ok: true, target: await feature.commands.rename({ target, ...input }) });
    return true;
  }

  const removeReference = /^\/api\/spaces\/references\/([^/]+)$/u.exec(url.pathname);
  if (removeReference !== null && request.method === "DELETE") {
    const itemId = decode(removeReference[1]);
    await feature.commands.removeReference(itemId);
    await runtime.flushSpaceKnowledgeSync();
    writeJson(response, 200, { ok: true });
    return true;
  }

  const unlinkReference = /^\/api\/spaces\/references\/([^/]+)\/unlink$/u.exec(url.pathname);
  if (unlinkReference !== null && request.method === "POST") {
    const itemId = decode(unlinkReference[1]);
    await feature.commands.unlinkReference(itemId);
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

  const previewReference = /^\/api\/spaces\/references\/([^/]+)\/preview$/u.exec(url.pathname);
  if (previewReference !== null && request.method === "GET") {
    const item = await feature.queries.getReference(decode(previewReference[1]));
    if (item === undefined) throw new PanelHttpError(404, "space_reference_not_found", "未找到空间引用。");
    const preview = item.reference.kind === "workbench_asset"
      ? await getWorkbenchAssetPreview(runtime.workbenchAssets, item.reference.assetId, item.id)
      : await createPanelDocumentPreview(item, url.searchParams.get("path") ?? "");
    writeJson(response, 200, { ok: true, preview });
    return true;
  }

  const referenceContent = /^\/api\/spaces\/references\/([^/]+)\/content$/u.exec(url.pathname);
  if (referenceContent !== null && request.method === "GET") {
    const item = await feature.queries.getReference(decode(referenceContent[1]));
    if (item === undefined) throw new PanelHttpError(404, "space_reference_not_found", "未找到空间引用。");
    await writePanelSpaceReferenceContent(item, request, response, url.searchParams.get("path") ?? "");
    return true;
  }
  if (referenceContent !== null && request.method === "PUT") {
    const item = await feature.queries.getReference(decode(referenceContent[1]));
    if (item === undefined) throw new PanelHttpError(404, "space_reference_not_found", "未找到空间引用。");
    const input = parse(updateTextSchema, await readJsonBody(request), "引用文件内容无效。");
    if (item.reference.kind === "workbench_asset") {
      writeJson(response, 200, { ok: true, preview: await updateWorkbenchAssetTextPreview(
        runtime.workbenchAssets,
        { assetId: item.reference.assetId, expectedFingerprint: input.expectedFingerprint, text: input.text },
        item.id,
      ) });
      return true;
    }
    writeJson(response, 200, { ok: true, preview: await runtime.fileMutationCoordinator.run(spaceReferenceMutationKey(item), () => updatePanelSpaceReferenceText(item, input)) });
    return true;
  }

  const referenceEntry = /^\/api\/spaces\/references\/([^/]+)\/entry$/u.exec(url.pathname);
  if (referenceEntry !== null && request.method === "POST") {
    const item = await feature.queries.getReference(decode(referenceEntry[1]));
    if (item === undefined) throw new PanelHttpError(404, "space_reference_not_found", "未找到空间引用。");
    const input = parse(createReferenceEntrySchema, await readJsonBody(request), "新建文件信息无效。");
    writeJson(response, 201, { ok: true, entry: await runtime.fileMutationCoordinator.run(spaceReferenceMutationKey(item), () => createPanelSpaceReferenceEntry(item, input)) });
    return true;
  }
  if (referenceEntry !== null && request.method === "PATCH") {
    const item = await feature.queries.getReference(decode(referenceEntry[1]));
    if (item === undefined) throw new PanelHttpError(404, "space_reference_not_found", "未找到空间引用。");
    const input = parse(renameReferenceEntrySchema, await readJsonBody(request), "文件重命名信息无效。");
    writeJson(response, 200, { ok: true, entry: await runtime.fileMutationCoordinator.run(spaceReferenceMutationKey(item), () => renamePanelSpaceReferenceEntry(item, input)) });
    return true;
  }
  if (referenceEntry !== null && request.method === "DELETE") {
    const item = await feature.queries.getReference(decode(referenceEntry[1]));
    if (item === undefined) throw new PanelHttpError(404, "space_reference_not_found", "未找到空间引用。");
    const input = parse(referenceEntrySchema, await readJsonBody(request), "文件删除信息无效。");
    await runtime.fileMutationCoordinator.run(spaceReferenceMutationKey(item), () => deletePanelSpaceReferenceEntry(item, input.relativePath));
    writeJson(response, 200, { ok: true });
    return true;
  }

  return false;
}

function absoluteLocalReference(reference: SpaceReference): SpaceReference {
  return reference.kind === "local_file" || reference.kind === "workspace_folder"
    ? { ...reference, path: path.resolve(reference.path) }
    : reference;
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
    case "space_reference_not_found":
      return new PanelHttpError(404, error.code, error.message);
    case "space_invalid_move":
    case "space_id_collision":
    case "space_workspace_mount_conflict":
    case "space_conversation_ownership_conflict":
      return new PanelHttpError(409, error.code, error.message);
    case "space_invalid_input":
      return new PanelHttpError(400, error.code, error.message);
    case "space_snapshot_incompatible":
    case "space_deletion_journal_failure":
    case "space_deletion_recovery_failed":
    case "space_repository_failure":
      return new PanelHttpError(500, error.code, error.message);
  }
}
