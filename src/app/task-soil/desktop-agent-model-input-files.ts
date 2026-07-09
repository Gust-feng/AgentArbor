import { promises as fs } from "node:fs";
import path from "node:path";
import type { ModelCapabilities } from "../../domain/config/index.js";
import type { ModelInputAttachment, ModelMessage } from "../../domain/intelligence/index.js";
import type { TaskSoil, TaskSoilContextRef } from "../../domain/soil/index.js";

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
}): Promise<readonly ModelMessage[]> {
  if (input.modelCapabilities?.supportsVisionInput !== true) {
    return input.messages;
  }
  const attachments = await resolveImageAttachments({
    taskSoil: input.taskSoil,
    workspaceRoot: input.workspaceRoot ?? process.cwd(),
  });
  if (attachments.length === 0) {
    return input.messages;
  }
  return appendAttachmentsToCurrentUserMessage(input.messages, attachments);
}

async function resolveImageAttachments(input: {
  readonly taskSoil: TaskSoil;
  readonly workspaceRoot: string;
}): Promise<readonly ModelInputAttachment[]> {
  const attachments: ModelInputAttachment[] = [];
  for (const ref of input.taskSoil.contextRefs) {
    const resolved = resolveReadableFileRef(ref, input.workspaceRoot, input.taskSoil.permissionBoundaryRefs);
    if (resolved === undefined) {
      continue;
    }
    const mimeType = imageMimeTypeFor(ref, resolved.absolutePath);
    if (mimeType === undefined) {
      continue;
    }
    const stat = await fs.stat(resolved.absolutePath).catch(() => undefined);
    if (stat?.isFile() !== true || stat.size > MAX_IMAGE_ATTACHMENT_BYTES) {
      continue;
    }
    const data = await fs.readFile(resolved.absolutePath).catch(() => undefined);
    if (data === undefined) {
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
  return attachments;
}

function imageMimeTypeFor(ref: TaskSoilContextRef, absolutePath: string): string | undefined {
  const metadataMimeType = ref.metadata?.mimeType;
  if (metadataMimeType !== undefined && metadataMimeType.startsWith("image/")) {
    return metadataMimeType;
  }
  return IMAGE_MIME_BY_EXTENSION[path.extname(absolutePath).toLowerCase()];
}

function resolveReadableFileRef(
  ref: TaskSoilContextRef,
  workspaceRoot: string,
  permissionRefs: readonly string[]
): { readonly absolutePath: string } | undefined {
  if (ref.kind !== "file") {
    return undefined;
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
    const attachmentLines = attachments
      .map((attachment, attachmentIndex) => {
        const safeRef = modelSafeInputRef(attachment.inputRef);
        return [
          "-",
          `attachment_id=${attachment.attachmentId ?? safeRef ?? `model-input:${attachmentIndex + 1}`}`,
          safeRef === undefined ? undefined : `ref=${safeRef}`,
          `kind=${attachment.kind}`,
          attachment.filename === undefined ? undefined : `filename=${attachment.filename}`,
          attachment.byteLength === undefined ? undefined : `bytes=${attachment.byteLength}`,
        ].filter((part): part is string => part !== undefined).join(" ");
      })
      .join("\n");
    return {
      ...message,
      content: [
        message.content,
        "",
        "The following image inputs are already attached to this user message for direct visual inspection:",
        "Inspect them directly instead of claiming that local images are unavailable.",
        attachmentLines,
      ].join("\n"),
      attachments: [...(message.attachments ?? []), ...attachments],
    };
  });
}

function modelSafeInputRef(ref: string | undefined): string | undefined {
  const normalized = ref?.toLowerCase();
  if (normalized === undefined || normalized.startsWith("local-file:") || normalized.startsWith("local-project:")) {
    return undefined;
  }
  return ref;
}
