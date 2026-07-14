import type { BasicAgentCapabilitySnapshot } from "../../domain/config/contracts.js";
import type { ToolConfirmationPolicy } from "../../domain/tools/contracts.js";
import type { ChildAgentRun } from "../../domain/underground/agent-fabric.js";
import type { AgentTurnRuntime } from "../../kernel/intelligence/agent-turn-runtime.js";
import { createId, nowIso, type IdFactory } from "../../kernel/id.js";
import type {
  DeepChildSpec,
  DeepChildSummary,
  DeepDelegationDecision,
  DeepResearchBrief,
  DeepRunStatus,
  DeepTaskBoardPhase,
} from "./contracts.js";
import { exploreDeepChild } from "./child-delegation.js";
import { continueDeepChildAgent } from "./deep-child-agent-runner.js";
import { DeepTaskBoard } from "./deep-task-board.js";
import { DeepChildScheduler } from "./deep-child-scheduler.js";
import type {
  DeepChildExecutedQueuedInstruction,
  DeepChildTerminalMaterial,
  ExploreDeepChildFactory,
} from "./deep-child-scheduler-contracts.js";

export type DeepSchedulerProgressEvent =
  | {
      readonly kind: "child.started";
      readonly stepIndex: number;
      readonly childRun: ChildAgentRun;
      readonly childSpec: DeepChildSpec;
      readonly recordedAt: string;
    }
  | {
      readonly kind: "child.completed";
      readonly stepIndex: number;
      readonly childRun: ChildAgentRun;
      readonly summary: DeepChildSummary;
      readonly recordedAt: string;
    };

export function createDeepDefaultScheduler(input: {
  readonly runId: string;
  readonly goal: string;
  readonly permissionBoundaryRefs: readonly string[];
  readonly turnRuntime: AgentTurnRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly confirmationPolicy?: ToolConfirmationPolicy;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly maxConcurrency?: number;
  readonly maxChildren?: number;
  readonly childIdFactory?: IdFactory;
  readonly emitProgress: (event: DeepSchedulerProgressEvent) => void | Promise<void>;
}): DeepChildScheduler {
  const board = new DeepTaskBoard({ runId: input.runId });
  const exploreFactory: ExploreDeepChildFactory = (childRun, childSpec) =>
    exploreDeepChild({
      childRun,
      childSpec,
      goal: input.goal,
      permissionBoundaryRefs: input.permissionBoundaryRefs,
      turnRuntime: input.turnRuntime,
      traceId: input.traceId,
      goalId: input.goalId,
      confirmationPolicy: input.confirmationPolicy,
      capabilitySnapshot: input.capabilitySnapshot,
    });
  return new DeepChildScheduler({
    board,
    exploreFactory,
    continueFactory: (childRun, childSpec, parentInstruction, previousSummary, parentOperation) =>
      continueDeepChildAgent({
        childRun,
        childSpec,
        previousSummary,
        parentInstruction,
        currentParentInstructionRef: parentOperation.messageRef,
        currentParentReview: parentOperation.review,
        goal: input.goal,
        permissionBoundaryRefs: input.permissionBoundaryRefs,
        turnRuntime: input.turnRuntime,
        traceId: input.traceId,
        goalId: input.goalId,
        confirmationPolicy: input.confirmationPolicy,
        capabilitySnapshot: input.capabilitySnapshot,
      }),
    maxConcurrency: input.maxConcurrency,
    maxChildren: input.maxChildren,
    childIdFactory: input.childIdFactory,
    callbacks: {
      onChildStarted: (task, childRun, stepIndex) => {
        void input.emitProgress({
          kind: "child.started",
          stepIndex,
          childRun,
          childSpec: task.spec,
          recordedAt: nowIso(),
        });
      },
      onChildTerminal: (_task, summary, completedRun, _material, stepIndex) => {
        void input.emitProgress({
          kind: "child.completed",
          stepIndex,
          childRun: completedRun,
          summary,
          recordedAt: nowIso(),
        });
      },
    },
  });
}

export function mergeDeepTerminalMaterials(
  materials: readonly DeepChildTerminalMaterial[],
  childSummaries: DeepChildSummary[],
  completedChildRuns: ChildAgentRun[],
  executedQueuedChildInstructions?: DeepChildExecutedQueuedInstruction[],
): void {
  for (const material of materials) {
    replaceByChildRunId(childSummaries, material.summary, (summary) => summary.childRunId);
    replaceByChildRunId(completedChildRuns, material.completedRun, (run) => run.childRunId);
    if (executedQueuedChildInstructions !== undefined && material.executedQueuedInstructions !== undefined) {
      executedQueuedChildInstructions.push(...material.executedQueuedInstructions);
    }
  }
}

export async function waitForDeepChildTerminalForReview(
  scheduler: DeepChildScheduler,
  childRunId: string,
): Promise<DeepChildTerminalMaterial[]> {
  const accumulated: DeepChildTerminalMaterial[] = [];
  for (;;) {
    scheduler.startQueued();
    const task = scheduler.snapshot().tasks.find((item) => item.childRunId === childRunId);
    if (task === undefined || (task.status !== "pending" && task.status !== "running")) {
      return accumulated;
    }
    const harvested = await scheduler.waitForProgress();
    if (harvested.length === 0) {
      return accumulated;
    }
    accumulated.push(...harvested);
    if (harvested.some((material) => material.completedRun.childRunId === childRunId)) {
      return accumulated;
    }
  }
}

export function backfillDeepSpawnedChildren<
  T extends {
    readonly stepIndex: number;
    readonly childrenAdded?: readonly DeepChildSummary[];
    readonly failedChildren?: number;
  },
>(
  steps: readonly T[],
  spawnedChildRunIdsByStep: ReadonlyMap<number, readonly string[]>,
  childSummaries: readonly DeepChildSummary[],
): T[] {
  const summaryByChildRunId = new Map<string, DeepChildSummary>();
  for (const summary of childSummaries) {
    summaryByChildRunId.set(summary.childRunId, summary);
  }
  return steps.map((step) => {
    const spawnedIds = spawnedChildRunIdsByStep.get(step.stepIndex);
    if (spawnedIds === undefined || spawnedIds.length === 0) {
      return step;
    }
    const childrenAdded = spawnedIds
      .map((childRunId) => summaryByChildRunId.get(childRunId))
      .filter((summary): summary is DeepChildSummary => summary !== undefined);
    const failedChildren = childrenAdded.filter((summary) => summary.status === "failed").length;
    return {
      ...step,
      childrenAdded,
      failedChildren: failedChildren > 0 ? failedChildren : step.failedChildren,
    } as T;
  });
}

export function buildDeepResearchBrief(input: {
  readonly goal: string;
  readonly decision: DeepDelegationDecision;
  readonly childSpecs: readonly DeepChildSpec[];
  readonly permissionBoundaryRefs: readonly string[];
}): DeepResearchBrief {
  const plannedAngles = input.childSpecs.map(
    (spec) => `${spec.displayName}（${spec.role}）：${spec.objective}`,
  );
  const sourcePolicySummary =
    input.permissionBoundaryRefs.length > 0
      ? `来源策略：受 ${input.permissionBoundaryRefs.length} 项权限边界约束；child 按授权工具收集证据。`
      : "来源策略：本轮无显式权限边界约束；child 按授权工具收集证据。";
  return {
    briefId: createId("deep-brief"),
    goal: input.goal,
    scopeSummary: input.decision.decisionSummary,
    sourcePolicySummary,
    plannedAngles,
    needsUserApproval: false,
    updatedAt: nowIso(),
  };
}

export function deepTaskBoardPhaseForRunStatus(status: DeepRunStatus): DeepTaskBoardPhase {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
    case "interrupted":
    case "corrected":
      return "needs_input";
    default:
      return "completed";
  }
}

function replaceByChildRunId<T>(items: T[], next: T, idOf: (item: T) => string): void {
  const nextId = idOf(next);
  const index = items.findIndex((item) => idOf(item) === nextId);
  if (index >= 0) {
    items[index] = next;
    return;
  }
  items.push(next);
}
