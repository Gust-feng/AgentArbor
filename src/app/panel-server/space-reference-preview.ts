import { createReadStream, promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { analyse } from "chardet";
import iconv from "iconv-lite";

import type { SpaceReferenceItem } from "../spaces/index.js";
import { PanelHttpError } from "./http-utils.js";

const MAX_TEXT_PREVIEW_BYTES = 512 * 1024;
const MAX_DIRECTORY_ENTRIES = 200;

export type PanelSpaceReferencePreview = {
  readonly itemId: string;
  readonly title: string;
  readonly sourceKind: SpaceReferenceItem["reference"]["kind"];
  readonly source: string;
  readonly status: "ready" | "missing" | "unsupported";
  readonly fingerprint?: string;
  readonly byteLength?: number;
  readonly modifiedAt?: number;
  readonly content:
    | { readonly kind: "text"; readonly text: string; readonly truncated: boolean; readonly editable: boolean; readonly language?: string; readonly encoding?: string }
    | { readonly kind: "directory"; readonly relativePath: string; readonly entries: readonly { readonly name: string; readonly relativePath: string; readonly kind: "file" | "directory" | "other" }[]; readonly truncated: boolean }
    | { readonly kind: "media"; readonly mediaKind: "image" | "pdf" | "video" | "audio"; readonly mimeType: string; readonly url: string }
    | { readonly kind: "web"; readonly url: string }
    | { readonly kind: "unavailable"; readonly message: string };
};

export async function createPanelSpaceReferencePreview(
  item: SpaceReferenceItem,
  relativePath = "",
  contentBaseUrl?: string,
  contentTypeHintPath?: string,
): Promise<PanelSpaceReferencePreview> {
  if (item.reference.kind === "web_page") {
    return base(item, item.reference.url, "ready", { kind: "web", url: item.reference.url });
  }
  if (item.reference.kind !== "local_file" && item.reference.kind !== "workspace_folder" && item.reference.kind !== "managed_folder") {
    return base(item, referenceSource(item), "unsupported", {
      kind: "unavailable",
      message: "这个引用需要由它的来源功能提供预览。",
    });
  }

  const source = await resolvePanelSpaceReferencePath(item, relativePath);
  const stat = await fs.stat(source).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (stat === undefined) {
    return base(item, source, "missing", { kind: "unavailable", message: "来源路径已不存在或暂时不可用。" });
  }

  const fingerprint = `${Math.trunc(stat.mtimeMs)}:${stat.size}`;
  const metadata = { fingerprint, byteLength: stat.isFile() ? stat.size : undefined, modifiedAt: Math.trunc(stat.mtimeMs) };
  if (stat.isDirectory()) {
    if (!stat.isDirectory()) return base(item, source, "missing", { kind: "unavailable", message: "来源不再是文件夹。" });
    const allEntries = await fs.readdir(source, { withFileTypes: true });
    const entries = allEntries.map((entry) => ({
      name: entry.name,
      relativePath: joinRelativePath(relativePath, entry.name),
      kind: entry.isDirectory() ? "directory" as const : entry.isFile() ? "file" as const : "other" as const,
    })).sort((left, right) => directoryEntryRank(left.kind) - directoryEntryRank(right.kind) || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })).slice(0, MAX_DIRECTORY_ENTRIES);
    return { ...base(item, source, "ready", { kind: "directory", relativePath: normalizeRelativePath(relativePath), entries, truncated: allEntries.length > entries.length }), ...metadata };
  }
  if (!stat.isFile()) return base(item, source, "missing", { kind: "unavailable", message: "来源不再是普通文件。" });

  // Managed single-file assets live at a stable `content` path with no
  // extension. The asset route supplies its original source path as a format
  // hint; ordinary Space references continue to classify their physical path.
  const typePath = contentTypeHintPath ?? source;
  const mimeType = mimeTypeForPath(typePath);
  const mediaKind = mediaKindForMimeType(mimeType);
  if (mediaKind !== undefined) {
    return {
      ...base(item, source, "ready", {
        kind: "media",
        mediaKind,
        mimeType,
        url: `${contentBaseUrl ?? `/api/spaces/references/${encodeURIComponent(item.id)}/content`}${relativePath.length === 0 ? "" : `?path=${encodeURIComponent(normalizeRelativePath(relativePath))}`}`,
      }),
      ...metadata,
    };
  }
  if (isKnownBinaryPath(source)) {
    return {
      ...base(item, source, "unsupported", { kind: "unavailable", message: "这个二进制文件暂不支持在工作台中预览。" }),
      ...metadata,
    };
  }

  const handle = await fs.open(source, "r");
  try {
    const byteLimit = Math.min(stat.size, MAX_TEXT_PREVIEW_BYTES);
    const buffer = Buffer.alloc(byteLimit);
    const { bytesRead } = await handle.read(buffer, 0, byteLimit, 0);
    const decoded = decodeTextPreview(buffer.subarray(0, bytesRead), isKnownTextPath(typePath, mimeType), stat.size > bytesRead);
    if (decoded !== undefined) {
      const textFingerprint = stat.size === bytesRead ? contentFingerprint(buffer.subarray(0, bytesRead)) : fingerprint;
      return {
        ...base(item, source, "ready", {
          kind: "text",
          text: decoded.text,
          encoding: decoded.encoding,
          truncated: stat.size > bytesRead,
          editable: stat.size <= MAX_TEXT_PREVIEW_BYTES && decoded.encoding === "UTF-8",
          ...languageForPath(typePath),
        }),
        ...metadata,
        fingerprint: textFingerprint,
      };
    }
  } finally {
    await handle.close();
  }

  return {
    ...base(item, source, "unsupported", { kind: "unavailable", message: "暂不支持在工作台中预览此文件类型。" }),
    ...metadata,
  };
}

export async function writePanelSpaceReferenceContent(
  item: SpaceReferenceItem,
  request: IncomingMessage,
  response: ServerResponse,
  relativePath = "",
  contentTypeHintPath?: string,
): Promise<void> {
  if (item.reference.kind !== "local_file" && item.reference.kind !== "workspace_folder" && item.reference.kind !== "managed_folder") {
    throw new PanelHttpError(409, "space_reference_content_unavailable", "这个引用没有可读取的文件内容。");
  }
  const source = await resolvePanelSpaceReferencePath(item, relativePath);
  const stat = await fs.stat(source).catch(() => undefined);
  if (stat?.isFile() !== true) throw new PanelHttpError(404, "space_reference_source_missing", "来源文件已不存在。");

  const range = parseByteRange(request.headers.range, stat.size);
  const start = range?.start ?? 0;
  const end = range?.end ?? stat.size - 1;
  response.statusCode = range === undefined ? 200 : 206;
  response.setHeader("content-type", mimeTypeForPath(contentTypeHintPath ?? source));
  response.setHeader("accept-ranges", "bytes");
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-length", String(Math.max(0, end - start + 1)));
  if (range !== undefined) response.setHeader("content-range", `bytes ${start}-${end}/${stat.size}`);
  if (stat.size === 0) {
    response.end();
    return;
  }
  await pipeline(createReadStream(source, { start, end }), response);
}

export async function updatePanelSpaceReferenceText(
  item: SpaceReferenceItem,
  input: { readonly relativePath?: string; readonly expectedFingerprint: string; readonly text: string },
): Promise<PanelSpaceReferencePreview> {
  const relativePath = input.relativePath ?? "";
  const source = await resolvePanelSpaceReferencePath(item, relativePath);
  const stat = await fs.stat(source).catch(() => undefined);
  if (stat?.isFile() !== true) throw new PanelHttpError(404, "space_reference_source_missing", "来源文件已不存在。");
  const current = await fs.readFile(source);
  const typePath = source;
  const decoded = decodeTextPreview(current.subarray(0, MAX_TEXT_PREVIEW_BYTES), isKnownTextPath(typePath, mimeTypeForPath(typePath)));
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
    return await createPanelSpaceReferencePreview(item, relativePath);
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

function contentFingerprint(content: Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
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
    throw new PanelHttpError(409, "space_reference_entry_exists", "同一文件夹中已存在这个名称。");
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

/** Deletes the physical object behind a single-file Space reference. */
export async function deletePanelSpaceReferenceFile(item: SpaceReferenceItem): Promise<void> {
  if (item.reference.kind !== "local_file") {
    throw new PanelHttpError(409, "space_reference_file_delete_unavailable", "只有单文件引用可以执行此操作。");
  }
  const stat = await fs.lstat(item.reference.path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new PanelHttpError(404, "space_reference_source_missing", "来源文件已不存在。");
    throw error;
  });
  if (!stat.isFile() && !stat.isSymbolicLink()) {
    throw new PanelHttpError(409, "space_reference_file_delete_unavailable", "这个引用不再是可删除的单个文件。");
  }
  await fs.unlink(item.reference.path).catch((error: NodeJS.ErrnoException) => {
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
      throw new PanelHttpError(409, "space_reference_entry_exists", "同一文件夹中已存在这个名称。");
    }
    throw error;
  }
  return { relativePath };
}

function base(
  item: SpaceReferenceItem,
  source: string,
  status: PanelSpaceReferencePreview["status"],
  content: PanelSpaceReferencePreview["content"],
): PanelSpaceReferencePreview {
  return { itemId: item.id, title: item.title, sourceKind: item.reference.kind, source, status, content };
}

function referenceSource(item: SpaceReferenceItem): string {
  switch (item.reference.kind) {
    case "local_file":
    case "workspace_folder":
    case "managed_folder": return item.reference.path;
    case "web_page": return item.reference.url;
    case "generated_artifact": return item.reference.artifactRef;
    case "conversation": return item.reference.conversationId;
  }
}

export async function resolvePanelSpaceReferencePath(item: SpaceReferenceItem, relativePath: string): Promise<string> {
  if (item.reference.kind !== "local_file" && item.reference.kind !== "workspace_folder" && item.reference.kind !== "managed_folder") {
    throw new PanelHttpError(409, "space_reference_content_unavailable", "这个引用没有可读取的文件内容。");
  }
  const normalized = normalizeRelativePath(relativePath);
  if (item.reference.kind === "local_file") {
    if (normalized.length > 0) throw new PanelHttpError(400, "invalid_space_reference_path", "文件引用不接受子路径。");
    return item.reference.path;
  }
  const root = await fs.realpath(item.reference.path).catch(() => undefined);
  if (root === undefined) return item.reference.path;
  const candidate = path.resolve(root, normalized);
  const realCandidate = await fs.realpath(candidate).catch(() => undefined);
  if (realCandidate === undefined) return candidate;
  const relation = path.relative(root, realCandidate);
  if (relation === "" || (!relation.startsWith(`..${path.sep}`) && relation !== ".." && !path.isAbsolute(relation))) return realCandidate;
  throw new PanelHttpError(400, "invalid_space_reference_path", "引用子路径超出了文件夹范围。");
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
  if (normalized.split("/").some((part) => part === "..")) {
    throw new PanelHttpError(400, "invalid_space_reference_path", "引用子路径无效。");
  }
  return normalized;
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

function joinRelativePath(parent: string, child: string): string {
  const normalizedParent = normalizeRelativePath(parent);
  return normalizedParent.length === 0 ? child : `${normalizedParent}/${child}`;
}

function directoryEntryRank(kind: "file" | "directory" | "other"): number {
  return kind === "directory" ? 0 : kind === "file" ? 1 : 2;
}

function mimeTypeForPath(value: string): string {
  switch (path.extname(value).toLowerCase()) {
    case ".md": return "text/markdown; charset=utf-8";
    case ".txt": return "text/plain; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".ts": return "text/typescript; charset=utf-8";
    case ".tsx": return "text/tsx; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".html": return "text/html; charset=utf-8";
    case ".pdf": return "application/pdf";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".svg": return "image/svg+xml";
    case ".mp4": return "video/mp4";
    case ".webm": return "video/webm";
    case ".mp3": return "audio/mpeg";
    case ".wav": return "audio/wav";
    case ".ogg": return "audio/ogg";
    default: return "application/octet-stream";
  }
}

function mediaKindForMimeType(mimeType: string): "image" | "pdf" | "video" | "audio" | undefined {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return undefined;
}

function languageForPath(value: string): { readonly language?: string } {
  const basename = path.basename(value).toLowerCase();
  const namedLanguage: Readonly<Record<string, string>> = {
    ".gitignore": "gitignore",
    ".gitattributes": "gitattributes",
    ".env": "dotenv",
    "dockerfile": "dockerfile",
    "makefile": "makefile",
  };
  if (namedLanguage[basename] !== undefined) return { language: namedLanguage[basename] };
  const extension = path.extname(value).toLowerCase().slice(1);
  const aliases: Readonly<Record<string, string>> = { jsonc: "json", mjs: "javascript", cjs: "javascript", js: "javascript", ts: "typescript", tsx: "typescript", yml: "yaml", ps1: "powershell", sh: "shell" };
  return extension.length === 0 ? { language: "plaintext" } : { language: aliases[extension] ?? extension };
}

function isKnownTextPath(value: string, mimeType: string): boolean {
  if (mimeType.startsWith("text/") || mimeType.startsWith("application/json")) return true;
  const basename = path.basename(value).toLowerCase();
  if ([".gitignore", ".gitattributes", ".gitmodules", ".editorconfig", ".npmrc", ".nvmrc", ".env", "dockerfile", "makefile", "license"].includes(basename)) return true;
  return [
    ".csv", ".xml", ".yaml", ".yml", ".toml", ".ini", ".log", ".jsonc", ".jsonl",
    ".py", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".go", ".rs", ".rb", ".php",
    ".sh", ".bash", ".zsh", ".ps1", ".sql", ".graphql", ".vue", ".svelte",
  ].includes(path.extname(value).toLowerCase());
}

function isKnownBinaryPath(value: string): boolean {
  return [
    ".zip", ".7z", ".rar", ".tar", ".gz", ".bz2", ".xz", ".jar",
    ".exe", ".dll", ".so", ".dylib", ".bin", ".iso",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".sqlite", ".db", ".woff", ".woff2", ".ttf", ".otf",
  ].includes(path.extname(value).toLowerCase());
}

function decodeTextPreview(body: Buffer, knownText: boolean, truncated = false): { readonly text: string; readonly encoding: string } | undefined {
  if (body.length === 0) return { text: "", encoding: "UTF-8" };
  if (body[0] === 0xff && body[1] === 0xfe) return { text: iconv.decode(body, "utf16-le"), encoding: "UTF-16LE" };
  if (body[0] === 0xfe && body[1] === 0xff) return { text: iconv.decode(body, "utf16-be"), encoding: "UTF-16BE" };
  if (looksBinary(body)) return undefined;
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(body).replace(/^\uFEFF/u, ""), encoding: "UTF-8" };
  } catch {
    if (truncated) {
      for (let trim = 1; trim <= Math.min(3, body.length); trim += 1) {
        try {
          return { text: new TextDecoder("utf-8", { fatal: true }).decode(body.subarray(0, body.length - trim)).replace(/^\uFEFF/u, ""), encoding: "UTF-8" };
        } catch {
          // A UTF-8 scalar uses at most four bytes, so three tail retries are sufficient.
        }
      }
    }
    const minimumConfidence = knownText ? 50 : 80;
    const match = analyse(body).find((candidate) => candidate.confidence >= minimumConfidence && iconv.encodingExists(candidate.name));
    if (match === undefined) return undefined;
    return { text: iconv.decode(body, match.name), encoding: match.name };
  }
}

function looksBinary(body: Buffer): boolean {
  let controls = 0;
  for (const byte of body) {
    if (byte === 0) return true;
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13 && byte !== 12) controls += 1;
  }
  return controls / body.length > 0.02;
}

function parseByteRange(value: string | undefined, size: number): { readonly start: number; readonly end: number } | undefined {
  if (value === undefined) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim());
  if (match === null || size <= 0) throw new PanelHttpError(416, "invalid_space_reference_range", "请求的文件范围无效。");
  const rawStart = match[1];
  const rawEnd = match[2];
  let start: number;
  let end: number;
  if (rawStart.length === 0) {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new PanelHttpError(416, "invalid_space_reference_range", "请求的文件范围无效。");
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd.length === 0 ? size - 1 : Number(rawEnd);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    throw new PanelHttpError(416, "invalid_space_reference_range", "请求的文件范围无效。");
  }
  return { start, end: Math.min(end, size - 1) };
}
