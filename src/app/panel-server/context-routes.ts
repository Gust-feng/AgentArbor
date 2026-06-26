import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ConfigCenter } from "../config-center.js";
import {
  ContextAttachmentPreviewError,
  createContextAttachmentPreview,
  createSelectedLocalContextAttachment,
  createUploadedContextAttachment,
  type CreateContextAttachmentPreviewInput,
} from "../context-attachments.js";
import { PanelHttpError, readJsonBody, writeJson } from "./http-utils.js";
import { asRecord, optionalString } from "./request-parsers.js";
import type { PanelContextAttachmentSelection } from "./types.js";

export type PanelContextRouteRuntime = {
  readonly configCenter: ConfigCenter;
  readonly configDirectory?: string;
  readonly contextAttachmentPicker?: () => Promise<PanelContextAttachmentSelection | undefined>;
};

const MAX_ATTACHMENT_UPLOAD_BYTES = 64 * 1024 * 1024;
const MAX_ATTACHMENT_UPLOAD_FILES = 12;

export async function handlePanelContextRoute(
  runtime: PanelContextRouteRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<boolean> {
  if (request.method === "POST" && url.pathname === "/api/context/attachments/preview") {
    const body = await readJsonBody(request);
    const workspace = await runtime.configCenter.getWorkspaceConfig();
    const attachment = await createContextAttachmentPreview({
      raw: parseContextAttachmentPreviewInput(body),
      workspaceRoot: workspace.workspaceDirectory,
    }).catch((error: unknown) => {
      if (error instanceof ContextAttachmentPreviewError) {
        throw new PanelHttpError(400, error.code, error.message);
      }
      throw error;
    });
    writeJson(response, 200, { ok: true, attachment });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/context/attachments/upload") {
    const files = await readMultipartAttachmentUpload(request);
    if (files.length === 0) {
      throw new PanelHttpError(400, "missing_attachment_files", "上传请求没有包含文件。");
    }
    if (files.length > MAX_ATTACHMENT_UPLOAD_FILES) {
      throw new PanelHttpError(413, "too_many_attachment_files", `一次最多上传 ${MAX_ATTACHMENT_UPLOAD_FILES} 个附件。`);
    }
    const uploadDirectory = path.join(resolveAttachmentUploadRoot(runtime.configDirectory), randomUUID());
    await fs.mkdir(uploadDirectory, { recursive: true });
    const attachments = [];
    for (const [index, file] of files.entries()) {
      const savedPath = path.join(uploadDirectory, storedUploadFilename(file.filename, index));
      await fs.writeFile(savedPath, file.body);
      const attachment = await createUploadedContextAttachment({
        path: savedPath,
        originalName: file.filename,
        mimeType: file.contentType,
      }).catch((error: unknown) => {
        if (error instanceof ContextAttachmentPreviewError) {
          throw new PanelHttpError(400, error.code, error.message);
        }
        throw error;
      });
      attachments.push(attachment);
    }
    writeJson(response, 200, {
      ok: true,
      attachments,
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/context/attachments/select-local") {
    if (runtime.contextAttachmentPicker === undefined) {
      throw new PanelHttpError(501, "context_attachment_picker_unavailable", "当前环境不支持系统附件选择器。");
    }
    const selected = await runtime.contextAttachmentPicker();
    if (selected === undefined) {
      writeJson(response, 200, {
        ok: true,
        status: "cancelled",
        message: "已取消选择附件。",
      });
      return true;
    }
    const attachment = await createSelectedLocalContextAttachment(selected).catch((error: unknown) => {
      if (error instanceof ContextAttachmentPreviewError) {
        throw new PanelHttpError(400, error.code, error.message);
      }
      throw error;
    });
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      attachment,
    });
    return true;
  }
  return false;
}

type UploadedMultipartFile = {
  readonly fieldName: string;
  readonly filename: string;
  readonly contentType?: string;
  readonly body: Buffer;
};

async function readMultipartAttachmentUpload(request: IncomingMessage): Promise<readonly UploadedMultipartFile[]> {
  const boundary = multipartBoundary(request.headers["content-type"]);
  if (boundary === undefined) {
    throw new PanelHttpError(400, "invalid_attachment_upload", "附件上传请求必须使用 multipart/form-data。");
  }
  const body = await readRequestBuffer(request, MAX_ATTACHMENT_UPLOAD_BYTES);
  return parseMultipartFiles(body, boundary).filter((file) => file.fieldName === "files");
}

function multipartBoundary(contentType: string | readonly string[] | undefined): string | undefined {
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/iu.exec(value ?? "");
  return match?.[1] ?? match?.[2]?.trim();
}

async function readRequestBuffer(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "binary");
    total += buffer.length;
    if (total > maxBytes) {
      throw new PanelHttpError(413, "attachment_upload_too_large", "上传附件总大小过大。");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseMultipartFiles(body: Buffer, boundary: string): readonly UploadedMultipartFile[] {
  const marker = Buffer.from(`--${boundary}`, "utf8");
  const files: UploadedMultipartFile[] = [];
  let cursor = body.indexOf(marker);
  while (cursor >= 0) {
    cursor += marker.length;
    if (body.subarray(cursor, cursor + 2).toString("latin1") === "--") {
      break;
    }
    if (body.subarray(cursor, cursor + 2).toString("latin1") === "\r\n") {
      cursor += 2;
    } else if (body.subarray(cursor, cursor + 1).toString("latin1") === "\n") {
      cursor += 1;
    }
    const next = body.indexOf(marker, cursor);
    if (next < 0) {
      break;
    }
    const part = trimPartBody(body.subarray(cursor, next));
    const parsed = parseMultipartFilePart(part);
    if (parsed !== undefined) {
      files.push(parsed);
    }
    cursor = next;
  }
  return files;
}

function trimPartBody(part: Buffer): Buffer {
  if (part.length >= 2 && part.subarray(part.length - 2).toString("latin1") === "\r\n") {
    return part.subarray(0, part.length - 2);
  }
  if (part.length >= 1 && part.subarray(part.length - 1).toString("latin1") === "\n") {
    return part.subarray(0, part.length - 1);
  }
  return part;
}

function parseMultipartFilePart(part: Buffer): UploadedMultipartFile | undefined {
  const headerEnd = part.indexOf(Buffer.from("\r\n\r\n", "latin1"));
  const delimiterLength = headerEnd >= 0 ? 4 : 2;
  const effectiveHeaderEnd = headerEnd >= 0 ? headerEnd : part.indexOf(Buffer.from("\n\n", "latin1"));
  if (effectiveHeaderEnd < 0) {
    return undefined;
  }
  const headers = parseMultipartHeaders(part.subarray(0, effectiveHeaderEnd).toString("latin1"));
  const disposition = headers.get("content-disposition");
  const dispositionParams = parseHeaderParameters(disposition);
  const fieldName = dispositionParams.name;
  const filename = dispositionParams.filename ?? dispositionParams["filename*"];
  if (fieldName === undefined || filename === undefined || filename.length === 0) {
    return undefined;
  }
  return {
    fieldName,
    filename,
    contentType: headers.get("content-type"),
    body: part.subarray(effectiveHeaderEnd + delimiterLength),
  };
}

function parseMultipartHeaders(value: string): ReadonlyMap<string, string> {
  const headers = new Map<string, string>();
  for (const line of value.split(/\r?\n/u)) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }
  return headers;
}

function parseHeaderParameters(value: string | undefined): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const part of value?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = part.slice(0, separator).trim().toLowerCase();
    const raw = part.slice(separator + 1).trim();
    result[key] = decodeHeaderParameter(raw, key.endsWith("*"));
  }
  return result;
}

function decodeHeaderParameter(value: string, encoded: boolean): string {
  const unquoted = value.startsWith("\"") && value.endsWith("\"")
    ? value.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\")
    : value;
  if (!encoded) {
    return unquoted;
  }
  const encodedMatch = /^[^']*'[^']*'(.+)$/u.exec(unquoted);
  try {
    return decodeURIComponent(encodedMatch?.[1] ?? unquoted);
  } catch {
    return unquoted;
  }
}

function resolveAttachmentUploadRoot(configDirectory: string | undefined): string {
  return path.join(configDirectory ?? path.join(os.tmpdir(), "agentarbor"), "attachments");
}

function storedUploadFilename(filename: string, index: number): string {
  const basename = path.basename(filename).replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, "_").trim();
  const safe = basename.length === 0 ? `attachment-${index + 1}` : basename.slice(0, 160);
  return `${String(index + 1).padStart(2, "0")}-${randomUUID()}-${safe}`;
}

function parseContextAttachmentPreviewInput(raw: unknown): CreateContextAttachmentPreviewInput {
  const record = asRecord(raw);
  const kind = optionalString(record.kind);
  if (kind !== undefined && kind !== "workspace" && kind !== "file" && kind !== "project" && kind !== "web") {
    throw new PanelHttpError(400, "invalid_context_attachment_kind", "上下文附件类型必须是 workspace、file、project 或 web。");
  }
  return {
    kind,
    value: optionalString(record.value),
    ref: optionalString(record.ref),
    title: optionalString(record.title),
    summary: optionalString(record.summary),
  };
}
