import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { KnowledgePage } from "../personal-knowledge/index.js";
import type { SpaceReferenceItem } from "../spaces/index.js";
import { PanelHttpError } from "./http-utils.js";
import { resolveWithinRoot } from "../local-filesystem/index.js";

const MAX_CAPTURE_BYTES = 256 * 1024 * 1024;
const MAX_CAPTURE_ENTRIES = 5_000;

export async function captureKnowledgeAsset(
  root: string,
  assetId: string,
  item: SpaceReferenceItem,
  relativePath = "",
): Promise<NonNullable<KnowledgePage["asset"]>> {
  if (item.reference.kind !== "local_file" && item.reference.kind !== "workspace_folder" && item.reference.kind !== "managed_folder") {
    throw new PanelHttpError(409, "knowledge_asset_capture_unavailable", "当前来源暂不支持复制到知识库。");
  }
  let source: string;
  try {
    source = await resolveWithinRoot(item.reference.path, relativePath);
  } catch {
    throw new PanelHttpError(400, "invalid_space_reference_path", "引用子路径超出了文件夹范围。");
  }
  const stat = await fs.stat(source).catch(() => undefined);
  if (stat === undefined || (!stat.isFile() && !stat.isDirectory())) {
    throw new PanelHttpError(404, "knowledge_asset_source_missing", "来源文件已不存在。");
  }
  await validateCaptureSource(source);
  const assetDirectory = path.join(root, safeAssetId(assetId));
  const temporaryDirectory = `${assetDirectory}.pending-${randomUUID()}`;
  const content = path.join(temporaryDirectory, "content");
  await fs.mkdir(temporaryDirectory, { recursive: true });
  try {
    if (stat.isDirectory()) await fs.cp(source, content, {
      recursive: true,
      verbatimSymlinks: true,
      filter: async (candidate) => {
        const candidateStat = await fs.lstat(candidate);
        if (candidateStat.isSymbolicLink()) throw captureLimitError("知识库暂不复制符号链接。");
        return true;
      },
    });
    else await fs.copyFile(source, content);
    await fs.writeFile(path.join(temporaryDirectory, "manifest.json"), JSON.stringify({
      version: 1,
      title: relativePath.length === 0 ? item.title : path.basename(source),
      sourceLabel: source,
      contentKind: stat.isDirectory() ? "directory" : "file",
      capturedAt: Date.now(),
    }), "utf8");
    await fs.rename(temporaryDirectory, assetDirectory);
  } catch (error) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
  return {
    status: "managed",
    title: relativePath.length === 0 ? item.title : path.basename(source),
    sourceLabel: source,
    contentKind: stat.isDirectory() ? "directory" : "file",
    sourceReferenceId: item.id,
    sourceRelativePath: relativePath,
  };
}

export async function reconcileKnowledgeAssets(root: string, activeAssetIds: ReadonlySet<string>): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  const activeDirectories = new Set([...activeAssetIds].map(safeAssetId));
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.includes(".pending-") || !activeDirectories.has(entry.name)) {
      await fs.rm(path.join(root, entry.name), { recursive: true, force: true });
    }
  }
}

async function validateCaptureSource(source: string): Promise<void> {
  const queue = [source];
  let entries = 0;
  let bytes = 0;
  while (queue.length > 0) {
    const current = queue.pop()!;
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw captureLimitError("知识库暂不复制符号链接。");
    entries += 1;
    if (entries > MAX_CAPTURE_ENTRIES) throw captureLimitError(`收藏内容超过 ${MAX_CAPTURE_ENTRIES} 个条目，请选择更具体的文件或子文件夹。`);
    if (stat.isFile()) {
      bytes += stat.size;
      if (bytes > MAX_CAPTURE_BYTES) throw captureLimitError("收藏内容超过 256 MiB，请选择更具体的文件或子文件夹。");
      continue;
    }
    if (!stat.isDirectory()) throw captureLimitError("知识库只支持普通文件和文件夹。");
    for (const child of await fs.readdir(current)) queue.push(path.join(current, child));
  }
}

function captureLimitError(message: string): PanelHttpError {
  return new PanelHttpError(409, "knowledge_asset_capture_limit", message);
}

export async function removeKnowledgeAsset(root: string, refId: string): Promise<void> {
  await fs.rm(path.join(root, safeAssetId(refId)), { recursive: true, force: true });
}

export function managedKnowledgeReference(root: string, page: KnowledgePage): SpaceReferenceItem {
  if (page.asset?.status !== "managed") throw new PanelHttpError(404, "knowledge_asset_not_found", "这条旧知识尚未生成托管副本。");
  const content = path.join(root, safeAssetId(page.refId), "content");
  return {
    id: page.refId,
    title: page.asset.title,
    reference: page.asset.contentKind === "directory"
      ? { kind: "workspace_folder", path: content }
      : { kind: "local_file", path: content },
  } as SpaceReferenceItem;
}

function safeAssetId(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
