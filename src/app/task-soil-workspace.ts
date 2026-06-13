import type { Constraint } from "../domain/constraints.js";
import { createTaskSoil, type ReadonlySoilStore, type TaskSoil, type TaskSoilContextRef } from "../domain/soil/index.js";
import type { ModelRuntimeMode } from "./model-runtime/index.js";

const MAX_REF_LENGTH = 220;
const MAX_SUMMARY_LENGTH = 360;
const MAX_PREVIEW_LENGTH = 640;

export type DesktopTaskSoilContextRefInput = {
  readonly ref: string;
  readonly kind: "workspace" | "file" | "project" | "web";
  readonly summary?: string;
  readonly readonlyPreview?: {
    readonly title?: string;
    readonly text: string;
  };
};

export type DesktopTaskSoilInput = {
  readonly contextRefs?: readonly DesktopTaskSoilContextRefInput[];
  readonly permissionBoundaryRefs?: readonly string[];
};

export type TaskSoilInputValidationIssueCode =
  | "invalid_context_refs"
  | "empty_context_ref"
  | "unauthorized_context_ref"
  | "invalid_permission_refs"
  | "unauthorized_permission_ref";

export class TaskSoilInputValidationError extends Error {
  constructor(
    readonly code: TaskSoilInputValidationIssueCode,
    message: string
  ) {
    super(message);
    this.name = "TaskSoilInputValidationError";
  }
}

export function parseDesktopTaskSoilInput(raw: unknown): DesktopTaskSoilInput {
  const record = asRecord(raw);
  const taskSoil = asRecord(record.taskSoil);
  const taskSoilInput = asRecord(record.taskSoilInput);
  const contextRefsRaw = record.contextRefs ?? taskSoilInput.contextRefs ?? taskSoil.contextRefs;
  const permissionRefsRaw =
    record.permissionBoundaryRefs ?? taskSoilInput.permissionBoundaryRefs ?? taskSoil.permissionBoundaryRefs;
  return {
    contextRefs: contextRefsRaw === undefined ? undefined : parseContextRefs(contextRefsRaw),
    permissionBoundaryRefs: permissionRefsRaw === undefined ? undefined : parsePermissionRefs(permissionRefsRaw),
  };
}

export function createTaskSoilFromDesktopInput(input: {
  readonly goal: string;
  readonly goalId: string;
  readonly traceId: string;
  readonly aiMode: ModelRuntimeMode;
  readonly constraints: readonly Constraint[];
  readonly soilStore: ReadonlySoilStore;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly createdAt?: string;
}): TaskSoil {
  return createTaskSoil({
    rawGoal: input.goal,
    goalId: input.goalId,
    traceId: input.traceId,
    contextRefs: createDesktopTaskSoilContextRefs(input),
    constraints: input.constraints,
    permissionBoundaryRefs: createDesktopPermissionRefs(input.aiMode, input.taskSoilInput?.permissionBoundaryRefs),
    globalSoilRefs: [
      ...input.soilStore.listCapabilityAssetRefs().map((ref) => ref.id),
      ...input.soilStore.listPathBiasRefs().map((ref) => ref.id),
    ],
    runMaterialRefs: [input.traceId],
    createdAt: input.createdAt,
  });
}

function createDesktopTaskSoilContextRefs(input: {
  readonly goal: string;
  readonly goalId: string;
  readonly taskSoilInput?: DesktopTaskSoilInput;
}): readonly TaskSoilContextRef[] {
  const supplied = input.taskSoilInput?.contextRefs ?? [];
  return [
    {
      ref: `goal:${input.goalId}`,
      kind: "user_goal",
      summary: safeText(input.goal, MAX_SUMMARY_LENGTH),
    },
    {
      ref: `workspace:${input.goalId}`,
      kind: "workspace",
      summary: "Desktop Shell provided the current task workspace context as refs only.",
    },
    ...supplied.map((ref) => ({
      ref: ref.ref,
      kind: ref.kind,
      summary: ref.summary === undefined ? undefined : safeText(ref.summary, MAX_SUMMARY_LENGTH),
      readonlyPreview:
        ref.readonlyPreview === undefined
          ? undefined
          : {
              title:
                ref.readonlyPreview.title === undefined
                  ? undefined
                  : safeText(ref.readonlyPreview.title, 120),
              ...previewText(ref.readonlyPreview.text),
            },
    })),
  ];
}

function createDesktopPermissionRefs(
  aiMode: ModelRuntimeMode,
  inputPermissionRefs: readonly string[] | undefined
): readonly string[] {
  return unique([
    "read:workspace:current-task",
    "write:memory://artifacts",
    aiMode === "openai-compatible" || aiMode === "openai-responses"
      ? "execute:responses-ai"
      : aiMode === "fake"
        ? "execute:fake-ai"
        : "execute:none",
    ...(inputPermissionRefs ?? []),
  ]);
}

function parseContextRefs(value: unknown): readonly DesktopTaskSoilContextRefInput[] {
  if (!Array.isArray(value)) {
    throw new TaskSoilInputValidationError("invalid_context_refs", "contextRefs 必须是数组。");
  }
  return value.map(parseContextRef);
}

function parseContextRef(value: unknown): DesktopTaskSoilContextRefInput {
  const record = asRecord(value);
  const ref = optionalString(record.ref);
  const kind = parseContextKind(record.kind);
  if (ref === undefined || kind === undefined) {
    throw new TaskSoilInputValidationError("empty_context_ref", "contextRefs 需要 ref 和合法 kind。");
  }
  if (!isAuthorizedContextRef(ref, kind)) {
    throw new TaskSoilInputValidationError(
      "unauthorized_context_ref",
      "contextRefs 只允许 workspace/file/project/web 的只读引用，不能传入 runtime、store、secret 或未授权正文。"
    );
  }
  return {
    ref: safeText(ref, MAX_REF_LENGTH),
    kind,
    summary: safeOptionalText(record.summary, MAX_SUMMARY_LENGTH),
    readonlyPreview: parseReadonlyPreview(record.readonlyPreview ?? record.preview),
  };
}

function parsePermissionRefs(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TaskSoilInputValidationError("invalid_permission_refs", "permissionBoundaryRefs 必须是数组。");
  }
  return unique(
    value.map((item) => {
      const ref = optionalString(item);
      if (ref === undefined) {
        throw new TaskSoilInputValidationError("invalid_permission_refs", "permissionBoundaryRefs 不能包含空值。");
      }
      if (!isAuthorizedPermissionRef(ref)) {
        throw new TaskSoilInputValidationError(
          "unauthorized_permission_ref",
          "Desktop Shell 输入只能声明 read/execute/deny/ask 权限引用，真实写入仍由 Aboveground 和 ToolCenter 守卫。"
        );
      }
      return safeText(ref, MAX_REF_LENGTH);
    })
  );
}

function parseReadonlyPreview(value: unknown): DesktopTaskSoilContextRefInput["readonlyPreview"] {
  if (value === undefined || value === null) {
    return undefined;
  }
  const record = asRecord(value);
  if (typeof record.text !== "string" || record.text.length === 0) {
    return undefined;
  }
  return {
    title: safeOptionalText(record.title, 120),
    text: record.text,
  };
}

function parseContextKind(value: unknown): DesktopTaskSoilContextRefInput["kind"] | undefined {
  if (value === "workspace" || value === "file" || value === "project" || value === "web") {
    return value;
  }
  return undefined;
}

function isAuthorizedContextRef(ref: string, kind: DesktopTaskSoilContextRefInput["kind"]): boolean {
  const normalized = ref.toLowerCase();
  if (kind === "file" && normalized.startsWith("local-file:")) {
    return true;
  }
  if (kind === "project" && normalized.startsWith("local-project:")) {
    return true;
  }
  if (kind === "web") {
    return normalized.startsWith("web:") || normalized.startsWith("http://") || normalized.startsWith("https://");
  }
  if (kind === "file") {
    return normalized.startsWith("file:") || normalized.startsWith("local-file:") || normalized.startsWith("workspace:");
  }
  if (kind === "project") {
    return normalized.startsWith("project:") || normalized.startsWith("local-project:") || normalized.startsWith("workspace:");
  }
  return normalized.startsWith("workspace:");
}

function isAuthorizedPermissionRef(ref: string): boolean {
  const normalized = ref.toLowerCase();
  if (normalized.startsWith("read:local-file:") || normalized.startsWith("read:local-project:")) {
    return true;
  }
  return (
    ref.startsWith("read:") ||
    ref.startsWith("execute:") ||
    ref.startsWith("deny:") ||
    ref.startsWith("ask:")
  );
}

function previewText(text: string): { readonly text: string; readonly truncated: boolean } {
  const safe = safeText(text, MAX_PREVIEW_LENGTH);
  return {
    text: safe,
    truncated: safe.length < text.length,
  };
}

function safeOptionalText(value: unknown, maxLength: number): string | undefined {
  return optionalString(value) === undefined ? undefined : safeText(String(value), maxLength);
}

function safeText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return {};
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
