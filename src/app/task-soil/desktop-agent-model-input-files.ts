import { promises as fs } from "node:fs";
import path from "node:path";
import { CodedExecutionError } from "../execution-errors/index.js";
import type { ModelCapabilities } from "../../domain/config/index.js";
import type { ModelInputAttachment, ModelMessage } from "../../domain/intelligence/index.js";
import type { TaskSoil, TaskSoilContextRef } from "../../domain/soil/index.js";
import { managedUploadAttachmentId } from "./context-attachments.js";

const MAX_IMAGE_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function attachDesktopFileInputsToModelMessages(input: {
  readonly messages: readonly ModelMessage[];
  readonly taskSoil: TaskSoil;
  readonly modelCapabilities?: ModelCapabilities;
  readonly workspaceRoot?: string;
  readonly resolveManagedAttachmentPath?: (attachmentId: string) => Promise<string | undefined>;
  readonly readAuthorization?: {
    assertReadAllowed(attachmentId: string): void | Promise<void>;
  };
}): Promise<readonly ModelMessage[]> {
  const imageRefs = input.taskSoil.contextRefs.filter(isImageContextRef);
  if (imageRefs.length === 0) {
    return input.messages;
  }
  if (input.modelCapabilities?.supportsVisionInput !== true) {
    throw new CodedExecutionError(
      "model_vision_input_unsupported",
      "This run contains image attachments, but the frozen model capability does not support image input.",
    );
  }
  const attachments = await resolveImageAttachments({
    taskSoil: input.taskSoil,
    workspaceRoot: input.workspaceRoot ?? process.cwd(),
    resolveManagedAttachmentPath: input.resolveManagedAttachmentPath,
    readAuthorization: input.readAuthorization,
  });
  if (attachments.failures.length > 0) {
    throw new CodedExecutionError(
      "model_input_attachment_unavailable",
      `Image attachments could not be delivered: ${attachments.failures.join("; ")}`,
    );
  }
  if (attachments.items.length === 0) {
    throw new CodedExecutionError(
      "model_input_attachment_unavailable",
      "Image attachments were declared for this run, but none could be read.",
    );
  }
  return appendAttachmentsToCurrentUserMessage(input.messages, attachments.items);
}

type ResolvedImageAttachments = {
  readonly items: readonly ModelInputAttachment[];
  readonly failures: readonly string[];
};

async function resolveImageAttachments(input: {
  readonly taskSoil: TaskSoil;
  readonly workspaceRoot: string;
  readonly resolveManagedAttachmentPath?: (attachmentId: string) => Promise<string | undefined>;
  readonly readAuthorization?: {
    assertReadAllowed(attachmentId: string): void | Promise<void>;
  };
}): Promise<ResolvedImageAttachments> {
  const attachments: ModelInputAttachment[] = [];
  const failures: string[] = [];
  for (const ref of input.taskSoil.contextRefs) {
    if (!isImageContextRef(ref)) continue;
    if (ref.attachmentId !== undefined) {
      try {
        await input.readAuthorization?.assertReadAllowed(ref.attachmentId);
      } catch (error) {
        failures.push(`${ref.ref}: ${error instanceof Error ? error.message : "read authorization failed"}`);
        continue;
      }
    }
    const resolved = await resolveReadableFileRef(
      ref,
      input.workspaceRoot,
      input.taskSoil.permissionBoundaryRefs,
      input.resolveManagedAttachmentPath,
    );
    if (resolved === undefined) {
      failures.push(`${ref.ref}: file is unavailable or not authorized`);
      continue;
    }
    const mimeType = imageMimeTypeFor(ref, resolved.absolutePath);
    if (mimeType === undefined) {
      failures.push(`${ref.ref}: image MIME type could not be determined`);
      continue;
    }
    const stat = await fs.stat(resolved.absolutePath).catch(() => undefined);
    if (stat?.isFile() !== true) {
      failures.push(`${ref.ref}: not a readable file`);
      continue;
    }
    if (stat.size > MAX_IMAGE_ATTACHMENT_BYTES) {
      failures.push(`${ref.ref}: exceeds the ${MAX_IMAGE_ATTACHMENT_BYTES} byte image limit`);
      continue;
    }
    const data = await fs.readFile(resolved.absolutePath).catch(() => undefined);
    if (data === undefined) {
      failures.push(`${ref.ref}: file could not be read`);
      continue;
    }
    attachments.push({
      kind: "image",
      attachmentId: ref.attachmentId,
      inputRef: ref.ref,
      source: {
        kind: "data",
        mimeType,
        data: data.toString("base64"),
      },
      filename: path.basename(resolved.absolutePath),
      detail: "auto",
      byteLength: stat.size,
    });
  }
  return { items: attachments, failures };
}

function isImageContextRef(ref: TaskSoilContextRef): boolean {
  if (ref.kind !== "file") return false;
  if (ref.metadata?.mimeType?.startsWith("image/") === true) return true;
  return IMAGE_MIME_BY_EXTENSION[path.extname(ref.ref).toLowerCase()] !== undefined;
}

function imageMimeTypeFor(ref: TaskSoilContextRef, absolutePath: string): string | undefined {
  const metadataMimeType = ref.metadata?.mimeType;
  if (metadataMimeType !== undefined && metadataMimeType.startsWith("image/")) {
    return metadataMimeType;
  }
  return IMAGE_MIME_BY_EXTENSION[path.extname(absolutePath).toLowerCase()];
}

async function resolveReadableFileRef(
  ref: TaskSoilContextRef,
  workspaceRoot: string,
  permissionRefs: readonly string[],
  resolveManagedAttachmentPath: ((attachmentId: string) => Promise<string | undefined>) | undefined,
): Promise<{ readonly absolutePath: string } | undefined> {
  if (ref.kind !== "file") {
    return undefined;
  }
  const managedAttachmentId = managedUploadAttachmentId(ref.ref);
  if (managedAttachmentId !== undefined) {
    if (!permissionRefs.includes(`read:uploaded-attachment:${managedAttachmentId}`)) return undefined;
    const absolutePath = await resolveManagedAttachmentPath?.(managedAttachmentId);
    return absolutePath !== undefined && path.isAbsolute(absolutePath)
      ? { absolutePath: path.resolve(absolutePath) }
      : undefined;
  }
  if (ref.ref.startsWith("local-file:")) {
    const absolutePath = ref.ref.slice("local-file:".length);
    if (!path.isAbsolute(absolutePath) || !permissionRefs.includes(`read:local-file:${absolutePath}`)) {
      return undefined;
    }
    return { absolutePath: path.resolve(absolutePath) };
  }
  if (ref.ref.startsWith("file:")) {
    const relativePath = ref.ref.slice("file:".length);
    if (!permissionRefs.includes(`read:file:${relativePath}`)) {
      return undefined;
    }
    return resolveWorkspaceRelativeFile(workspaceRoot, relativePath);
  }
  if (ref.ref.startsWith("workspace:")) {
    const relativePath = ref.ref.slice("workspace:".length);
    if (relativePath.length === 0 || relativePath === "current" || relativePath.startsWith("goal-")) {
      return undefined;
    }
    if (!permissionRefs.includes("read:workspace:current-task")) {
      return undefined;
    }
    return resolveWorkspaceRelativeFile(workspaceRoot, relativePath);
  }
  return undefined;
}

function resolveWorkspaceRelativeFile(
  workspaceRoot: string,
  relativePath: string
): { readonly absolutePath: string } | undefined {
  const root = path.resolve(workspaceRoot);
  const absolutePath = path.resolve(root, relativePath);
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  return { absolutePath };
}

function appendAttachmentsToCurrentUserMessage(
  messages: readonly ModelMessage[],
  attachments: readonly ModelInputAttachment[]
): readonly ModelMessage[] {
  let targetIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      targetIndex = index;
      break;
    }
  }
  if (targetIndex < 0) {
    return messages;
  }
  return messages.map((message, index) => {
    if (index !== targetIndex) {
      return message;
    }
    return {
      ...message,
      attachments: [...(message.attachments ?? []), ...attachments],
    };
  });
}
