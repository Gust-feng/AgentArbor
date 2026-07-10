import type { TaskSoil } from "../../../domain/soil/index.js";
import { redactSensitiveText } from "../../../kernel/redaction.js";

export type PanelTaskSoilCanvasReadModel = {
  readonly taskSoilId: string;
  readonly goalId?: string;
  readonly traceId?: string;
  readonly goalSummary: string;
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
};

export function taskSoilCanvas(result: { readonly taskSoil: TaskSoil }): PanelTaskSoilCanvasReadModel {
  return {
    taskSoilId: result.taskSoil.taskSoilId,
    goalId: result.taskSoil.goalId,
    traceId: result.taskSoil.traceId,
    goalSummary: safeText(result.taskSoil.rawGoal, 600),
    contextRefs: result.taskSoil.contextRefs.map((ref) => ({
      ref: ref.ref,
      kind: ref.kind,
      summary: ref.summary === undefined ? undefined : safeText(ref.summary, 240),
      readonlyPreview:
        ref.readonlyPreview === undefined
          ? undefined
          : {
              title: ref.readonlyPreview.title === undefined ? undefined : safeText(ref.readonlyPreview.title, 120),
              text: safeText(ref.readonlyPreview.text, 360),
              truncated: ref.readonlyPreview.truncated || ref.readonlyPreview.text.length > 360,
            },
    })),
    permissionBoundaryRefs: [...result.taskSoil.permissionBoundaryRefs],
  };
}

export function safeText(value: string, maxLength: number): string {
  const redacted = redactSensitiveText(value);
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength - 1)}…`;
}

export function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
