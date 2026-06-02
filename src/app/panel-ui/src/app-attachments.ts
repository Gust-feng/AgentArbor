import type { ContextAttachment } from "./contracts/context";
import { postJson } from "./api";

export function taskSoilInputFromAttachments(attachments: readonly ContextAttachment[]): {
  readonly contextRefs?: readonly {
    readonly ref: string;
    readonly kind: ContextAttachment["kind"];
    readonly summary?: string;
  }[];
  readonly permissionBoundaryRefs?: readonly string[];
} | undefined {
  const ready = attachments.filter((attachment) => attachment.status === "ready");
  if (ready.length === 0) {
    return undefined;
  }
  return {
    contextRefs: ready.map((attachment) => ({
      ref: attachment.ref,
      kind: attachment.kind,
      summary: attachment.summary,
    })),
    permissionBoundaryRefs: Array.from(new Set(ready.flatMap((attachment) => attachment.permissionRefs))),
  };
}

export function uniqueAttachments(attachments: readonly ContextAttachment[]): readonly ContextAttachment[] {
  const seen = new Set<string>();
  const result: ContextAttachment[] = [];
  for (const attachment of attachments) {
    const key = `${attachment.kind}:${attachment.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(attachment);
  }
  return result;
}

export async function previewContextAttachment(input: {
  readonly kind: ContextAttachment["kind"];
  readonly value: string;
}): Promise<ContextAttachment> {
  const response = await postJson<{ readonly attachment: ContextAttachment }>("/api/context/attachments/preview", {
    kind: input.kind,
    value: input.value,
  });
  return response.attachment;
}

export function blockedContextAttachment(input: {
  readonly kind: ContextAttachment["kind"];
  readonly value: string;
  readonly error: unknown;
  readonly createdAt?: number;
}): ContextAttachment {
  const message = input.error instanceof Error ? input.error.message : "上下文暂时不可用。";
  return {
    attachmentId: `blocked:${input.kind}:${input.value}:${input.createdAt ?? Date.now()}`,
    kind: input.kind,
    ref: input.value,
    title: input.kind === "web" ? "网页不可用" : "上下文不可用",
    summary: `系统错误：${message}`,
    permissionRefs: [],
    readonlyPreviewMeta: { available: false },
    status: "blocked",
    warning: message,
  };
}
