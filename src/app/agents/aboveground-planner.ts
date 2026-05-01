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

export class AbovegroundPlanner {
  readonly agentId = "aboveground-planner";

  plan(directionId: string, version: number, traceId: string, runtime: MinimalRuntime): PlanOutput {
    if (typeof directionId !== "string" || !Number.isInteger(version)) {
      throw new StateGuardError(
        "PLANNING_REQUIRES_DIRECTION_HANDOFF_PACKAGE_REF",
        "AbovegroundPlanner must load a validated DirectionHandoffPackage by direction id and version."
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

    // Aboveground consumes direction id/version refs so package validation and lineage cannot be bypassed.
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
