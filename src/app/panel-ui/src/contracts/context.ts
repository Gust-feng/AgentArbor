export type ContextAttachment = {
  readonly attachmentId: string;
  readonly kind: "workspace" | "file" | "project" | "web";
  readonly ref: string;
  readonly title: string;
  readonly summary: string;
  readonly readonlyPreview?: {
    readonly title?: string;
    readonly text: string;
    readonly truncated: boolean;
  };
  readonly permissionRefs: readonly string[];
  readonly readonlyPreviewMeta: {
    readonly available: boolean;
    readonly title?: string;
    readonly byteLength?: number;
    readonly truncated?: boolean;
  };
  readonly status: "ready" | "blocked";
  readonly warning?: string;
};
