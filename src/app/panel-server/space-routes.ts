import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { z } from "zod";
import type { DocumentTextUpdateInput } from "../panel-api-contracts.js";
import type { SpaceAddableReference, SpaceFeatureError, SpaceReference, SpaceReferenceItem, SpaceTarget } from "../spaces/index.js";
import { spaceExternalReferenceStatus } from "../spaces/index.js";
import { PanelHttpError, readJsonBody, writeJson } from "./http-utils.js";
import type { PanelRuntime } from "./runtime.js";
import { createManagedSpaceFolder, deleteManagedSpaceFolder } from "./space-managed-folder-store.js";
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
    const tree = known;
    // 关联对话是组合根生成的 read-model（ADR-0035 §8.1）：canonical owner 对话为主，
    // v2 旧对话（owner 只存在于 Space 树引用）回退合并，按 conversationId 去重。
    const canonicalConversations = await runtime.ordinaryAgentFeature.queries.listConversationsByOwner({ kind: "space", id: spaceId });
    const legacyIds = new Set(
      tree.entries
        .map((entry) => entry.item.reference)
        .filter((reference): reference is Extract<typeof reference, { readonly kind: "conversation" }> => reference.kind === "conversation")
        .map((reference) => reference.conversationId),
    );
    const canonicalIds = new Set(canonicalConversations.map((conversation) => conversation.conversationId));
    const legacyConversations = await Promise.all(
      [...legacyIds].filter((conversationId) => !canonicalIds.has(conversationId)).map(async (conversationId) => {
        const conversation = await runtime.ordinaryAgentFeature.queries.getConversation(conversationId);
        return conversation === undefined
          ? undefined
          : { conversationId, title: conversation.title, updatedAt: conversation.updatedAt };
      }),
    );
    writeJson(response, 200, {
      ok: true,
      tree,
      conversations: [
        ...canonicalConversations.map((conversation) => ({
          conversationId: conversation.conversationId,
          title: conversation.title,
          updatedAt: conversation.updatedAt,
          pinnedAt: conversation.pinnedAt,
        })),
        ...legacyConversations.filter((item): item is { readonly conversationId: string; readonly title: string; readonly updatedAt: string } => item !== undefined),
      ],
    });
    return true;
  }
  if (treeMatch !== null && request.method === "DELETE") {
    const spaceId = decode(treeMatch[1]);
    if (await feature.queries.getTree(spaceId) === undefined) {
      throw new PanelHttpError(404, "space_not_found", "未找到空间。");
    }
    await runtime.spaceConversationDeletion.deleteSpace(spaceId);
    await runtime.flushSpaceKnowledgeSync();
    writeJson(response, 200, { ok: true });
    return true;
  }

  const managedFolderMatch = /^\/api\/spaces\/([^/]+)\/managed-folders$/u.exec(url.pathname);
  if (managedFolderMatch !== null && request.method === "POST") {
    const spaceId = decode(managedFolderMatch[1]);
    runtime.spaceConversationDeletion.assertAvailable(spaceId);
    const input = parse(createFolderSchema, await readJsonBody(request), "空间文件夹信息无效。");
    const item = await runtime.fileMutationCoordinator.run(runtime.managedSpaceFolderRoot, async () => {
      const folder = await createManagedSpaceFolder(runtime.managedSpaceFolderRoot);
      try {
        return await feature.commands.addReference({
          ...input,
          spaceId,
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
    const spaceId = decode(referenceMatch[1]);
    runtime.spaceConversationDeletion.assertAvailable(spaceId);
    const input = parse(addReferenceSchema, await readJsonBody(request), "空间引用信息无效。");
    const reference = absoluteLocalReference(input.reference);
    writeJson(response, 201, {
      ok: true,
      item: await feature.commands.addReference({ ...input, spaceId, reference }),
    });
    return true;
  }

  const moveMatch = /^\/api\/spaces\/([^/]+)\/move$/u.exec(url.pathname);
  if (moveMatch !== null && request.method === "POST") {
    const sourceSpaceId = decode(moveMatch[1]);
    const input = parse(moveSchema, await readJsonBody(request), "空间移动信息无效。");
    runtime.spaceConversationDeletion.assertAvailable(sourceSpaceId);
    runtime.spaceConversationDeletion.assertAvailable(input.destinationSpaceId);
    const tree = await feature.queries.getTree(sourceSpaceId);
    if (tree === undefined) throw new PanelHttpError(404, "space_not_found", "未找到空间。");
    if (!tree.entries.some((entry) => entry.item.id === input.target.id)) {
      throw new PanelHttpError(409, "space_invalid_move", "移动目标不属于源空间。");
    }
    const item = await feature.queries.getReference(input.target.id);
    if (item === undefined || !isMovableSpaceMaterial(item)) {
      throw new PanelHttpError(409, "space_invalid_move", "外部文件夹、外部文件和 Conversation 不能移动；请在目标空间重新添加外部引用。");
    }
    await feature.commands.move(input);
    writeJson(response, 200, { ok: true });
    return true;
  }

  const spaceRename = /^\/api\/spaces\/([^/]+)\/rename$/u.exec(url.pathname);
  if (spaceRename !== null && request.method === "POST") {
    runtime.spaceConversationDeletion.assertAvailable(decode(spaceRename[1]));
    const input = parse(renameSchema, await readJsonBody(request), "空间名称无效。");
    const target: SpaceTarget = { kind: "space", id: decode(spaceRename[1]) };
    writeJson(response, 200, { ok: true, target: await feature.commands.rename({ target, ...input }) });
    return true;
  }

  const entryRename = /^\/api\/spaces\/references\/([^/]+)\/rename$/u.exec(url.pathname);
  if (entryRename !== null && request.method === "POST") {
    const item = await feature.queries.getReference(decode(entryRename[1]));
    if (item === undefined) throw new PanelHttpError(404, "space_reference_not_found", "未找到空间引用。");
    runtime.spaceConversationDeletion.assertAvailable(item.spaceId);
    if (item.reference.kind === "conversation") {
      throw new PanelHttpError(409, "space_conversation_owner_immutable", "Conversation 只能通过对话操作改名，不能作为普通空间引用改名。");
    }
    const input = parse(renameSchema, await readJsonBody(request), "空间名称无效。");
    const target: SpaceTarget = { kind: "reference", id: decode(entryRename[1]) };
    writeJson(response, 200, { ok: true, target: await feature.commands.rename({ target, ...input }) });
    return true;
  }

  const removeReference = /^\/api\/spaces\/references\/([^/]+)$/u.exec(url.pathname);
  if (removeReference !== null && request.method === "DELETE") {
    const itemId = decode(removeReference[1]);
    const item = await feature.queries.getReference(itemId);
    if (item === undefined) throw new PanelHttpError(404, "space_reference_not_found", "未找到空间引用。");
    runtime.spaceConversationDeletion.assertAvailable(item.spaceId);
    if (!isSpaceOwnedMaterial(item)) {
      throw new PanelHttpError(409, "space_reference_delete_unavailable", "外部文件夹、外部文件和 Conversation 只能取消引用或删除对话，不能由空间资产删除操作处理。");
    }
    await feature.commands.removeReference(itemId);
    await runtime.flushSpaceKnowledgeSync();
    writeJson(response, 200, { ok: true });
    return true;
  }

  const unlinkReference = /^\/api\/spaces\/references\/([^/]+)\/unlink$/u.exec(url.pathname);
  if (unlinkReference !== null && request.method === "POST") {
    const itemId = decode(unlinkReference[1]);
    const item = await feature.queries.getReference(itemId);
    if (item === undefined) throw new PanelHttpError(404, "space_reference_not_found", "未找到空间引用。");
    runtime.spaceConversationDeletion.assertAvailable(item.spaceId);
    if (!isExternalReference(item)) {
      throw new PanelHttpError(409, item.reference.kind === "conversation" ? "space_conversation_owner_immutable" : "space_reference_unlink_unavailable", item.reference.kind === "conversation"
        ? "Conversation 只能通过删除对话解除归属。"
        : "软件维护的空间材料不能通过外部引用操作取消。");
    }
    await feature.commands.unlinkReference(itemId);
    await runtime.flushSpaceKnowledgeSync();
    writeJson(response, 200, { ok: true });
    return true;
  }

  const openReference = /^\/api\/spaces\/references\/([^/]+)\/open$/u.exec(url.pathname);
  if (openReference !== null && request.method === "POST") {
    const item = await feature.queries.getReference(decode(openReference[1]));
    if (item === undefined) throw new PanelHttpError(404, "space_reference_not_found", "未找到空间引用。");
    runtime.spaceConversationDeletion.assertAvailable(item.spaceId);
    if (runtime.externalResourceOpener === undefined) {
      throw new PanelHttpError(501, "external_resource_open_unavailable", "当前运行方式不支持打开外部资源。");
    }
    if (item.reference.kind === "local_file" || item.reference.kind === "workspace_folder") {
      await assertExternalReferenceCurrent(runtime, item);
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
    runtime.spaceConversationDeletion.assertAvailable(item.spaceId);
    await assertExternalReferenceCurrent(runtime, item);
    const preview = item.reference.kind === "workbench_asset"
      ? await getWorkbenchAssetPreview(runtime.workbenchAssets, item.reference.assetId, item.id)
      : await createPanelDocumentPreview(item, url.searchParams.get("path") ?? "");
    if (preview.status === "missing" && await unlinkInvalidExternalReference(runtime, item)) {
      throw new PanelHttpError(410, "space_reference_source_missing", "来源路径已不存在，当前 Space 引用已移除，请重新添加。");
    }
    writeJson(response, 200, { ok: true, preview });
    return true;
  }

  const referenceContent = /^\/api\/spaces\/references\/([^/]+)\/content$/u.exec(url.pathname);
  if (referenceContent !== null && request.method === "GET") {
    const item = await feature.queries.getReference(decode(referenceContent[1]));
    if (item === undefined) throw new PanelHttpError(404, "space_reference_not_found", "未找到空间引用。");
    runtime.spaceConversationDeletion.assertAvailable(item.spaceId);
    await assertExternalReferenceCurrent(runtime, item);
    try {
      await writePanelSpaceReferenceContent(item, request, response, url.searchParams.get("path") ?? "");
    } catch (error) {
      if (isSpaceReferenceSourceMissing(error) && await unlinkInvalidExternalReference(runtime, item)) {
        throw new PanelHttpError(410, "space_reference_source_missing", "来源路径已不存在，当前 Space 引用已移除，请重新添加。");
      }
      throw error;
    }
    return true;
  }
  if (referenceContent !== null && request.method === "PUT") {
    const item = await feature.queries.getReference(decode(referenceContent[1]));
    if (item === undefined) throw new PanelHttpError(404, "space_reference_not_found", "未找到空间引用。");
    runtime.spaceConversationDeletion.assertAvailable(item.spaceId);
    const input = parse(updateTextSchema, await readJsonBody(request), "引用文件内容无效。");
    if (item.reference.kind === "workbench_asset") {
      writeJson(response, 200, { ok: true, preview: await updateWorkbenchAssetTextPreview(
        runtime.workbenchAssets,
        { assetId: item.reference.assetId, expectedFingerprint: input.expectedFingerprint, text: input.text },
        item.id,
      ) });
      return true;
    }
    writeJson(response, 200, {
      ok: true,
      preview: await runReferenceMutation(runtime, item, () => updatePanelSpaceReferenceText(item, input)),
    });
    return true;
  }

  const referenceEntry = /^\/api\/spaces\/references\/([^/]+)\/entry$/u.exec(url.pathname);
  if (referenceEntry !== null && request.method === "POST") {
    const item = await feature.queries.getReference(decode(referenceEntry[1]));
    if (item === undefined) throw new PanelHttpError(404, "space_reference_not_found", "未找到空间引用。");
    runtime.spaceConversationDeletion.assertAvailable(item.spaceId);
    const input = parse(createReferenceEntrySchema, await readJsonBody(request), "新建文件信息无效。");
    writeJson(response, 201, {
      ok: true,
      entry: await runReferenceMutation(runtime, item, () => createPanelSpaceReferenceEntry(item, input)),
    });
    return true;
  }
  if (referenceEntry !== null && request.method === "PATCH") {
    const item = await feature.queries.getReference(decode(referenceEntry[1]));
    if (item === undefined) throw new PanelHttpError(404, "space_reference_not_found", "未找到空间引用。");
    runtime.spaceConversationDeletion.assertAvailable(item.spaceId);
    const input = parse(renameReferenceEntrySchema, await readJsonBody(request), "文件重命名信息无效。");
    writeJson(response, 200, {
      ok: true,
      entry: await runReferenceMutation(runtime, item, () => renamePanelSpaceReferenceEntry(item, input)),
    });
    return true;
  }
  if (referenceEntry !== null && request.method === "DELETE") {
    const item = await feature.queries.getReference(decode(referenceEntry[1]));
    if (item === undefined) throw new PanelHttpError(404, "space_reference_not_found", "未找到空间引用。");
    runtime.spaceConversationDeletion.assertAvailable(item.spaceId);
    const input = parse(referenceEntrySchema, await readJsonBody(request), "文件删除信息无效。");
    await runReferenceMutation(runtime, item, () => deletePanelSpaceReferenceEntry(item, input.relativePath));
    writeJson(response, 200, { ok: true });
    return true;
  }

  return false;
}

function isSpaceReferenceSourceMissing(error: unknown): boolean {
  return error instanceof PanelHttpError && error.code === "space_reference_source_missing";
}

async function runReferenceMutation<T>(
  runtime: PanelRuntime,
  item: SpaceReferenceItem,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await runtime.fileMutationCoordinator.run(spaceReferenceMutationKey(item), async () => {
      await assertExternalReferenceCurrent(runtime, item);
      return await operation();
    });
  } catch (error) {
    if (isSpaceReferenceSourceMissing(error) && await unlinkInvalidExternalReference(runtime, item)) {
      throw new PanelHttpError(410, "space_reference_source_missing", "来源路径已不存在，当前 Space 引用已移除，请重新添加。");
    }
    throw error;
  }
}

async function assertExternalReferenceCurrent(runtime: PanelRuntime, item: SpaceReferenceItem): Promise<void> {
  if (await unlinkInvalidExternalReference(runtime, item)) {
    throw new PanelHttpError(410, "space_reference_source_missing", "来源路径已不存在或已被替换，当前 Space 引用已移除，请重新添加。");
  }
}

async function unlinkInvalidExternalReference(runtime: PanelRuntime, item: SpaceReferenceItem): Promise<boolean> {
  if (item.reference.kind !== "local_file" && item.reference.kind !== "workspace_folder") return false;
  if (await spaceExternalReferenceStatus(item) === "current") return false;
  try {
    await runtime.spaceFeature.commands.unlinkReference(item.id);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "space_reference_not_found")) throw error;
  }
  return true;
}
function isExternalReference(item: SpaceReferenceItem): boolean {
  return item.reference.kind === "local_file" ||
    item.reference.kind === "workspace_folder" ||
    item.reference.kind === "web_page" ||
    item.reference.kind === "generated_artifact";
}

function isSpaceOwnedMaterial(item: SpaceReferenceItem): boolean {
  return !isExternalReference(item) && item.reference.kind !== "conversation";
}

function isMovableSpaceMaterial(item: SpaceReferenceItem): boolean {
  return item.reference.kind !== "local_file" && item.reference.kind !== "workspace_folder" && item.reference.kind !== "conversation";
}

function absoluteLocalReference(reference: SpaceAddableReference): SpaceAddableReference {
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
    case "space_asset_ownership_conflict":
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
  // Keep this mapper total if a new domain error is added before its HTTP policy.
  return new PanelHttpError(500, "space_repository_failure", error.message);
}
