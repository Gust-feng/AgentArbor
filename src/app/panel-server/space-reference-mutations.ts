/**
 * 空间引用的文件系统变更操作。
 *
 * 本模块只包含会改变磁盘状态的操作：编辑文本、重命名、新建、删除。
 * 读取、预览和内容流式传输在 space-reference-preview.ts。
 */
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

import type { SpaceReferenceItem } from "../spaces/index.js";
import { PanelHttpError } from "./http-utils.js";
import {
  MAX_TEXT_PREVIEW_BYTES,
  contentFingerprint,
  createPanelSpaceReferencePreview,
  decodeTextPreview,
  isKnownTextPath,
  joinRelativePath,
  mimeTypeForPath,
  normalizeRelativePath,
  resolvePanelSpaceReferencePath,
  type PanelSpaceReferencePreview,
} from "./space-reference-preview.js";

export async function updatePanelSpaceReferenceText(
  item: SpaceReferenceItem,
  input: { readonly relativePath?: string; readonly expectedFingerprint: string; readonly text: string },
  previewOptions?: { readonly contentBaseUrl?: string; readonly contentTypeHintPath?: string },
): Promise<PanelSpaceReferencePreview> {
  const relativePath = input.relativePath ?? "";
  const source = await resolvePanelSpaceReferencePath(item, relativePath);
  const stat = await fs.stat(source).catch(() => undefined);
  if (stat?.isFile() !== true) throw new PanelHttpError(404, "space_reference_source_missing", "来源文件已不存在。");
  const current = await fs.readFile(source);
  const decoded = decodeTextPreview(current.subarray(0, MAX_TEXT_PREVIEW_BYTES), isKnownTextPath(source, mimeTypeForPath(source)));
  if (decoded?.encoding !== "UTF-8" || Buffer.byteLength(input.text, "utf8") > MAX_TEXT_PREVIEW_BYTES) {
    throw new PanelHttpError(409, "space_reference_not_editable", "这个文件不能在工作台中编辑。");
  }
  const fingerprint = contentFingerprint(current);
  if (fingerprint !== input.expectedFingerprint) {
    throw new PanelHttpError(409, "space_reference_revision_conflict", "来源文件已发生变化，请先比较更改。");
  }
  const temporaryPath = path.join(path.dirname(source), `.${path.basename(source)}.agentarbor-${randomUUID()}.tmp`);
  const handle = await fs.open(temporaryPath, "wx", stat.mode);
  try {
    await handle.writeFile(input.text, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    const latest = await fs.readFile(source).catch(() => undefined);
    if (latest === undefined || contentFingerprint(latest) !== input.expectedFingerprint) {
      throw new PanelHttpError(409, "space_reference_revision_conflict", "来源文件已发生变化，请先比较更改。");
    }
    await fs.rename(temporaryPath, source);
    return await createPanelSpaceReferencePreview(
      item,
      relativePath,
      previewOptions?.contentBaseUrl,
      previewOptions?.contentTypeHintPath,
    );
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

export async function renamePanelSpaceReferenceEntry(
  item: SpaceReferenceItem,
  input: { readonly relativePath: string; readonly name: string },
): Promise<{ readonly relativePath: string }> {
  const relativePath = normalizeMutableEntryPath(item, input.relativePath);
  const name = normalizeEntryName(input.name);
  const source = await resolvePanelSpaceReferencePath(item, relativePath);
  const parentRelativePath = path.posix.dirname(relativePath) === "." ? "" : path.posix.dirname(relativePath);
  const destinationRelativePath = joinRelativePath(parentRelativePath, name);
  const destination = await resolveReferenceDestination(item, destinationRelativePath);
  if (await fs.stat(destination).then(() => true, () => false)) {
    throw new PanelHttpError(409, "space_reference_entry_exists", "同一文件夹中已存在这个名字。");
  }
  await fs.rename(source, destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new PanelHttpError(404, "space_reference_source_missing", "来源文件已不存在。");
    throw error;
  });
  return { relativePath: destinationRelativePath };
}

export async function deletePanelSpaceReferenceEntry(
  item: SpaceReferenceItem,
  relativePathValue: string,
): Promise<void> {
  const relativePath = normalizeMutableEntryPath(item, relativePathValue);
  const source = await resolvePanelSpaceReferencePath(item, relativePath);
  await fs.rm(source, { recursive: true, force: false }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new PanelHttpError(404, "space_reference_source_missing", "来源文件已不存在。");
    throw error;
  });
}

export async function createPanelSpaceReferenceEntry(
  item: SpaceReferenceItem,
  input: { readonly parentRelativePath: string; readonly name: string; readonly kind: "file" | "directory" },
): Promise<{ readonly relativePath: string }> {
  if (item.reference.kind !== "workspace_folder" && item.reference.kind !== "managed_folder") {
    throw new PanelHttpError(409, "space_reference_entry_mutation_unavailable", "只有工作区或软件受管文件夹中可以新建文件。");
  }
  const parentRelativePath = normalizeRelativePath(input.parentRelativePath);
  const relativePath = joinRelativePath(parentRelativePath, normalizeEntryName(input.name));
  const destination = await resolveReferenceDestination(item, relativePath);
  try {
    if (input.kind === "directory") await fs.mkdir(destination);
    else await fs.writeFile(destination, "", { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new PanelHttpError(409, "space_reference_entry_exists", "同一文件夹中已存在这个名字。");
    }
    throw error;
  }
  return { relativePath };
}

function normalizeMutableEntryPath(item: SpaceReferenceItem, value: string): string {
  if (item.reference.kind !== "workspace_folder" && item.reference.kind !== "managed_folder") {
    throw new PanelHttpError(409, "space_reference_entry_mutation_unavailable", "只有工作区或软件受管文件夹中的条目可以执行此操作。");
  }
  const normalized = normalizeRelativePath(value);
  if (normalized.length === 0) throw new PanelHttpError(400, "invalid_space_reference_path", "不能修改工作区根目录。");
  return normalized;
}

function normalizeEntryName(value: string): string {
  const name = value.trim();
  if (name.length === 0 || name.length > 255 || name === "." || name === ".." || /[\\/:*?"<>|]/u.test(name)) {
    throw new PanelHttpError(400, "invalid_space_reference_name", "文件名称无效。");
  }
  return name;
}

async function resolveReferenceDestination(item: SpaceReferenceItem, relativePath: string): Promise<string> {
  if (item.reference.kind !== "workspace_folder" && item.reference.kind !== "managed_folder") {
    throw new PanelHttpError(409, "space_reference_entry_mutation_unavailable", "只有工作区或软件受管文件夹中的条目可以执行此操作。");
  }
  const root = await fs.realpath(item.reference.path).catch(() => undefined);
  if (root === undefined) throw new PanelHttpError(404, "space_reference_source_missing", "工作区文件夹已不存在。");
  const normalized = normalizeRelativePath(relativePath);
  const parent = await fs.realpath(path.resolve(root, path.dirname(normalized))).catch(() => undefined);
  if (parent === undefined || !isWithinRoot(root, parent)) {
    throw new PanelHttpError(400, "invalid_space_reference_path", "引用子路径超出了文件夹范围。");
  }
  return path.join(parent, path.basename(normalized));
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relation = path.relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${path.sep}`) && relation !== ".." && !path.isAbsolute(relation));
}
