import type {
  BasicAgentRun,
  ContextAttachment,
} from "../../domain/basic-agent/index.js";
import type { ObservationRef, ToolDisplayProjection } from "../../domain/observation/index.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import { redactOrdinaryText } from "../safe-projection.js";

export type WorkViewTaskSoilCanvasLike = {
  readonly taskSoilId: string;
  readonly goalSummary?: string;
  readonly contextRefs: readonly {
    readonly ref: string;
    readonly kind: string;
    readonly summary?: string;
    readonly readonlyPreview?: {
      readonly title?: string;
      readonly text: string;
      readonly truncated: boolean;
    };
  }[];
  readonly permissionBoundaryRefs: readonly string[];
  readonly [key: string]: unknown;
};

export type WorkViewCanvasContextLike = {
  readonly kind: string;
  readonly taskSoil?: WorkViewTaskSoilCanvasLike;
  readonly [key: string]: unknown;
};

export type WorkViewContextProjectionInput = {
  readonly run: BasicAgentRun;
  readonly canvas?: WorkViewCanvasContextLike;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly toolDisplays?: readonly ToolDisplayProjection[];
};

export function contextAttachmentsFor(input: WorkViewContextProjectionInput): readonly ContextAttachment[] {
  const fromCanvas = taskSoilContextAttachments(input.canvas);
  const fromInput = (input.taskSoilInput?.contextRefs ?? []).map((ref, index): ContextAttachment => ({
    attachmentId: `${input.run.runId}:context:${index}`,
    kind: ref.kind,
    ref: ref.ref,
    title: contextTitle(ref.kind, ref.ref),
    summary: redactOrdinaryText(ref.summary ?? ref.ref, 280),
    permissionRefs: (input.taskSoilInput?.permissionBoundaryRefs ?? []).map((permission) => redactOrdinaryText(permission, 220)),
    readonlyPreviewMeta: {
      available: true,
      title: ref.readonlyPreview?.title,
      truncated: ref.readonlyPreview?.text !== undefined ? ref.readonlyPreview.text.length > 0 : undefined,
    },
    status: contextRefDenied(ref.kind, ref.ref, input.taskSoilInput?.permissionBoundaryRefs ?? []) ? "blocked" : "ready",
    warning: contextRefDenied(ref.kind, ref.ref, input.taskSoilInput?.permissionBoundaryRefs ?? [])
      ? "该上下文引用被当前权限边界阻止。"
      : undefined,
  }));
  if (fromCanvas.length === 0) {
    return fromInput;
  }
  if (fromInput.length === 0) {
    return fromCanvas;
  }
  return mergeContextAttachments(fromCanvas, fromInput);
}

export function mergeToolDisplays(
  primary: readonly ToolDisplayProjection[],
  fallback: readonly ToolDisplayProjection[]
): readonly ToolDisplayProjection[] {
  const displays: ToolDisplayProjection[] = [];
  const seen = new Set<string>();
  for (const display of [...primary, ...fallback]) {
    const key = JSON.stringify(display);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    displays.push(display);
  }
  return displays;
}

export function isToolDisplay(value: ToolDisplayProjection | undefined): value is ToolDisplayProjection {
  return value !== undefined;
}

export function observationRefs(refs: readonly string[]): readonly ObservationRef[] {
  return refs.slice(0, 20).map((ref): ObservationRef => {
    const separator = ref.indexOf(":");
    if (separator > 0) {
      const kind = observationKind(ref.slice(0, separator));
      return {
        kind,
        id: redactOrdinaryText(ref.slice(separator + 1), 180),
      };
    }
    return { kind: "event", id: redactOrdinaryText(ref, 180) };
  });
}

function mergeContextAttachments(
  primary: readonly ContextAttachment[],
  fallback: readonly ContextAttachment[]
): readonly ContextAttachment[] {
  const merged: ContextAttachment[] = [];
  const seen = new Set<string>();
  for (const attachment of [...primary, ...fallback]) {
    const key = `${attachment.kind}:${attachment.ref}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(attachment);
  }
  return merged;
}

function taskSoilContextAttachments(canvas: WorkViewCanvasContextLike | undefined): readonly ContextAttachment[] {
  const taskSoil = taskSoilCanvasForWorkViewContext(canvas)?.taskSoil;
  if (taskSoil === undefined) {
    return [];
  }
  return taskSoil.contextRefs
    .filter((ref) => ref.kind !== "user_goal" && ref.kind !== "runtime")
    .map((ref, index): ContextAttachment => ({
      attachmentId: `${taskSoil.taskSoilId}:context:${index}`,
      kind: ref.kind === "file" || ref.kind === "project" || ref.kind === "web" ? ref.kind : "workspace",
      ref: redactOrdinaryText(ref.ref, 220),
      title: contextTitle(ref.kind, ref.ref),
      summary: redactOrdinaryText(ref.summary ?? ref.ref, 280),
      permissionRefs: taskSoil.permissionBoundaryRefs.filter((permission) => permission.startsWith("read:")).map((permission) => redactOrdinaryText(permission, 220)),
      readonlyPreviewMeta: {
        available: true,
        title: ref.readonlyPreview?.title,
        byteLength: ref.readonlyPreview?.text.length,
        truncated: ref.readonlyPreview?.truncated,
      },
      status: contextRefDenied(ref.kind, ref.ref, taskSoil.permissionBoundaryRefs) ? "blocked" : "ready",
      warning: contextRefDenied(ref.kind, ref.ref, taskSoil.permissionBoundaryRefs)
        ? "该上下文引用被当前权限边界阻止。"
        : undefined,
    }));
}

function taskSoilCanvasForWorkViewContext(canvas: WorkViewCanvasContextLike | undefined): WorkViewCanvasContextLike | undefined {
  return ordinaryTaskSoilCanvasForWorkViewContext(canvas);
}

function ordinaryTaskSoilCanvasForWorkViewContext(canvas: WorkViewCanvasContextLike | undefined): WorkViewCanvasContextLike | undefined {
  return canvas?.kind === "desktop_agent_canvas" || canvas?.kind === "desktop_shell_canvas" ? canvas : undefined;
}

function contextRefDenied(kind: string, ref: string, permissionRefs: readonly string[]): boolean {
  const cleanRef = ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref;
  const denied = new Set([
    `deny:${ref}`,
    `deny:${kind}:${cleanRef}`,
    `deny:${kind}`,
  ].map((value) => value.toLowerCase()));
  return permissionRefs.some((permission) => denied.has(permission.toLowerCase()));
}

function contextTitle(kind: string, ref: string): string {
  const clean = ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref;
  if (kind === "web") return redactOrdinaryText(clean, 120);
  if (kind === "file") return redactOrdinaryText(clean.split(/[\\/]/).at(-1) || clean, 120);
  if (kind === "project") return redactOrdinaryText(clean || "项目", 120);
  return "当前工作区";
}

function observationKind(value: string): ObservationRef["kind"] {
  if (value === "trace") return "trace";
  if (value === "goal") return "goal";
  if (value === "tool" || value === "tool_call") return "tool_call";
  if (value === "model" || value === "model_call") return "model_call";
  if (value === "artifact") return "artifact";
  return "event";
}
