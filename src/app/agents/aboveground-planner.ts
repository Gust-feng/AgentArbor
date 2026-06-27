/**
 * @deprecated 废弃候选（T4-1 / ADR-0025 deep 一期）— ① fake 骨架（确定性假实现）。
 *
 * 替代物：src/app/deep/* DeepRuntime（manager 自由决策循环 → 一层 child 探索 → 父层综合）；
 * 正式入口 POST /api/deep/conversations + /api/deep/conversations/:id/runs。
 *
 * 删除前置条件（闭环4 §8.1 阶段④）：smoke/tests 迁移完成 + 等价能力验证通过 + 无活跃引用。
 * 当前保持运行不阻塞构建；禁止改名/删除（仍被 test/smoke/compat 引用）。
 * 边界：domain/underground 的 AgentLoop/Guard/run tree/事件契约为保留复用抽象，不在退役范围。
 */
import {
  assertDirectionHandoffPackageValidForPlanning,
  DirectionHandoffPackageValidationError,
} from "../../domain/agentarbor/direction-handoff-package.js";
import type { ExplorationCandidateRef } from "../../domain/contracts.js";
import { createMessage } from "../../kernel/messages/create-message.js";
import {
  assertLayerCanCreateExplorationCandidate,
  enterPlanning,
  StateGuardError,
} from "../../kernel/state-machine/task-state-machine.js";
import { createMinimalGrowthPlanMaterial } from "../minimal-growth-plan.js";
import type { MinimalRuntime } from "../runtime.js";
import type { PlanOutput } from "./types.js";

// Aboveground Execution Runtime minimal consumer. It still loads the legacy
// DirectionHandoffPackage wire shape, but product-facing semantics are Plan /
// Plan Package per ADR-0022.
export class AbovegroundPlanner {
  readonly agentId = "aboveground-planner";

  plan(directionId: string, version: number, traceId: string, runtime: MinimalRuntime): PlanOutput {
    if (typeof directionId !== "string" || !Number.isInteger(version)) {
      throw new StateGuardError(
        "PLANNING_REQUIRES_PLAN_PACKAGE_REF",
        "AbovegroundPlanner must load a validated Plan Package by direction id and version."
      );
    }

    const loadedPackage = runtime.directionHandoffPackageStore.load(directionId, version);
    const validation = runtime.directionHandoffPackageStore.validate(loadedPackage);
    const directionHandoffPackage = {
      ...loadedPackage,
      validation,
    };
    if (!validation.passed) {
      throw new DirectionHandoffPackageValidationError(validation);
    }

    // Aboveground consumes Plan refs so validation and lineage cannot be bypassed.
    assertDirectionHandoffPackageValidForPlanning(directionHandoffPackage);
    const { directionHandoff } = directionHandoffPackage;
    enterPlanning(directionHandoff);

    const { growthPlan, workflow, task } = createMinimalGrowthPlanMaterial(directionHandoff);

    runtime.bus.publish(
      createMessage({
        traceId,
        from: { id: this.agentId, role: "aboveground_center" },
        to: { group: "runtime" },
        type: "growth_plan.completed",
        intent: "complete_growth_plan",
        payload: { growthPlan },
      })
    );
    runtime.bus.publish(
      createMessage({
        traceId,
        from: { id: this.agentId, role: "aboveground_center" },
        to: { group: "runtime" },
        type: "workflow.created",
        intent: "create_workflow_ir",
        payload: { workflow },
      })
    );
    runtime.bus.publish(
      createMessage({
        traceId,
        taskId: task.id,
        from: { id: this.agentId, role: "aboveground_center" },
        to: { role: "aboveground_growth" },
        type: "task.created",
        intent: "create_task",
        payload: { task },
        requiredCapabilities: task.requiredCapabilities,
      })
    );

    return { directionHandoffPackage, growthPlan, workflow, task };
  }

  createExplorationCandidate(): ExplorationCandidateRef {
    assertLayerCanCreateExplorationCandidate("aboveground_center");
    throw new Error("unreachable");
  }
}
