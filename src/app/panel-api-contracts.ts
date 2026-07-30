/**
 * Panel HTTP API 共享契约类型。
 *
 * 本文件定义 Panel 前后端共用的 API 响应/实体类型。
 * 后端路由和前端 client 都从这里引用，消除手动镜像。
 *
 * 只放纯类型，不放运行时代码。
 */

/* ─── Personal Knowledge ─────────────────────────────────────────── */

export type PersonalNoteRevision = {
  readonly noteId: string;
  readonly revision: number;
  readonly baseRevision?: number;
  readonly operation: "create" | "update" | "delete" | "snapshot";
  readonly title: string;
  readonly bodyMarkdown: string;
  readonly actor: {
    readonly kind: "user" | "agent" | "system";
    readonly actorId?: string;
    readonly traceId?: string;
    readonly goalId?: string;
    readonly toolCallId?: string;
  };
  readonly changeSummary?: string;
  readonly createdAt: number;
};

/* ─── Space Reference Preview ────────────────────────────────────── */

export type SpaceReferencePreview = {
  readonly itemId: string;
  readonly title: string;
  readonly sourceKind: "local_file" | "workspace_folder" | "managed_folder" | "asset_folder" | "workbench_asset" | "web_page" | "generated_artifact" | "conversation";
  readonly source: string;
  readonly status: "ready" | "missing" | "unsupported";
  readonly fingerprint?: string;
  readonly byteLength?: number;
  readonly modifiedAt?: number;
  readonly content:
    | { readonly kind: "text"; readonly text: string; readonly truncated: boolean; readonly editable: boolean; readonly language?: string; readonly encoding?: string }
    | { readonly kind: "directory"; readonly relativePath: string; readonly entries: readonly { readonly name: string; readonly relativePath: string; readonly kind: "file" | "directory" | "other" }[]; readonly truncated: boolean }
    | { readonly kind: "media"; readonly mediaKind: "image" | "pdf" | "video" | "audio"; readonly mimeType: string; readonly url: string; readonly alt?: string; readonly caption?: string; readonly poster?: string; readonly duration?: string; readonly transcript?: string }
    | { readonly kind: "pages"; readonly pages: readonly string[] }
    | { readonly kind: "web"; readonly url: string; readonly site?: string; readonly body?: string }
    | { readonly kind: "unavailable"; readonly message: string };
};
