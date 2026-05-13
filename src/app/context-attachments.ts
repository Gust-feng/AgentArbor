import { promises as fs } from "node:fs";
import path from "node:path";
import type { ContextAttachment, ContextAttachmentKind } from "../domain/basic-agent/index.js";
import { createId } from "../kernel/id.js";
import { redactSensitiveText } from "../kernel/redaction.js";

export class ContextAttachmentPreviewError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ContextAttachmentPreviewError";
  }
}

export type CreateContextAttachmentPreviewInput = {
  readonly kind?: ContextAttachmentKind;
  readonly value?: string;
  readonly ref?: string;
  readonly title?: string;
  readonly summary?: string;
};

export async function createContextAttachmentPreview(input: {
  readonly raw: CreateContextAttachmentPreviewInput;
  readonly workspaceRoot: string;
}): Promise<ContextAttachment> {
  const value = requiredText(input.raw.value ?? input.raw.ref, "上下文引用不能为空。");
  const kind = input.raw.kind ?? inferAttachmentKind(value);
  if (kind === "web") {
    return webAttachment(value, input.raw);
  }
  if (kind === "workspace") {
    return workspaceAttachment(input.workspaceRoot, input.raw);
  }
  return fileSystemAttachment({
    kind,
    value,
    raw: input.raw,
    workspaceRoot: input.workspaceRoot,
  });
}

function workspaceAttachment(workspaceRoot: string, raw: CreateContextAttachmentPreviewInput): ContextAttachment {
  const label = safeText(raw.title ?? (path.basename(workspaceRoot) || "当前工作区"), 120);
  return {
    attachmentId: createId("ctx"),
    kind: "workspace",
    ref: "workspace:current",
    title: label,
    summary: safeText(raw.summary ?? "允许本轮任务使用当前工作区的只读摘要和安全引用。", 280),
    permissionRefs: ["read:workspace:current-task"],
    readonlyPreviewMeta: { available: true, title: label },
    status: "ready",
  };
}

async function fileSystemAttachment(input: {
  readonly kind: "file" | "project";
  readonly value: string;
  readonly raw: CreateContextAttachmentPreviewInput;
  readonly workspaceRoot: string;
}): Promise<ContextAttachment> {
  const resolved = resolveWorkspacePath(input.workspaceRoot, input.value);
  const relativePath = toPortableRelativePath(input.workspaceRoot, resolved);
  const stat = await fs.stat(resolved).catch(() => undefined);
  const title = safeText(input.raw.title ?? (path.basename(resolved) || relativePath || "工作区"), 120);
  const isExpectedKind =
    stat === undefined ||
    (input.kind === "file" && stat.isFile()) ||
    (input.kind === "project" && stat.isDirectory());
  return {
    attachmentId: createId("ctx"),
    kind: input.kind,
    ref: `${input.kind}:${relativePath || "."}`,
    title,
    summary: safeText(input.raw.summary ?? defaultFileSystemSummary(input.kind, relativePath, stat), 280),
    permissionRefs:
      input.kind === "file"
        ? [`read:file:${relativePath}`]
        : ["read:workspace:current-task", `read:project:${relativePath || "."}`],
    readonlyPreviewMeta: {
      available: stat !== undefined && isExpectedKind,
      title,
      byteLength: stat?.isFile() === true ? stat.size : undefined,
      truncated: false,
    },
    status: stat !== undefined && isExpectedKind ? "ready" : "blocked",
    warning:
      stat === undefined
        ? "没有找到这个路径。"
        : isExpectedKind
          ? undefined
          : input.kind === "file"
            ? "请选择一个文件。"
            : "请选择一个文件夹。",
  };
}

function webAttachment(value: string, raw: CreateContextAttachmentPreviewInput): ContextAttachment {
  const url = parseSafeWebUrl(value);
  const title = safeText(raw.title ?? url.hostname, 120);
  return {
    attachmentId: createId("ctx"),
    kind: "web",
    ref: `web:${url.toString()}`,
    title,
    summary: safeText(raw.summary ?? `网页引用：${url.toString()}`, 280),
    permissionRefs: ["read:web"],
    readonlyPreviewMeta: { available: true, title },
    status: "ready",
  };
}

function inferAttachmentKind(value: string): ContextAttachmentKind {
  if (/^https?:\/\//i.test(value.trim())) {
    return "web";
  }
  return value.trim() === "." ? "workspace" : "file";
}

function resolveWorkspacePath(workspaceRoot: string, value: string): string {
  const root = path.resolve(workspaceRoot);
  const rawPath = value.startsWith("file:") || value.startsWith("project:")
    ? value.slice(value.indexOf(":") + 1)
    : value;
  const resolved = path.resolve(root, rawPath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ContextAttachmentPreviewError("context_path_outside_workspace", "上下文路径必须位于当前工作区内。");
  }
  if (isUnsafeReferenceText(rawPath)) {
    throw new ContextAttachmentPreviewError("unsafe_context_reference", "上下文引用不能包含密钥、token 或运行时内部引用。");
  }
  return resolved;
}

function parseSafeWebUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ContextAttachmentPreviewError("invalid_web_context", "网页上下文需要有效的 HTTP 或 HTTPS 地址。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ContextAttachmentPreviewError("invalid_web_context", "网页上下文只支持 HTTP 或 HTTPS 地址。");
  }
  if (isUnsafeReferenceText(url.toString())) {
    throw new ContextAttachmentPreviewError("unsafe_context_reference", "网页地址不能包含密钥、token 或授权参数。");
  }
  return url;
}

function defaultFileSystemSummary(
  kind: "file" | "project",
  relativePath: string,
  stat: Awaited<ReturnType<typeof fs.stat>> | undefined
): string {
  if (stat === undefined) {
    return `${kind === "file" ? "文件" : "文件夹"}引用：${relativePath}`;
  }
  if (stat.isDirectory()) {
    return `文件夹引用：${relativePath || "."}`;
  }
  return `文件引用：${relativePath} · ${stat.size} bytes`;
}

function toPortableRelativePath(workspaceRoot: string, resolved: string): string {
  return path.relative(path.resolve(workspaceRoot), resolved).replaceAll(path.sep, "/") || ".";
}

function requiredText(value: string | undefined, message: string): string {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    throw new ContextAttachmentPreviewError("missing_context_value", message);
  }
  if (isUnsafeReferenceText(normalized)) {
    throw new ContextAttachmentPreviewError("unsafe_context_reference", "上下文引用不能包含密钥、token 或运行时内部引用。");
  }
  return normalized;
}

function safeText(value: string, maxLength: number): string {
  const redacted = redactSensitiveText(value).replace(/\b(runtime|store|secret):[^\s]+/gi, "[redacted-ref]").trim();
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, Math.max(0, maxLength - 1))}…`;
}

function isUnsafeReferenceText(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.startsWith("secret:") ||
    normalized.startsWith("runtime:") ||
    normalized.startsWith("store:") ||
    normalized.includes(":secret:") ||
    normalized.includes(":runtime:") ||
    normalized.includes(":store:") ||
    normalized.includes("api_key") ||
    normalized.includes("apikey") ||
    normalized.includes("access_token") ||
    normalized.includes("authorization") ||
    normalized.includes("bearer ") ||
    normalized.includes("token=") ||
    normalized.includes("secret=")
  );
}
