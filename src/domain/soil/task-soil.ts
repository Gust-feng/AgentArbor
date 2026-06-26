import type { Constraint } from "../constraints.js";
import type {
  ReadonlySoilStore,
  SoilCapabilityAssetRef,
  SoilHistoricalRunRef,
  SoilPathBiasRef,
} from "./store.js";

export type TaskSoilContextRef = {
  readonly attachmentId?: string;
  readonly ref: string;
  readonly kind: "user_goal" | "workspace" | "file" | "project" | "web" | "runtime";
  readonly title?: string;
  readonly summary?: string;
  readonly metadata?: {
    readonly byteLength?: number;
    readonly mimeType?: string;
    readonly available?: boolean;
    readonly truncated?: boolean;
  };
  readonly readonlyPreview?: {
    readonly title?: string;
    readonly text: string;
    readonly truncated: boolean;
  };
};

export type TaskSoil = {
  readonly soilKind: "task_soil";
  readonly taskSoilId: string;
  readonly rawGoal: string;
  readonly goalId?: string;
  readonly traceId?: string;
  readonly contextRefs: readonly TaskSoilContextRef[];
  readonly constraints: readonly Constraint[];
  readonly permissionBoundaryRefs: readonly string[];
  readonly globalSoilRefs: readonly string[];
  readonly runMaterialRefs: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type GlobalSoilView = {
  readonly soilKind: "global_soil_view";
  readonly constraints: readonly Constraint[];
  readonly capabilityAssetRefs: readonly SoilCapabilityAssetRef[];
  readonly pathBiasRefs: readonly SoilPathBiasRef[];
  readonly historicalRunRefs: readonly SoilHistoricalRunRef[];
  readonly governanceBoundary: "read_only_view_no_write_governance";
  readonly createdAt: string;
};

export function createTaskSoil(input: {
  readonly rawGoal: string;
  readonly taskSoilId?: string;
  readonly goalId?: string;
  readonly traceId?: string;
  readonly contextRefs?: readonly TaskSoilContextRef[];
  readonly constraints?: readonly Constraint[];
  readonly permissionBoundaryRefs?: readonly string[];
  readonly globalSoilRefs?: readonly string[];
  readonly runMaterialRefs?: readonly string[];
  readonly createdAt?: string;
}): TaskSoil {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    soilKind: "task_soil",
    taskSoilId: input.taskSoilId ?? `task-soil:${createdAt}`,
    rawGoal: input.rawGoal,
    goalId: input.goalId,
    traceId: input.traceId,
    contextRefs: (input.contextRefs ?? []).map(cloneTaskSoilContextRef),
    constraints: (input.constraints ?? []).map(cloneConstraint),
    permissionBoundaryRefs: [...(input.permissionBoundaryRefs ?? [])],
    globalSoilRefs: [...(input.globalSoilRefs ?? [])],
    runMaterialRefs: [...(input.runMaterialRefs ?? [])],
    createdAt,
    updatedAt: createdAt,
  };
}

export function attachTaskSoilRunRefs(
  taskSoil: TaskSoil,
  input: {
    readonly goalId: string;
    readonly traceId: string;
    readonly runMaterialRefs?: readonly string[];
    readonly updatedAt?: string;
  }
): TaskSoil {
  return cloneTaskSoil({
    ...taskSoil,
    goalId: input.goalId,
    traceId: input.traceId,
    runMaterialRefs: [...taskSoil.runMaterialRefs, ...(input.runMaterialRefs ?? [])],
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  });
}

export function createGlobalSoilView(store: ReadonlySoilStore, createdAt = new Date().toISOString()): GlobalSoilView {
  return {
    soilKind: "global_soil_view",
    constraints: store.listConstraints(),
    capabilityAssetRefs: store.listCapabilityAssetRefs(),
    pathBiasRefs: store.listPathBiasRefs(),
    historicalRunRefs: store.listHistoricalRunRefs(),
    governanceBoundary: "read_only_view_no_write_governance",
    createdAt,
  };
}

export function cloneTaskSoil(taskSoil: TaskSoil): TaskSoil {
  return {
    ...taskSoil,
    contextRefs: taskSoil.contextRefs.map(cloneTaskSoilContextRef),
    constraints: taskSoil.constraints.map(cloneConstraint),
    permissionBoundaryRefs: [...taskSoil.permissionBoundaryRefs],
    globalSoilRefs: [...taskSoil.globalSoilRefs],
    runMaterialRefs: [...taskSoil.runMaterialRefs],
  };
}

export function cloneGlobalSoilView(globalSoil: GlobalSoilView): GlobalSoilView {
  return {
    ...globalSoil,
    constraints: globalSoil.constraints.map(cloneConstraint),
    capabilityAssetRefs: globalSoil.capabilityAssetRefs.map((ref) => ({ ...ref, evidenceRefs: [...ref.evidenceRefs] })),
    pathBiasRefs: globalSoil.pathBiasRefs.map((ref) => ({ ...ref, evidenceRefs: [...ref.evidenceRefs] })),
    historicalRunRefs: globalSoil.historicalRunRefs.map((ref) => ({ ...ref, evidenceRefs: [...ref.evidenceRefs] })),
  };
}

function cloneTaskSoilContextRef(ref: TaskSoilContextRef): TaskSoilContextRef {
  return {
    ...ref,
    metadata: ref.metadata === undefined ? undefined : { ...ref.metadata },
    readonlyPreview: ref.readonlyPreview === undefined ? undefined : { ...ref.readonlyPreview },
  };
}

function cloneConstraint(constraint: Constraint): Constraint {
  return {
    ...constraint,
    appliesTo: [...constraint.appliesTo],
    evidenceRefs: [...constraint.evidenceRefs],
  };
}
